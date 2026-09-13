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

function looksHealthy(
  files: Array<{ path: string; content: string }>,
): boolean {
  const byRel = new Map(
    files.map((f) => [
      f.path.replace(/^services\/relay-checkout\//, ""),
      f.content,
    ]),
  );
  const pool = byRel.get("src/pool.ts") ?? "";
  const checkout = byRel.get("src/checkout.ts") ?? "";
  if (/DB_POOL_SIZE\s*=\s*2\b/.test(pool)) return false;
  if (checkout.includes("lookupProductNPlusOne")) return false;
  if (checkout.includes("chargePaymentSlow")) return false;
  if (/meta!\.source|req\.meta!\.source/.test(checkout)) return false;
  return byRel.has("src/checkout.ts") && byRel.has("src/pool.ts");
}

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
    // Patches live on the default branch tip — not on a chaos deploy SHA.
    const sha = await provider.defaultBranchSha();
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
  if (local.length > 0 && looksHealthy(local)) return local;

  if (local.length > 0) {
    console.warn(
      "[patches] local Relay Checkout tree looks like a chaos deploy; using default-branch HEAD",
    );
  } else {
    console.warn(
      "[patches] local Relay Checkout tree missing; using default-branch HEAD",
    );
  }

  const { getReleaseProvider } = await import("@/lib/release");
  const provider = getReleaseProvider();
  // Never use currentDeploy() — that SHA may still be a chaos commit.
  const sha = await provider.defaultBranchSha();
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
  if (!looksHealthy(out)) {
    // Default branch tip may still be a leftover chaos commit. Force a clean baseline
    // so scenarios do not stack (payment_timeout must not keep pool=2).
    console.warn(
      "[patches] default-branch HEAD still had chaos markers; forcing healthy pool + checkout",
    );
    const healthyCheckout = `/**
 * Relay Checkout — the production TypeScript service under incident response.
 * Live at the GitHub-deployed SHA. Edit here to introduce bugs and real history.
 */
import { lookupProduct } from "./catalog";
import { chargePayment } from "./payments";
import { DB_POOL_SIZE } from "./pool";

export type CheckoutItem = { productId: string; qty: number };
export type CheckoutRequest = {
  cartId: string;
  items: CheckoutItem[];
  paymentMethod: string;
  meta?: { source?: string } | null;
};

export async function checkout(req: CheckoutRequest) {
  const source = req.meta?.source ?? "web";
  void DB_POOL_SIZE;
  const products = await Promise.all(
    req.items.map((i) => lookupProduct(i.productId)),
  );
  const total = products.reduce(
    (sum, p, idx) => sum + p.priceCents * req.items[idx]!.qty,
    0,
  );
  const payment = await chargePayment({
    amountCents: total,
    method: req.paymentMethod,
  });
  return {
    orderId: \`ord_\${req.cartId}\`,
    totalCents: total,
    paymentId: payment.id,
    source,
  };
}
`;
    return out.map((f) => {
      if (f.path.endsWith("src/pool.ts")) {
        return {
          ...f,
          content:
            "/** Connection pool size for Relay Checkout (healthy default). */\nexport const DB_POOL_SIZE = 10;\n",
        };
      }
      if (f.path.endsWith("src/checkout.ts")) {
        return { ...f, content: healthyCheckout };
      }
      return f;
    });
  }
  return out;
}
