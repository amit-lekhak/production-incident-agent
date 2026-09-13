import { createJiti } from "jiti";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getReleaseProvider } from "@/lib/release";
import type { FaultScenario } from "./types";

export type DeployedCheckoutModule = {
  checkout: (req: {
    cartId: string;
    items: Array<{ productId: string; qty: number }>;
    paymentMethod: string;
    meta?: { source?: string } | null;
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
  scenario: FaultScenario | null;
  poolSize: number;
  module: DeployedCheckoutModule | null;
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

async function loadModule(
  workDir: string,
): Promise<DeployedCheckoutModule | null> {
  try {
    const jiti = createJiti(import.meta.url, {
      interopDefault: true,
      // Cache-bust when SHA changes
      moduleCache: false,
    });
    const mod = jiti(
      join(workDir, "src/checkout.ts"),
    ) as DeployedCheckoutModule;
    if (typeof mod.checkout === "function") return mod;
    return null;
  } catch (err) {
    console.warn(
      "[deployed-runtime] jiti load failed, using inferred timings",
      err,
    );
    return null;
  }
}

export function getDeployedRuntime(): DeployedRuntime | null {
  return runtime;
}

export async function activateDeployedSha(
  sha: string,
): Promise<DeployedRuntime> {
  const provider = getReleaseProvider();
  const workDir = await provider.checkoutDeployed(sha);
  const inferred = inferScenario(workDir);
  const module = await loadModule(workDir);
  runtime = {
    sha,
    workDir,
    scenario: inferred.scenario,
    poolSize: inferred.poolSize,
    module,
  };
  return runtime;
}

/** Sync runtime from current GitHub production deploy (boot / after merge). */
export async function syncRuntimeFromCurrentDeploy(): Promise<DeployedRuntime | null> {
  const provider = getReleaseProvider();
  const deploy = await provider.currentDeploy();
  if (!deploy) {
    // Fall back to in-tree healthy sources if no deployment yet
    const local = join(process.cwd(), "services/relay-checkout");
    if (!existsSync(join(local, "src/checkout.ts"))) return null;
    const inferred = inferScenario(local);
    const module = await loadModule(local);
    runtime = {
      sha: "local-workspace",
      workDir: local,
      scenario: inferred.scenario,
      poolSize: inferred.poolSize,
      module,
    };
    return runtime;
  }
  return activateDeployedSha(deploy.sha);
}
