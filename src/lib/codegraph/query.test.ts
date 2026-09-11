import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeExplain, codePath, codeQuery } from "./query";
import { isBlockedPath } from "./types";

describe("codegraph", () => {
  it("blocks lockfiles and node_modules", () => {
    assert.equal(isBlockedPath("node_modules/foo"), true);
    assert.equal(isBlockedPath("pnpm-lock.yaml"), true);
    assert.equal(isBlockedPath("src/checkout.ts"), false);
  });

  it("queries N+1 helper without dumping the graph", () => {
    const res = codeQuery("N+1 catalog lookupProductNPlusOne", 800);
    assert.ok(res.tokensApprox <= 900);
    assert.ok(!res.text.includes("node_modules"));
    assert.ok(!res.text.includes("pnpm-lock"));
    assert.match(res.text, /lookupProductNPlusOne|catalog/);
  });

  it("explains and paths between checkout and catalog", () => {
    const ex = codeExplain("lookupProductNPlusOne");
    assert.equal(ex.found, true);
    const path = codePath("checkout", "lookupProduct");
    assert.ok(path.path.length >= 2);
  });
});
