import { sql } from "@/lib/db";
import { tickOnce } from "@/lib/sim/ticker";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";

const LATENCY = Number(process.env.LATENCY_P95_THRESHOLD_MS ?? 2000);
const ERROR_RATE = Number(process.env.ERROR_RATE_THRESHOLD ?? 0.05);

export async function verifyRecovery(incidentId: string, samples = 2) {
  await setIncidentStatus(incidentId, "verifying");
  await appendIncidentEvent({
    incidentId,
    kind: "verifying",
    message: "Sampling metrics after action",
  });

  const readings: Array<{ p95: number; errorRate: number }> = [];
  for (let i = 0; i < samples; i++) {
    const tick = await tickOnce();
    readings.push({ p95: tick.p95, errorRate: tick.errorRate });
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
