import { tickOnce } from "@/lib/sim/ticker";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { sql } from "@/lib/db";
import { formatMetricValue, metricLabel } from "@/lib/ui/labels";

const LATENCY = Number(process.env.LATENCY_P95_THRESHOLD_MS ?? 2000);
const ERROR_RATE = Number(process.env.ERROR_RATE_THRESHOLD ?? 0.05);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultThreshold(metric: string | null | undefined): number {
  if (!metric) return LATENCY;
  if (metric.includes("error_rate")) return ERROR_RATE;
  if (metric.includes("pool")) return 500;
  if (metric.includes("payments")) return 1500;
  return LATENCY;
}

export async function verifyRecovery(incidentId: string) {
  const [incident] = await sql<
    { trigger_metric: string | null; trigger_value: number | null }[]
  >`
    SELECT trigger_metric, trigger_value FROM incidents WHERE id = ${incidentId}::uuid
  `;
  const triggerMetric = incident?.trigger_metric ?? "checkout_latency_p95";
  const threshold = defaultThreshold(triggerMetric);

  const samples = Math.max(1, Number(process.env.VERIFY_SAMPLES ?? 3));
  const intervalMs = Math.max(
    0,
    Number(process.env.VERIFY_INTERVAL_MS ?? 1000),
  );
  const timeoutMs = Math.max(
    intervalMs,
    Number(process.env.VERIFY_TIMEOUT_MS ?? 15_000),
  );

  await setIncidentStatus(incidentId, "verifying");
  await appendIncidentEvent({
    incidentId,
    kind: "verifying",
    message: `Checking ${metricLabel(triggerMetric)} after the fix (need ${samples} samples under ${formatMetricValue(triggerMetric, threshold)})`,
    meta: { metric: triggerMetric, threshold, samples, timeoutMs },
  });

  const readings: Array<{
    trigger: number;
    p95: number;
    errorRate: number;
  }> = [];
  const started = Date.now();

  while (readings.length < samples && Date.now() - started < timeoutMs) {
    const tick = await tickOnce();
    const trigger =
      tick.metrics[triggerMetric] ??
      (triggerMetric === "checkout_latency_p95"
        ? tick.p95
        : triggerMetric === "checkout_error_rate"
          ? tick.errorRate
          : triggerMetric === "db_pool_wait_ms"
            ? tick.poolWait
            : triggerMetric === "payments_latency_p99"
              ? tick.paymentsP99
              : tick.p95);
    readings.push({ trigger, p95: tick.p95, errorRate: tick.errorRate });
    if (readings.length < samples && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }

  if (readings.length === 0) {
    await setIncidentStatus(incidentId, "needs_human", {
      needsHumanReason: "verify_failed: no metric samples collected",
    });
    await appendIncidentEvent({
      incidentId,
      kind: "verify_failed",
      message: "No metric samples collected",
    });
    return { ok: false as const, recovered: false, readings, worse: false };
  }

  const last = readings[readings.length - 1]!;
  const recovered = last.trigger < threshold;
  const worse =
    readings.length > 1 && last.trigger > readings[0]!.trigger * 1.2;

  if (recovered) {
    await appendIncidentEvent({
      incidentId,
      kind: "verify_ok",
      message: `Recovered — ${metricLabel(triggerMetric)} is ${formatMetricValue(triggerMetric, last.trigger)} (threshold ${formatMetricValue(triggerMetric, threshold)})`,
      meta: {
        readings,
        metric: triggerMetric,
        value: last.trigger,
        threshold,
      },
    });
    return { ok: true as const, recovered: true, readings };
  }

  await setIncidentStatus(incidentId, "needs_human", {
    needsHumanReason: worse
      ? "verify_failed: metrics worsened after action"
      : "verify_failed: metrics did not recover in time",
  });
  await appendIncidentEvent({
    incidentId,
    kind: "verify_failed",
    message: `Not recovered — ${metricLabel(triggerMetric)} is ${formatMetricValue(triggerMetric, last.trigger)} (threshold ${formatMetricValue(triggerMetric, threshold)})`,
    meta: {
      readings,
      worse,
      metric: triggerMetric,
      value: last.trigger,
      threshold,
    },
  });
  return { ok: false as const, recovered: false, readings, worse };
}

export async function latestMetrics(serviceId: number) {
  return sql<{ name: string; value: number }[]>`
    SELECT DISTINCT ON (name) name, value
    FROM metric_samples
    WHERE service_id = ${serviceId}
    ORDER BY name, sampled_at DESC
  `;
}
