import assert from "node:assert/strict";
import { describe, it, after, before } from "node:test";
import {
  ORACLE_CASES,
  runOracleCase,
  setupOracleEnv,
  teardownOracleEnv,
} from "./oracle";
import { sql } from "../src/lib/db";

describe("oracle evals", () => {
  before(async () => {
    await setupOracleEnv();
  });
  after(async () => {
    teardownOracleEnv();
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
