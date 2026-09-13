import "../src/lib/load-env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVAL_CASES } from "./cases";
import { ORACLE_CASES, runOracleCase } from "./oracle";
import { runAgentCase } from "./agent";
import { sql } from "../src/lib/db";
import { hasGeminiKey, getEnv } from "../src/lib/env";

function parseFlags(argv: string[]) {
  return {
    oracleOnly: argv.includes("--oracle-only"),
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const results: unknown[] = [];

  console.log("=== oracle ===");
  for (const c of ORACLE_CASES) {
    const r = await runOracleCase(c);
    results.push({ layer: "oracle", ...r });
    console.log(
      `${r.pass ? "PASS" : "FAIL"} oracle ${r.id} cause=${r.cause} action=${r.action}`,
    );
  }

  if (!flags.oracleOnly) {
    getEnv();
    if (!hasGeminiKey()) {
      console.error(
        "GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) required for agent evals. Use --oracle-only to skip.",
      );
      await sql.end({ timeout: 1 });
      process.exit(1);
    }

    console.log("=== gemini agent ===");
    for (const c of EVAL_CASES) {
      const r = await runAgentCase(c);
      results.push({ layer: "agent", ...r });
      const failed = r.score.checks.filter((ch) => !ch.ok);
      console.log(
        `${r.pass ? "PASS" : "FAIL"} agent ${r.id} cause=${r.cause} action=${r.action} ${r.latency_ms}ms`,
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
  await sql.end({ timeout: 1 });
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
