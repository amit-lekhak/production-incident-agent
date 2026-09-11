import "../src/lib/load-env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORACLE_CASES, runOracleCase } from "./oracle";
import { sql } from "../src/lib/db";

async function main() {
  const results = [];
  for (const c of ORACLE_CASES) {
    const r = await runOracleCase(c);
    results.push(r);
    console.log(
      `${r.pass ? "PASS" : "FAIL"} ${r.id} cause=${r.cause} action=${r.action}`,
    );
  }
  const dir = join(process.cwd(), "evals/results");
  mkdirSync(dir, { recursive: true });
  const path = join(
    dir,
    `${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(path, JSON.stringify({ results }, null, 2));
  console.log(`Wrote ${path}`);
  const failed = results.filter((r) => !r.pass);
  await sql.end({ timeout: 1 });
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
