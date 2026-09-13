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
      severity: string;
    };

const OPEN_STATUSES = [
  "detected",
  "investigating",
  "awaiting_review",
  "acting",
  "verifying",
  "needs_human",
] as const;

const MIN_SAMPLES = Number(process.env.WATCHER_MIN_SAMPLES ?? 2);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[idx]!;
}

function severityFor(metric: string, value: number, threshold: number): string {
  const ratio = threshold > 0 ? value / threshold : 1;
  if (metric.includes("error_rate")) {
    if (value >= threshold * 3) return "critical";
    if (value >= threshold * 1.5) return "high";
    return "medium";
  }
  if (ratio >= 3) return "critical";
  if (ratio >= 1.5) return "high";
  return "medium";
}

/** Window aggregation: p95 for latency/wait gauges, average for rates. */
function aggregateWindow(
  metric: string,
  values: number[],
): { value: number; label: string } {
  const sorted = [...values].sort((a, b) => a - b);
  if (metric.includes("rate")) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { value: avg, label: "avg" };
  }
  // Stored samples are already per-tick p95/p99; take windowed p95 of those.
  return { value: percentile(sorted, 0.95), label: "p95" };
}

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
    const samples = await sql<{ value: number }[]>`
      SELECT value::float8 AS value
      FROM metric_samples
      WHERE service_id = ${serviceId}
        AND name = ${rule.metric}
        AND sampled_at >= NOW() - make_interval(secs => ${windowSeconds})
      ORDER BY sampled_at ASC
    `;

    if (samples.length < MIN_SAMPLES) {
      results.push({
        opened: false,
        reason: `insufficient samples for ${rule.metric} (n=${samples.length}, need ${MIN_SAMPLES})`,
      });
      continue;
    }

    const { value, label } = aggregateWindow(
      rule.metric,
      samples.map((s) => Number(s.value)),
    );
    const fired =
      rule.operator === ">"
        ? value > rule.threshold
        : rule.operator === ">="
          ? value >= rule.threshold
          : false;

    if (!fired) {
      results.push({
        opened: false,
        reason: `${rule.metric} ok (${label} ${value} over ${windowSeconds}s, n=${samples.length})`,
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
        message: `Alert ${rule.name} still firing (${label} ${value})`,
        meta: { metric: rule.metric, value, windowSeconds, label },
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
    let changePoint = false;
    try {
      const provider = getReleaseProvider();
      const deploy = await provider.currentDeploy();
      suspectSha = deploy?.sha ?? null;
      // Change-point: only blame deploy if metric rose after it vs prior window half.
      if (samples.length >= 4) {
        const mid = Math.floor(samples.length / 2);
        const before =
          samples.slice(0, mid).reduce((a, s) => a + Number(s.value), 0) / mid;
        const after =
          samples.slice(mid).reduce((a, s) => a + Number(s.value), 0) /
          (samples.length - mid);
        changePoint = after > before * 1.3 && after > rule.threshold;
        if (!changePoint && deploy) {
          // Still record SHA but mark low confidence via event meta
          changePoint = false;
        }
      } else {
        changePoint = true; // too few samples to disprove correlation
      }
    } catch {
      suspectSha = null;
    }

    const severity = severityFor(rule.metric, value, rule.threshold);
    const title = `${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (${label} ${Math.round(value * 1000) / 1000} over ${windowSeconds}s)`;

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
          ${severity},
          ${rule.metric},
          ${value},
          ${changePoint ? suspectSha : null},
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
        label,
        severity,
        deploy: suspectSha,
        changePoint,
      },
    });

    results.push({
      opened: true,
      incidentId: opened.id,
      title,
      metric: rule.metric,
      value,
      severity,
    });

    maybeAutoDiagnose(opened.id);
  }

  return results;
}

/** Rate-limited auto-diagnose so the review queue is "approve this PR", not "remember Diagnose". */
function maybeAutoDiagnose(incidentId: string) {
  const enabled =
    (process.env.AUTO_DIAGNOSE ?? "true").toLowerCase() !== "false";
  if (!enabled) return;

  const g = globalThis as unknown as {
    __relayAutoDiagnose?: Set<string>;
  };
  if (!g.__relayAutoDiagnose) g.__relayAutoDiagnose = new Set();
  if (g.__relayAutoDiagnose.has(incidentId)) return;
  g.__relayAutoDiagnose.add(incidentId);

  void (async () => {
    try {
      const { runDiagnosisPipeline } = await import("@/lib/agent/pipeline");
      await appendIncidentEvent({
        incidentId,
        kind: "auto_diagnose",
        message: "AUTO_DIAGNOSE starting diagnosis pipeline",
      });
      await runDiagnosisPipeline(incidentId);
    } catch (err) {
      console.error("[watcher] auto-diagnose failed", incidentId, err);
      await appendIncidentEvent({
        incidentId,
        kind: "auto_diagnose_failed",
        message: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined);
    } finally {
      // Allow re-diagnose later if status returns to detected/needs_human
      setTimeout(() => g.__relayAutoDiagnose?.delete(incidentId), 60_000);
    }
  })();
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
