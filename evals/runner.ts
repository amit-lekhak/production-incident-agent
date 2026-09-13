import "./load-test-env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVAL_CASES } from "./cases";
import { ORACLE_CASES, runOracleCase } from "./oracle";
import { runAgentCase } from "./agent";
import { sql } from "../src/lib/db";
import { hasGeminiKey, getEnv } from "../src/lib/env";
import { clearFaults } from "../src/lib/sim/faults";

function parseFlags(argv: string[]) {
  return {
    oracleOnly: argv.includes("--oracle-only"),
  };
}

async function cleanup() {
  try {
    await clearFaults();
    console.log("[evals] cleared leftover faults");
  } catch (err) {
    console.warn("[evals] clearFaults failed", err);
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const results: unknown[] = [];

  const { setupOracleEnv, teardownOracleEnv } = await import("./oracle");
  await setupOracleEnv();

  try {
    console.log("=== oracle ===");
    for (const c of ORACLE_CASES) {
      const r = await runOracleCase(c);
      results.push({ layer: "oracle", ...r });
      console.log(
        `${r.pass ? "PASS" : "FAIL"} oracle ${r.id} headline=${JSON.stringify(r.headline)} action=${r.action}`,
      );
    }

    if (!flags.oracleOnly) {
      getEnv();
      if (!hasGeminiKey()) {
        console.error(
          "GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) required for agent evals. Use --oracle-only to skip.",
        );
        process.exitCode = 1;
        return;
      }

      console.log("=== gemini agent ===");
      for (const c of EVAL_CASES) {
        const r = await runAgentCase(c);
        results.push({ layer: "agent", ...r });
        const failed = r.score.checks.filter((ch) => !ch.ok);
        console.log(
          `${r.pass ? "PASS" : "FAIL"} agent ${r.id} headline=${JSON.stringify(r.cause)} action=${r.action} ${r.latency_ms}ms`,
        );
        if (!r.pass) {
          for (const ch of failed) {
            console.log(`  - ${ch.name}: ${ch.detail}`);
          }
        }
      }
    }

    const dir = join(process.cwd(), "evals/results");
    mkdirSync(dir, { recursive: true });
    const path = join(
      dir,
      `${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    writeFileSync(path, JSON.stringify({ results }, null, 2));
    console.log(`Wrote ${path}`);

    const failed = results.filter(
      (r) =>
        typeof r === "object" &&
        r &&
        "pass" in r &&
        !(r as { pass: boolean }).pass,
    );
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    await cleanup();
    teardownOracleEnv();
    await sql.end({ timeout: 1 });
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await clearFaults();
  } catch {
    /* ignore */
  }
  await sql.end({ timeout: 1 });
  process.exit(1);
});
