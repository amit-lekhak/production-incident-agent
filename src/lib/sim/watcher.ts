import { sql } from "@/lib/db";
import { getServiceId } from "./faults";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export type WatchResult =
  | { opened: false; reason: string; incidentId?: string }
  | {
      opened: true;
      incidentId: string;
      title: string;
      metric: string;
      value: number;
    };

export async function runWatcher(): Promise<WatchResult[]> {
  const serviceId = await getServiceId();
  const rules = await sql<
    {
      id: number;
      name: string;
      metric: string;
      operator: string;
      threshold: number;
      window_seconds: number;
    }[]
  >`
    SELECT id, name, metric, operator, threshold, window_seconds
    FROM alert_rules
    WHERE service_id = ${serviceId} AND enabled = true
  `;

  const results: WatchResult[] = [];

  for (const rule of rules) {
    const [sample] = await sql<{ value: number }[]>`
      SELECT value FROM metric_samples
      WHERE service_id = ${serviceId} AND name = ${rule.metric}
      ORDER BY sampled_at DESC
      LIMIT 1
    `;
    if (!sample) {
      results.push({ opened: false, reason: `no sample for ${rule.metric}` });
      continue;
    }

    const fired =
      rule.operator === ">"
        ? sample.value > rule.threshold
        : rule.operator === ">="
          ? sample.value >= rule.threshold
          : false;

    if (!fired) {
      results.push({
        opened: false,
        reason: `${rule.metric} ok (${sample.value})`,
      });
      continue;
    }

    const [existing] = await sql<{ id: string }[]>`
      SELECT id::text AS id FROM incidents
      WHERE service_id = ${serviceId}
        AND alert_rule_id = ${rule.id}
        AND status IN (
          'detected', 'investigating', 'awaiting_review',
          'acting', 'verifying', 'needs_human'
        )
      ORDER BY opened_at DESC
      LIMIT 1
    `;

    if (existing) {
      await sql`
        INSERT INTO incident_events (incident_id, kind, message, meta)
        VALUES (
          ${existing.id}::uuid,
          'alert_repeat',
          ${`Alert ${rule.name} still firing (${sample.value})`},
          ${jsonb({ metric: rule.metric, value: sample.value })}
        )
      `;
      results.push({
        opened: false,
        reason: "deduped",
        incidentId: existing.id,
      });
      continue;
    }

    const [deploy] = await sql<{ sha: string }[]>`
      SELECT sha FROM deployments
      WHERE service_id = ${serviceId} AND status = 'active'
      ORDER BY deployed_at DESC LIMIT 1
    `;

    const title = `${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (now ${Math.round(sample.value * 1000) / 1000})`;
    const [incident] = await sql<{ id: string }[]>`
      INSERT INTO incidents (
        service_id, alert_rule_id, title, status, severity,
        trigger_metric, trigger_value, suspect_deploy_sha, opened_at, updated_at
      )
      VALUES (
        ${serviceId},
        ${rule.id},
        ${title},
        'detected',
        'high',
        ${rule.metric},
        ${sample.value},
        ${deploy?.sha ?? null},
        NOW(),
        NOW()
      )
      RETURNING id::text AS id
    `;

    await sql`
      INSERT INTO incident_events (incident_id, kind, message, meta)
      VALUES (
        ${incident!.id}::uuid,
        'detected',
        ${`Watcher opened incident for ${rule.name}`},
        ${jsonb({ metric: rule.metric, value: sample.value, deploy: deploy?.sha ?? null })}
      )
    `;

    results.push({
      opened: true,
      incidentId: incident!.id,
      title,
      metric: rule.metric,
      value: sample.value,
    });
  }

  return results;
}

const globalWatch = globalThis as unknown as {
  __relayWatcher?: {
    timer: ReturnType<typeof setInterval> | null;
    running: boolean;
  };
};

export function ensureWatcher() {
  if (!globalWatch.__relayWatcher) {
    globalWatch.__relayWatcher = { timer: null, running: false };
  }
  const state = globalWatch.__relayWatcher;
  if (state.timer) return;
  const interval = Number(process.env.WATCHER_INTERVAL_MS ?? 5000);
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    runWatcher()
      .catch((err) => console.error("[watcher]", err))
      .finally(() => {
        state.running = false;
      });
  }, interval);
}
