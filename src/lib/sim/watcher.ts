import { appendIncidentEvent } from "@/lib/observability/incident-events";
import { sql } from "@/lib/db";
import { getServiceId } from "./faults";

export type WatchResult =
  | { opened: false; reason: string; incidentId?: string }
  | {
      opened: true;
      incidentId: string;
      title: string;
      metric: string;
      value: number;
    };

const OPEN_STATUSES = [
  "detected",
  "investigating",
  "awaiting_review",
  "acting",
  "verifying",
  "needs_human",
] as const;

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
    const windowSeconds = Math.max(1, rule.window_seconds || 60);
    const [agg] = await sql<
      { avg_value: number | null; sample_count: number }[]
    >`
      SELECT AVG(value)::float8 AS avg_value, COUNT(*)::int AS sample_count
      FROM metric_samples
      WHERE service_id = ${serviceId}
        AND name = ${rule.metric}
        AND sampled_at >= NOW() - make_interval(secs => ${windowSeconds})
    `;

    if (!agg || agg.sample_count === 0 || agg.avg_value == null) {
      results.push({ opened: false, reason: `no sample for ${rule.metric}` });
      continue;
    }

    const value = Number(agg.avg_value);
    const fired =
      rule.operator === ">"
        ? value > rule.threshold
        : rule.operator === ">="
          ? value >= rule.threshold
          : false;

    if (!fired) {
      results.push({
        opened: false,
        reason: `${rule.metric} ok (avg ${value} over ${windowSeconds}s, n=${agg.sample_count})`,
      });
      continue;
    }

    const [existing] = await sql<{ id: string }[]>`
      SELECT id::text AS id FROM incidents
      WHERE service_id = ${serviceId}
        AND alert_rule_id = ${rule.id}
        AND status = ANY(${[...OPEN_STATUSES]})
      ORDER BY opened_at DESC
      LIMIT 1
    `;

    if (existing) {
      await appendIncidentEvent({
        incidentId: existing.id,
        kind: "alert_repeat",
        message: `Alert ${rule.name} still firing (avg ${value})`,
        meta: { metric: rule.metric, value, windowSeconds },
      });
      results.push({
        opened: false,
        reason: "deduped",
        incidentId: existing.id,
      });
      continue;
    }

    const { getReleaseProvider } = await import("@/lib/release");
    let suspectSha: string | null = null;
    try {
      const deploy = await getReleaseProvider().currentDeploy();
      suspectSha = deploy?.sha ?? null;
    } catch {
      suspectSha = null;
    }

    const title = `${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (avg ${Math.round(value * 1000) / 1000} over ${windowSeconds}s)`;

    // Transactional open: re-check open incident inside the transaction
    const opened = await sql.begin(async (tx) => {
      const [dup] = await tx<{ id: string }[]>`
        SELECT id::text AS id FROM incidents
        WHERE service_id = ${serviceId}
          AND alert_rule_id = ${rule.id}
          AND status = ANY(${[...OPEN_STATUSES]})
        LIMIT 1
        FOR UPDATE
      `;
      if (dup) return null;

      const [incident] = await tx<{ id: string }[]>`
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
          ${value},
          ${suspectSha},
          NOW(),
          NOW()
        )
        RETURNING id::text AS id
      `;
      return incident ?? null;
    });

    if (!opened) {
      results.push({ opened: false, reason: "deduped_race" });
      continue;
    }

    await appendIncidentEvent({
      incidentId: opened.id,
      kind: "detected",
      message: `Watcher opened incident for ${rule.name}`,
      meta: {
        metric: rule.metric,
        value,
        windowSeconds,
        deploy: deploy?.sha ?? null,
      },
    });

    results.push({
      opened: true,
      incidentId: opened.id,
      title,
      metric: rule.metric,
      value,
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

export function watcherRunning(): boolean {
  return Boolean(globalWatch.__relayWatcher?.timer);
}
