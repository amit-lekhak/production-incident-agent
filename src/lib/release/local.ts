import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type {
  CommitRecord,
  DeployRecord,
  OpenRevertPrInput,
  PrRecord,
  ReleaseProvider,
} from "./types";

const SERVICE_PREFIX = "services/relay-checkout/";

type LocalPr = PrRecord & {
  open: boolean;
  branch: string;
  restoreSha: string;
};

/**
 * In-memory / temp-git release provider for evals and unit tests.
 * Never talks to the network.
 */
export class LocalReleaseProvider implements ReleaseProvider {
  private root: string;
  private envName: string;
  private deployments: DeployRecord[] = [];
  private prs = new Map<number, LocalPr>();
  private nextPr = 1;
  private workRoot: string;

  constructor(opts?: { root?: string; deployEnv?: string }) {
    this.envName = opts?.deployEnv ?? "production";
    this.root = opts?.root ?? mkdtempSync(join(tmpdir(), "relay-release-"));
    this.workRoot = join(this.root, ".worktrees");
    mkdirSync(this.workRoot, { recursive: true });
    if (!existsSync(join(this.root, ".git"))) {
      this.git("init", "-b", "main");
      this.git("config", "user.email", "test@relay.dev");
      this.git("config", "user.name", "Relay Test");
    }
  }

  get repoRoot() {
    return this.root;
  }

  private git(...args: string[]) {
    return execFileSync("git", args, {
      cwd: this.root,
      encoding: "utf8",
    }).trim();
  }

  /** Seed healthy service files and an initial production deploy. */
  seedService(
    files: Record<string, string>,
    message = "chore: initial relay-checkout",
  ) {
    for (const [path, content] of Object.entries(files)) {
      const full = join(
        this.root,
        path.startsWith(SERVICE_PREFIX) ? path : `${SERVICE_PREFIX}${path}`,
      );
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    this.git("add", "services/relay-checkout");
    this.git("commit", "-m", message);
    const sha = this.git("rev-parse", "HEAD");
    this.deployments.unshift({
      sha,
      environment: this.envName,
      description: message,
      createdAt: new Date().toISOString(),
      id: this.deployments.length + 1,
    });
    return sha;
  }

  async currentDeploy(): Promise<DeployRecord | null> {
    return this.deployments[0] ?? null;
  }

  async listDeployments(limit = 10): Promise<DeployRecord[]> {
    return this.deployments.slice(0, limit);
  }

  async listCommits(limit = 10): Promise<CommitRecord[]> {
    const log = this.git(
      "log",
      `-${limit}`,
      "--pretty=format:%H%x00%s%x00%an%x00%aI",
      "--",
      "services/relay-checkout",
    );
    if (!log) return [];
    return log.split("\n").map((line) => {
      const [sha, message, author, committedAt] = line.split("\0");
      let filesChanged: string[] = [];
      try {
        filesChanged = this.git(
          "diff-tree",
          "--no-commit-id",
          "--name-only",
          "-r",
          sha!,
        )
          .split("\n")
          .filter((f) => f.startsWith(SERVICE_PREFIX));
      } catch {
        filesChanged = [];
      }
      return {
        sha: sha!,
        message: message ?? "",
        author: author ?? "unknown",
        committedAt: committedAt ?? "",
        filesChanged,
      };
    });
  }

  async getFile(sha: string, path: string): Promise<string> {
    const filePath = path.startsWith(SERVICE_PREFIX)
      ? path
      : `${SERVICE_PREFIX}${path.replace(/^\//, "")}`;
    return this.git("show", `${sha}:${filePath}`);
  }

  async diff(base: string, head: string): Promise<string> {
    try {
      return this.git(
        "diff",
        `${base}...${head}`,
        "--",
        "services/relay-checkout",
      );
    } catch {
      return "(no service file changes)";
    }
  }

  async createDeployment(sha: string, summary: string): Promise<DeployRecord> {
    const full = this.git("rev-parse", sha);
    const rec: DeployRecord = {
      sha: full,
      environment: this.envName,
      description: summary,
      createdAt: new Date().toISOString(),
      id: this.deployments.length + 1,
    };
    this.deployments.unshift(rec);
    return rec;
  }

  async openRevertPr(input: OpenRevertPrInput): Promise<PrRecord> {
    const badFull = this.git("rev-parse", input.sha);
    let restoreSha = input.restoreSha;
    if (!restoreSha) {
      try {
        restoreSha = this.git("rev-parse", `${badFull}^`);
      } catch {
        restoreSha = badFull;
      }
    }
    const branch = `incident/revert-${badFull.slice(0, 8)}-${Date.now()}`;
    this.git("checkout", "-b", branch);
    // Restore service tree from restoreSha
    this.git("checkout", restoreSha, "--", "services/relay-checkout");
    try {
      this.git("commit", "-m", input.title);
    } catch {
      // nothing to commit
    }
    const headSha = this.git("rev-parse", "HEAD");
    this.git("checkout", "main");
    const number = this.nextPr++;
    const pr: LocalPr = {
      number,
      url: `local://pr/${number}`,
      title: input.title,
      headSha,
      baseSha: this.git("rev-parse", "main"),
      open: true,
      branch,
      restoreSha,
    };
    this.prs.set(number, pr);
    return pr;
  }

  async mergePr(number: number): Promise<{ sha: string; merged: boolean }> {
    const pr = this.prs.get(number);
    if (!pr || !pr.open) throw new Error(`PR #${number} not open`);
    this.git("merge", "--ff-only", pr.branch);
    const sha = this.git("rev-parse", "HEAD");
    pr.open = false;
    this.git("branch", "-D", pr.branch);
    return { sha, merged: true };
  }

  async closePr(number: number): Promise<void> {
    const pr = this.prs.get(number);
    if (!pr) throw new Error(`PR #${number} missing`);
    pr.open = false;
    try {
      this.git("branch", "-D", pr.branch);
    } catch {
      // already gone
    }
  }

  async checkoutDeployed(sha: string): Promise<string> {
    const dest = join(this.workRoot, sha.slice(0, 12));
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const files = this.git(
      "ls-tree",
      "-r",
      "--name-only",
      sha,
      "services/relay-checkout",
    )
      .split("\n")
      .filter(Boolean);
    for (const path of files) {
      const rel = path.slice(SERVICE_PREFIX.length);
      const content = this.git("show", `${sha}:${path}`);
      const out = join(dest, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, content, "utf8");
    }
    return dest;
  }

  async commitAndPush(input: {
    message: string;
    files: Array<{ path: string; content: string }>;
    branch?: string;
  }): Promise<{ sha: string }> {
    for (const f of input.files) {
      const path = f.path.startsWith(SERVICE_PREFIX)
        ? f.path
        : `${SERVICE_PREFIX}${f.path.replace(/^\//, "")}`;
      const full = join(this.root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.content, "utf8");
    }
    this.git("add", "services/relay-checkout");
    this.git("commit", "-m", input.message);
    return { sha: this.git("rev-parse", "HEAD") };
  }

  destroy() {
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** Read a local file tree into a map for LocalReleaseProvider.seedService. */
export function readTreeAsMap(
  dir: string,
  prefix = "",
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) {
      Object.assign(out, readTreeAsMap(full, rel));
    } else {
      out[rel] = readFileSync(full, "utf8");
    }
  }
  return out;
}
