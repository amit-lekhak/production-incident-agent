import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FaultScenario } from "@/lib/sim/types";

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
    const content = readFileSync(join(PATCH_ROOT, scenario, base), "utf8");
    return { path: `services/relay-checkout/${rel}`, content };
  });
}

export function loadHealthyServiceFiles(): Array<{
  path: string;
  content: string;
}> {
  const root = join(process.cwd(), "services/relay-checkout");
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
