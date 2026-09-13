import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FaultScenario } from "@/lib/sim/types";

const SERVICE_REL_FILES = [
  "src/checkout.ts",
  "src/catalog.ts",
  "src/payments.ts",
  "src/pool.ts",
  "src/spans.ts",
  "package.json",
] as const;

const PATCH_ROOT = join(process.cwd(), "services/patches");

/** Map scenario → relative paths under services/relay-checkout to overwrite. */
const SCENARIO_FILES: Record<FaultScenario, string[]> = {
  n_plus_one: ["src/checkout.ts"],
  error_spike: ["src/checkout.ts"],
  pool_exhaustion: ["src/pool.ts"],
  payment_timeout: ["src/checkout.ts"],
};

export function loadScenarioPatch(
  scenario: FaultScenario,
): Array<{ path: string; content: string }> {
  const files = SCENARIO_FILES[scenario];
  return files.map((rel) => {
    const base = rel.split("/").pop()!;
    const disk = join(PATCH_ROOT, scenario, base);
    if (!existsSync(disk)) {
      throw new Error(`Chaos patch missing on disk: ${disk}`);
    }
    const content = readFileSync(disk, "utf8");
    return { path: `services/relay-checkout/${rel}`, content };
  });
}

export async function loadScenarioPatchSafe(
  scenario: FaultScenario,
): Promise<Array<{ path: string; content: string }>> {
  try {
    return loadScenarioPatch(scenario);
  } catch (err) {
    console.warn("[patches] disk patch missing, fetching from GitHub", err);
    const { getReleaseProvider } = await import("@/lib/release");
    const provider = getReleaseProvider();
    const sha = await resolveRepoSha();
    const files = SCENARIO_FILES[scenario];
    return Promise.all(
      files.map(async (rel) => {
        const repoPath = `services/patches/${scenario}/${rel.split("/").pop()}`;
        const content = await provider.getFile(sha, repoPath);
        return { path: `services/relay-checkout/${rel}`, content };
      }),
    );
  }
}

export function loadHealthyServiceFiles(): Array<{
  path: string;
  content: string;
}> {
  const root = join(process.cwd(), "services/relay-checkout");
  if (!existsSync(root)) return [];
  const out: Array<{ path: string; content: string }> = [];
  function walk(dir: string, prefix: string) {
    for (const name of readdirSync(dir)) {
      if (name === "graphify-out" || name === "node_modules") continue;
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (name.endsWith(".ts") || name === "package.json") {
        out.push({
          path: `services/relay-checkout/${rel}`,
          content: readFileSync(full, "utf8"),
        });
      }
    }
  }
  walk(root, "");
  return out;
}

export async function loadHealthyServiceFilesSafe(): Promise<
  Array<{ path: string; content: string }>
> {
  const local = loadHealthyServiceFiles().filter(
    (f) => f.path.endsWith(".ts") || f.path.endsWith("package.json"),
  );
  if (local.length > 0) return local;

  console.warn("[patches] local Relay Checkout tree missing; using GitHub");
  const { getReleaseProvider } = await import("@/lib/release");
  const provider = getReleaseProvider();
  const sha = await resolveRepoSha();
  const out: Array<{ path: string; content: string }> = [];
  for (const rel of SERVICE_REL_FILES) {
    try {
      const content = await provider.getFile(sha, rel);
      out.push({ path: `services/relay-checkout/${rel}`, content });
    } catch (err) {
      console.warn("[patches] skip", rel, err);
    }
  }
  if (out.length === 0) {
    throw new Error(
      "Relay Checkout sources not in the serverless bundle and GitHub had no service files. Check GITHUB_TOKEN / GITHUB_REPO and that services/relay-checkout exists on the default branch.",
    );
  }
  return out;
}

async function resolveRepoSha(): Promise<string> {
  const { getReleaseProvider } = await import("@/lib/release");
  const provider = getReleaseProvider();
  const deploy = await provider.currentDeploy();
  if (deploy?.sha) return deploy.sha;
  const commits = await provider.listCommits(1);
  if (commits[0]?.sha) return commits[0].sha;
  throw new Error(
    "No GitHub production deploy or service commits. Run pnpm service:bootstrap locally first.",
  );
}
