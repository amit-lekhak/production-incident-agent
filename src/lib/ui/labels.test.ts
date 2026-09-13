import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  looksLikeDump,
  operatorSummary,
  eventKindLabel,
  operatorIncidentTitle,
  operatorEventMessage,
  formatMetricValue,
} from "./labels";
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

describe("operatorIncidentTitle", () => {
  it("rewrites dump-style alert titles", () => {
    const out = operatorIncidentTitle(
      "DB pool wait: db_pool_wait_ms > 500 (avg 847.127 over 60s)",
    );
    assert.match(out, /DB pool wait elevated/);
    assert.match(out, /847ms/);
    assert.doesNotMatch(out, /db_pool_wait_ms/);
    assert.doesNotMatch(out, /847\.127/);
  });
});

describe("operatorEventMessage", () => {
  it("formats alert_repeat with units", () => {
    const out = operatorEventMessage({
      kind: "alert_repeat",
      message: "Alert DB pool wait still firing (p95 897.822)",
      meta: {
        metric: "db_pool_wait_ms",
        value: 897.822,
        label: "p95",
        windowSeconds: 60,
      },
    });
    assert.match(out, /Still elevated/);
    assert.match(out, /898ms|897ms/);
    assert.doesNotMatch(out, /897\.822/);
  });
});

describe("formatMetricValue", () => {
  it("uses ms and percent", () => {
    assert.equal(formatMetricValue("db_pool_wait_ms", 847.127), "847ms");
    assert.equal(formatMetricValue("checkout_error_rate", 0.052), "5.2%");
  });
});
