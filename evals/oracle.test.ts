import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import { ORACLE_CASES, runOracleCase } from "./oracle";
import { sql } from "../src/lib/db";

describe("oracle evals", () => {
  after(async () => {
    await sql.end({ timeout: 1 });
  });

  for (const c of ORACLE_CASES) {
    it(c.id, async () => {
      const result = await runOracleCase(c);
      assert.equal(result.pass, true, JSON.stringify(result));
      assert.ok(result.confidence >= 70);
    });
  }
});
