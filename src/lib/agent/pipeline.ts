import { sql } from "@/lib/db";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { currentTraceId, flushTelemetry } from "@/lib/observability/langfuse";
import {
  classifyProviderError,
  isHardFailCode,
  isRetryableDiagnosisCode,
} from "./provider-errors";
import {
  oracleDiagnose,
  runEvidenceAgent,
  runIncidentAgent,
} from "./specialists";
import type { HypothesesOutput, RecommendationOutput } from "./schemas";

const DIAGNOSIS_ALLOWED = new Set([
  "detected",
  "needs_human",
  "awaiting_review",
]);

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class DiagnosisConflictError extends Error {
  constructor(
    public readonly incidentId: string,
    public readonly status: string,
  ) {
    super(`Incident ${incidentId} cannot be diagnosed from status "${status}"`);
    this.name = "DiagnosisConflictError";
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  incidentId: string,
): Promise<T> {
  const maxRetries = Number(process.env.DIAGNOSIS_MAX_RETRIES ?? 2);
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const classified = classifyProviderError(err);
      if (isHardFailCode(classified.code)) throw err;
      if (!isRetryableDiagnosisCode(classified.code)) throw err;
      if (attempt >= maxRetries) throw err;
      attempt += 1;
      const wait = classified.retryAfterMs ?? 2000;
      await appendIncidentEvent({
        incidentId,
        kind: "retry",
        message: `${label} retry ${attempt}/${maxRetries} after ${classified.code}`,
        meta: { wait, attempt },
      }).catch(() => undefined);
      await sleep(wait);
    }
  }
}

async function persistTraceId(incidentId: string) {
  const traceId = await currentTraceId();
  if (!traceId) return;
  await sql`
    UPDATE incidents
    SET langfuse_trace_id = COALESCE(${traceId}, langfuse_trace_id)
    WHERE id = ${incidentId}::uuid
  `.catch(() => undefined);
}

export async function runDiagnosisPipeline(
  incidentId: string,
  opts?: { forceOracle?: boolean },
) {
  const [claimed] = await sql<
    { id: string; title: string; service_id: number; status: string }[]
  >`
    UPDATE incidents
    SET status = 'investigating', updated_at = NOW()
    WHERE id = ${incidentId}::uuid
      AND status = ANY(${[...DIAGNOSIS_ALLOWED]})
    RETURNING id::text AS id, title, service_id, status
  `;

  if (!claimed) {
    const [existing] = await sql<{ status: string }[]>`
      SELECT status FROM incidents WHERE id = ${incidentId}::uuid
    `;
    if (!existing) throw new Error(`Incident ${incidentId} not found`);
    throw new DiagnosisConflictError(incidentId, existing.status);
  }

  await appendIncidentEvent({
    incidentId,
    kind: "investigating",
    message: "Diagnosis pipeline started",
  });

  const rt = { serviceId: claimed.service_id, incidentId };
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  );
  const useOracle = opts?.forceOracle || !hasKey;

  let hypotheses: HypothesesOutput;
  let recommendation: RecommendationOutput;

  try {
    if (useOracle) {
      await appendIncidentEvent({
        incidentId,
        kind: "oracle",
        message: hasKey
          ? "Forced oracle diagnose"
          : "No Gemini key — using deterministic oracle",
      });
      const out = await oracleDiagnose(rt);
      hypotheses = out.hypotheses;
      recommendation = out.recommendation;
    } else {
      hypotheses = await withRetry(
        () => runIncidentAgent(rt, claimed.title),
        "incident-agent",
        incidentId,
      );
      recommendation = await withRetry(
        () => runEvidenceAgent(rt, hypotheses),
        "evidence-agent",
        incidentId,
      );
    }
  } catch (err) {
    const classified = classifyProviderError(err);
    console.error("[diagnosis]", incidentId, classified.code, err);
    await setIncidentStatus(incidentId, "needs_human", {
      needsHumanReason: `${classified.code}: ${classified.userMessage}`,
    });
    await appendIncidentEvent({
      incidentId,
      kind: "diagnosis_failed",
      message: classified.userMessage,
      meta: { code: classified.code, raw: classified.raw.slice(0, 500) },
    });
    await persistTraceId(incidentId);
    await flushTelemetry().catch(() => undefined);
    return { ok: false as const, status: "needs_human", classified };
  }

  await persistTraceId(incidentId);
  await flushTelemetry().catch(() => undefined);

  // wipe prior hypotheses for re-runs
  await sql`DELETE FROM recommendations WHERE incident_id = ${incidentId}::uuid`;
  await sql`DELETE FROM hypotheses WHERE incident_id = ${incidentId}::uuid`;

  const hypIds: number[] = [];
  for (const h of hypotheses.hypotheses) {
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO hypotheses (
        incident_id, rank, cause_type, suspect_deploy, supporting_tool_names, why
      )
      VALUES (
        ${incidentId}::uuid,
        ${h.rank},
        ${h.cause_type},
        ${h.suspect_deploy},
        ${jsonb(h.supporting_tool_names)},
        ${h.why}
      )
      RETURNING id
    `;
    hypIds.push(row!.id);
  }

  const winning =
    hypIds[Math.max(0, recommendation.winning_hypothesis_rank - 1)] ??
    hypIds[0] ??
    null;

  const [rec] = await sql<{ id: number }[]>`
    INSERT INTO recommendations (
      incident_id, winning_hypothesis_id, confidence, evidence,
      recommended_action, action_target, summary
    )
    VALUES (
      ${incidentId}::uuid,
      ${winning},
      ${recommendation.confidence_0_100},
      ${jsonb(recommendation.evidence)},
      ${recommendation.recommended_action},
      ${recommendation.action_target},
      ${recommendation.summary}
    )
    RETURNING id
  `;

  await sql`
    INSERT INTO reviews (incident_id, recommendation_id, decision, reviewer)
    VALUES (${incidentId}::uuid, ${rec!.id}, 'pending', 'oncall')
  `;

  await setIncidentStatus(incidentId, "awaiting_review");
  await appendIncidentEvent({
    incidentId,
    kind: "awaiting_review",
    message: `Recommendation: ${recommendation.recommended_action} ${recommendation.action_target} (${recommendation.confidence_0_100}%)`,
    meta: { recommendationId: rec!.id },
  });

  return {
    ok: true as const,
    status: "awaiting_review",
    hypotheses,
    recommendation,
    recommendationId: rec!.id,
  };
}
