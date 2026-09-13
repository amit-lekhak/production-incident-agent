import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeDump, operatorSummary, eventKindLabel } from "./labels";
import { formatRelativeTime, formatOpenedAgo } from "./time";

describe("operatorSummary", () => {
  it("replaces metric dumps with plain prose", () => {
    const out = operatorSummary({
      cause: "n_plus_one",
      action: "revert_pr",
      target: "42623a840643ae3b",
      summary:
        "catalog.lookup avg=13ms lookups/req≈3.0 after deploy 42623a840643; similar: test-resolved → n/a",
    });
    assert.equal(looksLikeDump(out), false);
    assert.match(out, /N\+1 catalog lookups/);
    assert.match(out, /42623a8/);
    assert.doesNotMatch(out, /catalog\.lookup/);
  });

  it("keeps short plain summaries", () => {
    const plain =
      "Catalog lookups spiked after the last deploy. Recommend revert.";
    const out = operatorSummary({
      cause: "n_plus_one",
      action: "revert_pr",
      target: "abc",
      summary: plain,
    });
    assert.equal(out, plain);
  });
});

describe("eventKindLabel", () => {
  it("maps known kinds", () => {
    assert.equal(eventKindLabel("pr_opened"), "Opened revert PR");
    assert.equal(eventKindLabel("awaiting_review"), "Waiting for your review");
  });
});

describe("formatRelativeTime", () => {
  it("formats recent times without GMT", () => {
    const ago = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const rel = formatRelativeTime(ago);
    assert.match(rel, /minute/);
    assert.doesNotMatch(rel, /GMT|UTC|\+00/);
    assert.match(formatOpenedAgo(ago), /Opened/);
  });
});
