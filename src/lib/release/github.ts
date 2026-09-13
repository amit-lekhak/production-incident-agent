import { Octokit } from "@octokit/rest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getEnv } from "@/lib/env";
import { worktreeRoot } from "./worktree-root";
import type {
  CommitRecord,
  DeployRecord,
  OpenRevertPrInput,
  PrRecord,
  ReleaseProvider,
} from "./types";

const SERVICE_PREFIX = "services/relay-checkout/";

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid GITHUB_REPO: ${repo}`);
  return { owner, name };
}

function gitRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

export class GitHubReleaseProvider implements ReleaseProvider {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private envName: string;
  private workRoot: string;

  constructor(opts?: { token?: string; repo?: string; deployEnv?: string }) {
    const env = getEnv();
    const token = opts?.token ?? env.GITHUB_TOKEN;
    const full = opts?.repo ?? env.GITHUB_REPO;
    this.envName = opts?.deployEnv ?? env.GITHUB_DEPLOY_ENV;
    const { owner, name } = parseRepo(full);
    this.owner = owner;
    this.repo = name;
    this.octokit = new Octokit({ auth: token });
    this.workRoot = worktreeRoot();
  }

  async currentDeploy(): Promise<DeployRecord | null> {
    const list = await this.listDeployments(1);
    return list[0] ?? null;
  }

  async listDeployments(limit = 10): Promise<DeployRecord[]> {
    const { data } = await this.octokit.repos.listDeployments({
      owner: this.owner,
      repo: this.repo,
      environment: this.envName,
      per_page: Math.min(limit, 30),
    });
    return data.map((d) => ({
      sha: d.sha,
      environment: d.environment ?? this.envName,
      description: d.description ?? "",
      createdAt: d.created_at,
      id: d.id,
    }));
  }

  async listCommits(limit = 10): Promise<CommitRecord[]> {
    const { data } = await this.octokit.repos.listCommits({
      owner: this.owner,
      repo: this.repo,
      path: SERVICE_PREFIX.replace(/\/$/, ""),
      per_page: Math.min(limit, 30),
    });
    return Promise.all(
      data.map(async (c) => {
        let filesChanged: string[] = [];
        try {
          const detail = await this.octokit.repos.getCommit({
            owner: this.owner,
            repo: this.repo,
            ref: c.sha,
          });
          filesChanged = (detail.data.files ?? [])
            .map((f) => f.filename)
            .filter((f) => f.startsWith(SERVICE_PREFIX));
        } catch {
          filesChanged = [];
        }
        return {
          sha: c.sha,
          message: (c.commit.message ?? "").split("\n")[0] ?? "",
          author: c.commit.author?.name ?? c.author?.login ?? "unknown",
          committedAt: c.commit.author?.date ?? c.commit.committer?.date ?? "",
          filesChanged,
        };
      }),
    );
  }

  async getFile(sha: string, path: string): Promise<string> {
    const filePath = path.startsWith("services/")
      ? path
      : `${SERVICE_PREFIX}${path.replace(/^\//, "")}`;
    const { data } = await this.octokit.repos.getContent({
      owner: this.owner,
      repo: this.repo,
      path: filePath,
      ref: sha,
    });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) {
      throw new Error(`${filePath} is not a file at ${sha}`);
    }
    return Buffer.from(data.content, "base64").toString("utf8");
  }

  async diff(base: string, head: string): Promise<string> {
    const { data } = await this.octokit.repos.compareCommits({
      owner: this.owner,
      repo: this.repo,
      base,
      head,
    });
    const files = (data.files ?? []).filter((f) =>
      f.filename.startsWith(SERVICE_PREFIX),
    );
    if (files.length === 0) return "(no service file changes)";
    return files
      .map((f) => `--- ${f.filename}\n${f.patch ?? "(binary or too large)"}`)
      .join("\n\n");
  }

  async createDeployment(sha: string, summary: string): Promise<DeployRecord> {
    const { data } = await this.octokit.repos.createDeployment({
      owner: this.owner,
      repo: this.repo,
      ref: sha,
      environment: this.envName,
      description: summary,
      auto_merge: false,
      required_contexts: [],
    });
    if (!("id" in data)) {
      throw new Error(`Deployment rejected: ${JSON.stringify(data)}`);
    }
    await this.octokit.repos.createDeploymentStatus({
      owner: this.owner,
      repo: this.repo,
      deployment_id: data.id,
      state: "success",
      description: summary,
      environment: this.envName,
    });
    return {
      sha: data.sha,
      environment: data.environment ?? this.envName,
      description: data.description ?? summary,
      createdAt: data.created_at,
      id: data.id,
    };
  }

  async openRevertPr(input: OpenRevertPrInput): Promise<PrRecord> {
    const { data: bad } = await this.octokit.repos.getCommit({
      owner: this.owner,
      repo: this.repo,
      ref: input.sha,
    });
    const restoreSha = input.restoreSha ?? bad.parents[0]?.sha ?? input.sha;
    const branch = `incident/revert-${input.sha.slice(0, 8)}-${Date.now()}`;

    // Create branch from restoreSha, then copy service files from restore onto branch tip
    // Strategy: branch from current default, then set service files to restoreSha contents
    const { data: repo } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    const defaultBranch = repo.default_branch;
    const { data: baseRef } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${defaultBranch}`,
    });
    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branch}`,
      sha: baseRef.object.sha,
    });

    // Get tree of restoreSha for service path and apply as a commit on the branch
    const serviceFiles = await this.listServiceFilesAt(restoreSha);
    const treeItems = await Promise.all(
      serviceFiles.map(async (path) => {
        const content = await this.getFile(restoreSha, path);
        const blob = await this.octokit.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: Buffer.from(content).toString("base64"),
          encoding: "base64",
        });
        return {
          path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.data.sha,
        };
      }),
    );

    const { data: baseCommit } = await this.octokit.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: baseRef.object.sha,
    });
    const { data: tree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.tree.sha,
      tree: treeItems,
    });
    const { data: commit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: input.title,
      tree: tree.sha,
      parents: [baseRef.object.sha],
    });
    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });

    const { data: pr } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title: input.title,
      body: input.body,
      head: branch,
      base: defaultBranch,
    });

    return {
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
      headSha: commit.sha,
      baseSha: baseRef.object.sha,
    };
  }

  private async listServiceFilesAt(sha: string): Promise<string[]> {
    const { data } = await this.octokit.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: sha,
      recursive: "true",
    });
    return (data.tree ?? [])
      .filter(
        (t) =>
          t.type === "blob" &&
          t.path?.startsWith(SERVICE_PREFIX) &&
          t.path.endsWith(".ts"),
      )
      .map((t) => t.path!);
  }

  async mergePr(number: number): Promise<{ sha: string; merged: boolean }> {
    const { data } = await this.octokit.pulls.merge({
      owner: this.owner,
      repo: this.repo,
      pull_number: number,
      merge_method: "squash",
    });
    await this.deletePrHeadBranch(number).catch((err) => {
      console.warn(
        "[github] delete head branch after merge failed",
        number,
        err,
      );
    });
    return { sha: data.sha, merged: data.merged };
  }

  async closePr(number: number): Promise<void> {
    await this.octokit.pulls.update({
      owner: this.owner,
      repo: this.repo,
      pull_number: number,
      state: "closed",
    });
    await this.deletePrHeadBranch(number).catch((err) => {
      console.warn(
        "[github] delete head branch after close failed",
        number,
        err,
      );
    });
  }

  /** Drop incident/* head branches so closed/merged PRs stop cluttering the remote graph. */
  private async deletePrHeadBranch(number: number): Promise<void> {
    const { data: pr } = await this.octokit.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: number,
    });
    const head = pr.head.ref;
    if (!head) return;

    const { data: repo } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    if (head === repo.default_branch) return;

    // Only auto-delete remediation branches we created (never user feature branches).
    if (!head.startsWith("incident/")) return;

    // Same-repo PRs only — ignore forks.
    if (pr.head.repo && pr.head.repo.full_name !== pr.base.repo.full_name) {
      return;
    }

    try {
      await this.octokit.git.deleteRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${head}`,
      });
    } catch (err: unknown) {
      const status =
        err && typeof err === "object" && "status" in err
          ? Number((err as { status: number }).status)
          : null;
      // Already deleted or protected.
      if (status === 404 || status === 422) return;
      throw err;
    }
  }

  async checkoutDeployed(sha: string): Promise<string> {
    mkdirSync(this.workRoot, { recursive: true });
    const dest = join(this.workRoot, sha.slice(0, 12));
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
    }
    mkdirSync(dest, { recursive: true });
    const files = await this.listServiceFilesAt(sha);
    for (const path of files) {
      const rel = path.slice(SERVICE_PREFIX.length);
      const content = await this.getFile(sha, path);
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
    const { data: repo } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    const branch = input.branch ?? repo.default_branch;
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
    });
    const baseSha = ref.object.sha;
    const { data: baseCommit } = await this.octokit.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: baseSha,
    });

    const treeItems = await Promise.all(
      input.files.map(async (f) => {
        const path = f.path.startsWith(SERVICE_PREFIX)
          ? f.path
          : `${SERVICE_PREFIX}${f.path.replace(/^\//, "")}`;
        const blob = await this.octokit.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: Buffer.from(f.content).toString("base64"),
          encoding: "base64",
        });
        return {
          path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.data.sha,
        };
      }),
    );

    const { data: tree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.tree.sha,
      tree: treeItems,
    });
    const { data: commit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message: input.message,
      tree: tree.sha,
      parents: [baseSha],
    });
    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });

    // Keep local working tree in sync when we're in the same repo
    try {
      const root = gitRoot();
      execFileSync("git", ["fetch", "origin", branch], {
        cwd: root,
        stdio: "ignore",
      });
      // Update local service files from the commit we just pushed
      for (const f of input.files) {
        const rel = f.path.startsWith(SERVICE_PREFIX)
          ? f.path
          : `${SERVICE_PREFIX}${f.path.replace(/^\//, "")}`;
        const out = join(root, rel);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, f.content, "utf8");
      }
    } catch {
      // local sync is best-effort
    }

    return { sha: commit.sha };
  }
}
