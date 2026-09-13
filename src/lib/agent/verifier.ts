import { tickOnce } from "@/lib/sim/ticker";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { sql } from "@/lib/db";

const LATENCY = Number(process.env.LATENCY_P95_THRESHOLD_MS ?? 2000);
const ERROR_RATE = Number(process.env.ERROR_RATE_THRESHOLD ?? 0.05);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function verifyRecovery(incidentId: string) {
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
    message: `Sampling metrics after action (samples=${samples}, timeout=${timeoutMs}ms)`,
  });

  const readings: Array<{ p95: number; errorRate: number }> = [];
  const started = Date.now();

  while (readings.length < samples && Date.now() - started < timeoutMs) {
    const tick = await tickOnce();
    readings.push({ p95: tick.p95, errorRate: tick.errorRate });
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
  const recovered = last.p95 < LATENCY && last.errorRate < ERROR_RATE;
  const worse = readings.length > 1 && last.p95 > readings[0]!.p95 * 1.2;

  if (recovered) {
    await appendIncidentEvent({
      incidentId,
      kind: "verify_ok",
      message: `Metrics recovered p95=${Math.round(last.p95)}ms errorRate=${(last.errorRate * 100).toFixed(2)}%`,
      meta: { readings },
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
    message: `p95=${Math.round(last.p95)}ms errorRate=${(last.errorRate * 100).toFixed(2)}%`,
    meta: { readings, worse },
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
