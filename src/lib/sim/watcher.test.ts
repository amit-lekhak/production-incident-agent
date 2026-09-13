import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "../load-env";
import { sql } from "../db";
import { getServiceId } from "./faults";
import { runWatcher } from "./watcher";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

describe("watcher window", () => {
  it("does not open on a single out-of-window spike", async () => {
    const prev = process.env.AUTO_DIAGNOSE;
    process.env.AUTO_DIAGNOSE = "false";
    try {
      const serviceId = await getServiceId();
      const [rule] = await sql<{ id: number; window_seconds: number }[]>`
      SELECT id, window_seconds FROM alert_rules
      WHERE service_id = ${serviceId} AND metric = 'checkout_latency_p95'
      LIMIT 1
    `;
      assert.ok(rule);

      // Close any open latency incidents for this rule
      await sql`
      UPDATE incidents
      SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
      WHERE service_id = ${serviceId}
        AND alert_rule_id = ${rule.id}
        AND status NOT IN ('resolved', 'closed_rejected')
    `;

      await sql`
      DELETE FROM metric_samples
      WHERE service_id = ${serviceId} AND name = 'checkout_latency_p95'
    `;

      // Old spike outside the window
      await sql`
      INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
      VALUES (
        ${serviceId},
        'checkout_latency_p95',
        9000,
        ${jsonb({})},
        NOW() - make_interval(secs => ${rule.window_seconds + 30})
      )
    `;

      // Healthy samples inside the window
      await sql`
      INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
      VALUES
        (${serviceId}, 'checkout_latency_p95', 400, ${jsonb({})}, NOW() - INTERVAL '10 seconds'),
        (${serviceId}, 'checkout_latency_p95', 450, ${jsonb({})}, NOW())
    `;

      const results = await runWatcher();
      const latency = results.find(
        (r) => r.opened && r.metric === "checkout_latency_p95",
      );
      assert.equal(latency, undefined);

      const closed = results.find(
        (r) =>
          !r.opened &&
          (r.reason.includes("checkout_latency_p95 ok") ||
            /Checkout latency ok/i.test(r.reason)),
      );
      assert.ok(closed, `expected ok reason, got ${JSON.stringify(results)}`);
    } finally {
      if (prev === undefined) delete process.env.AUTO_DIAGNOSE;
      else process.env.AUTO_DIAGNOSE = prev;
    }
  });

  it("opens when window p95 exceeds threshold", async () => {
    const prev = process.env.AUTO_DIAGNOSE;
    process.env.AUTO_DIAGNOSE = "false";
    try {
      const serviceId = await getServiceId();
      const [rule] = await sql<{ id: number }[]>`
      SELECT id FROM alert_rules
      WHERE service_id = ${serviceId} AND metric = 'checkout_latency_p95'
      LIMIT 1
    `;
      assert.ok(rule);

      await sql`
      UPDATE incidents
      SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
      WHERE service_id = ${serviceId}
        AND alert_rule_id = ${rule.id}
        AND status NOT IN ('resolved', 'closed_rejected')
    `;

      await sql`
      DELETE FROM metric_samples
      WHERE service_id = ${serviceId} AND name = 'checkout_latency_p95'
    `;

      await sql`
      INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
      VALUES
        (${serviceId}, 'checkout_latency_p95', 3000, ${jsonb({})}, NOW() - INTERVAL '5 seconds'),
        (${serviceId}, 'checkout_latency_p95', 3500, ${jsonb({})}, NOW())
    `;

      const results = await runWatcher();
      const opened = results.find(
        (r) => r.opened && "metric" in r && r.metric === "checkout_latency_p95",
      );
      assert.ok(opened?.opened);
    } finally {
      if (prev === undefined) delete process.env.AUTO_DIAGNOSE;
      else process.env.AUTO_DIAGNOSE = prev;
    }
  });
});
