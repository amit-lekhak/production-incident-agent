import "../src/lib/load-env";
import { sql } from "../src/lib/db";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

async function wipe() {
  await sql`
    TRUNCATE
      postmortems,
      actions,
      reviews,
      recommendations,
      hypotheses,
      incident_events,
      incidents,
      active_faults,
      feature_flags,
      db_timings,
      error_events,
      traces,
      log_lines,
      metric_samples,
      alert_rules,
      commits,
      deployments,
      services
    RESTART IDENTITY CASCADE
  `;
}

async function seed() {
  await wipe();

  const [service] = await sql<{ id: number }[]>`
    INSERT INTO services (name, slug, description)
    VALUES (
      'Relay Checkout',
      'relay-checkout',
      'Simulated checkout API used for incident response demos'
    )
    RETURNING id
  `;
  const serviceId = service!.id;

  await sql`
    INSERT INTO deployments (service_id, sha, version, status, summary, deployed_at)
    VALUES (
      ${serviceId},
      'def456healthy',
      'v1.3.0',
      'rolled_back',
      'Baseline before N+1 regression',
      NOW() - INTERVAL '14 days'
    )
  `;

  await sql`
    INSERT INTO deployments (service_id, sha, version, status, summary, deployed_at)
    VALUES (
      ${serviceId},
      'aaa111stable',
      'v1.4.2',
      'active',
      'Stable checkout with batched catalog lookups',
      NOW() - INTERVAL '2 days'
    )
  `;

  await sql`
    INSERT INTO commits (service_id, sha, message, author, files_changed, committed_at)
    VALUES
      (
        ${serviceId},
        'aaa111stable',
        'perf: batch catalog lookups in checkout',
        'sam@relay.dev',
        ${jsonb(["src/checkout.ts", "src/catalog.ts"])},
        NOW() - INTERVAL '2 days'
      ),
      (
        ${serviceId},
        'abc123nplus1',
        'feat: per-item product enrichment (introduces N+1)',
        'dev@relay.dev',
        ${jsonb(["src/checkout.ts", "src/catalog.ts"])},
        NOW() - INTERVAL '30 minutes'
      ),
      (
        ${serviceId},
        'pay789timeout',
        'feat: new payments retry path',
        'pay@relay.dev',
        ${jsonb(["src/payments.ts", "src/checkout.ts"])},
        NOW() - INTERVAL '20 minutes'
      ),
      (
        ${serviceId},
        'err321null',
        'fix: handle empty cart metadata',
        'dev@relay.dev',
        ${jsonb(["src/checkout.ts"])},
        NOW() - INTERVAL '15 minutes'
      ),
      (
        ${serviceId},
        'pool654cfg',
        'chore: shrink db pool to 2 for cost',
        'ops@relay.dev',
        ${jsonb(["src/checkout.ts"])},
        NOW() - INTERVAL '10 minutes'
      )
  `;

  await sql`
    INSERT INTO alert_rules (service_id, name, metric, operator, threshold, window_seconds, enabled)
    VALUES
      (${serviceId}, 'Checkout latency p95', 'checkout_latency_p95', '>', 2000, 60, true),
      (${serviceId}, 'Checkout error rate', 'checkout_error_rate', '>', 0.05, 60, true),
      (${serviceId}, 'DB pool wait', 'db_pool_wait_ms', '>', 500, 60, true)
  `;

  await sql`
    INSERT INTO feature_flags (service_id, key, enabled, description)
    VALUES
      (${serviceId}, 'payments_v2', true, 'Route charges through payments v2 client'),
      (${serviceId}, 'catalog_enrichment', true, 'Per-item catalog enrichment (N+1 when faulty)')
  `;

  for (let i = 12; i >= 0; i--) {
    const at = new Date(Date.now() - i * 30_000).toISOString();
    await sql`
      INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
      VALUES
        (${serviceId}, 'checkout_latency_p95', ${180 + Math.random() * 40}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
        (${serviceId}, 'checkout_error_rate', ${0.001 + Math.random() * 0.002}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
        (${serviceId}, 'db_pool_wait_ms', ${5 + Math.random() * 10}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
        (${serviceId}, 'payments_latency_p99', ${50 + Math.random() * 30}, ${jsonb({ dependency: "payments" })}, ${at}::timestamptz)
    `;
  }

  const [hist] = await sql<{ id: string }[]>`
    INSERT INTO incidents (
      service_id, title, status, severity, trigger_metric, trigger_value,
      suspect_deploy_sha, opened_at, resolved_at, updated_at
    )
    VALUES (
      ${serviceId},
      'Historical: checkout latency after N+1 deploy',
      'resolved',
      'high',
      'checkout_latency_p95',
      3200,
      'def456healthy',
      NOW() - INTERVAL '14 days',
      NOW() - INTERVAL '14 days' + INTERVAL '45 minutes',
      NOW() - INTERVAL '14 days' + INTERVAL '45 minutes'
    )
    RETURNING id::text AS id
  `;

  const [hyp] = await sql<{ id: number }[]>`
    INSERT INTO hypotheses (incident_id, rank, cause_type, suspect_deploy, supporting_tool_names, why)
    VALUES (
      ${hist!.id}::uuid,
      1,
      'n_plus_one',
      'oldnplus1sha',
      ${jsonb(["query_traces", "query_db_timings", "list_deployments"])},
      'Catalog span count scaled with cart size after deploy; rollback restored p95.'
    )
    RETURNING id
  `;

  await sql`
    INSERT INTO recommendations (
      incident_id, winning_hypothesis_id, confidence, evidence,
      recommended_action, action_target, summary
    )
    VALUES (
      ${hist!.id}::uuid,
      ${hyp!.id},
      91,
      ${jsonb([
        {
          tool: "query_traces",
          display: "catalog.lookup × N per request",
          supports: true,
        },
        {
          tool: "list_deployments",
          display: "deploy oldnplus1sha active at onset",
          supports: true,
        },
      ])},
      'rollback',
      'oldnplus1sha',
      'Rollback cleared N+1 catalog lookups; latency returned under 300ms.'
    )
  `;

  await sql`
    INSERT INTO actions (incident_id, kind, target, status, result, executed_at)
    VALUES (
      ${hist!.id}::uuid,
      'rollback',
      'oldnplus1sha',
      'succeeded',
      ${jsonb({ previousSha: "oldnplus1sha", activeSha: "def456healthy" })},
      NOW() - INTERVAL '14 days' + INTERVAL '30 minutes'
    )
  `;

  await sql`
    INSERT INTO postmortems (
      incident_id, title, summary, timeline, root_cause, impact, resolution, action_items
    )
    VALUES (
      ${hist!.id}::uuid,
      'Postmortem: N+1 catalog lookups in checkout',
      'A deploy switched checkout to per-item catalog lookups. p95 crossed 2s. Rollback restored SLOs.',
      ${jsonb([
        { at: "-14d", event: "Deploy shipped per-item enrichment" },
        { at: "-14d+5m", event: "Latency alert fired" },
        { at: "-14d+30m", event: "Rollback approved and executed" },
      ])},
      'N+1 product lookups in checkout path after enrichment feature.',
      'Elevated checkout latency for ~30 minutes; no payment failures.',
      'Rolled back to previous deploy; added eval for catalog span count vs cart size.',
      ${jsonb([
        "Add span budget alert for catalog.lookup count",
        "Require load test for cart-size scaling before merge",
      ])}
    )
  `;

  await sql`
    INSERT INTO incident_events (incident_id, kind, message, meta)
    VALUES
      (${hist!.id}::uuid, 'detected', 'Alert Checkout latency p95 fired', ${jsonb({})}),
      (${hist!.id}::uuid, 'resolved', 'Rollback verified; incident closed', ${jsonb({})})
  `;

  console.log(`Seeded Relay Checkout service id=${serviceId}`);
  console.log(`Historical twin incident id=${hist!.id}`);
}

seed()
  .then(async () => {
    await sql.end({ timeout: 1 });
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await sql.end({ timeout: 1 });
    process.exit(1);
  });
