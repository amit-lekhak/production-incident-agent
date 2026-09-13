import { createJiti } from "jiti";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getReleaseProvider } from "@/lib/release";
import { worktreeRoot } from "@/lib/release/worktree-root";
import type { FaultScenario } from "./types";

export type CheckoutSpan = {
  name: string;
  durationMs: number;
  status: string;
  attrs?: Record<string, unknown>;
};

export type DeployedCheckoutModule = {
  checkout: (req: {
    cartId: string;
    items: Array<{ productId: string; qty: number }>;
    paymentMethod: string;
    meta?: { source?: string } | null;
    flags?: { payments_v2?: boolean };
  }) => Promise<{
    orderId: string;
    totalCents: number;
    paymentId: string;
    source?: string;
  }>;
};

export type DeployedRuntime = {
  sha: string;
  workDir: string;
  /** Internal only — never expose to agent tools or logs. */
  scenario: FaultScenario | null;
  poolSize: number;
  module: DeployedCheckoutModule | null;
  takeSpans: () => CheckoutSpan[];
};

let runtime: DeployedRuntime | null = null;

function inferScenario(workDir: string): {
  scenario: FaultScenario | null;
  poolSize: number;
} {
  const checkout = readFileSync(join(workDir, "src/checkout.ts"), "utf8");
  const poolPath = join(workDir, "src/pool.ts");
  const pool = existsSync(poolPath) ? readFileSync(poolPath, "utf8") : "";
  const poolMatch = /DB_POOL_SIZE\s*=\s*(\d+)/.exec(pool);
  const poolSize = poolMatch ? Number(poolMatch[1]) : 10;

  if (checkout.includes("lookupProductNPlusOne")) {
    return { scenario: "n_plus_one", poolSize };
  }
  if (checkout.includes("chargePaymentSlow")) {
    return { scenario: "payment_timeout", poolSize };
  }
  if (checkout.includes("req.meta!.source") || /meta!\.source/.test(checkout)) {
    return { scenario: "error_spike", poolSize };
  }
  if (poolSize <= 2) {
    return { scenario: "pool_exhaustion", poolSize };
  }
  return { scenario: null, poolSize };
}

async function loadModule(workDir: string): Promise<{
  module: DeployedCheckoutModule | null;
  takeSpans: () => CheckoutSpan[];
}> {
  const noop = () => [] as CheckoutSpan[];
  try {
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      moduleCache: false,
    });
    const mod = jiti(
      join(workDir, "src/checkout.ts"),
    ) as DeployedCheckoutModule;
    let takeSpans = noop;
    try {
      const spansMod = jiti(join(workDir, "src/spans.ts")) as {
        takeSpans?: () => CheckoutSpan[];
      };
      if (typeof spansMod.takeSpans === "function") {
        takeSpans = () => spansMod.takeSpans!();
      }
    } catch {
      // Older deploys without spans.ts
    }
    if (typeof mod.checkout === "function") {
      return { module: mod, takeSpans };
    }
    return { module: null, takeSpans: noop };
  } catch (err) {
    console.warn(
      "[deployed-runtime] jiti load failed, using inferred timings",
      err,
    );
    return { module: null, takeSpans: noop };
  }
}

export function getDeployedRuntime(): DeployedRuntime | null {
  return runtime;
}

function materializeWorktree(
  sha: string,
  files: Array<{ path: string; content: string }>,
): string {
  const dest = join(
    /*turbopackIgnore: true*/ worktreeRoot(),
    sha.slice(0, 12) || "local",
  );
  if (existsSync(/*turbopackIgnore: true*/ dest)) {
    rmSync(/*turbopackIgnore: true*/ dest, { recursive: true, force: true });
  }
  mkdirSync(/*turbopackIgnore: true*/ dest, { recursive: true });
  for (const f of files) {
    const rel = f.path
      .replace(/^services\/relay-checkout\//, "")
      .replace(/^\//, "");
    if (!rel) continue;
    const out = join(/*turbopackIgnore: true*/ dest, rel);
    mkdirSync(/*turbopackIgnore: true*/ dirname(out), { recursive: true });
    writeFileSync(/*turbopackIgnore: true*/ out, f.content, "utf8");
  }
  return dest;
}

async function setRuntime(
  sha: string,
  workDir: string,
): Promise<DeployedRuntime> {
  const inferred = inferScenario(workDir);
  const loaded = await loadModule(workDir);
  runtime = {
    sha,
    workDir,
    scenario: inferred.scenario,
    poolSize: inferred.poolSize,
    module: loaded.module,
    takeSpans: loaded.takeSpans,
  };
  return runtime;
}

export async function activateDeployedSha(
  sha: string,
): Promise<DeployedRuntime> {
  const provider = getReleaseProvider();
  const workDir = await provider.checkoutDeployed(sha);
  return setRuntime(sha, workDir);
}

/** Activate without a second GitHub download (inject already has the tree). */
export async function activateFromFiles(
  sha: string,
  files: Array<{ path: string; content: string }>,
): Promise<DeployedRuntime> {
  return setRuntime(sha, materializeWorktree(sha, files));
}

/** Sync runtime from current GitHub production deploy (boot / after merge). */
export async function syncRuntimeFromCurrentDeploy(): Promise<DeployedRuntime | null> {
  const provider = getReleaseProvider();
  const deploy = await provider.currentDeploy();
  if (!deploy) {
    const local = join(process.cwd(), "services/relay-checkout");
    if (!existsSync(join(local, "src/checkout.ts"))) return null;
    const inferred = inferScenario(local);
    const loaded = await loadModule(local);
    runtime = {
      sha: "local-workspace",
      workDir: local,
      scenario: inferred.scenario,
      poolSize: inferred.poolSize,
      module: loaded.module,
      takeSpans: loaded.takeSpans,
    };
    return runtime;
  }
  return activateDeployedSha(deploy.sha);
}
