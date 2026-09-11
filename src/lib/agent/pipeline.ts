import { sql } from "@/lib/db";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { captureAppException } from "@/lib/observability/sentry";
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

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const classified = classifyProviderError(err);
    if (isHardFailCode(classified.code)) throw err;
    if (!isRetryableDiagnosisCode(classified.code)) throw err;
    const wait = classified.retryAfterMs ?? 2000;
    await appendIncidentEvent({
      incidentId:
        (globalThis as unknown as { __currentIncidentId?: string })
          .__currentIncidentId ?? "00000000-0000-0000-0000-000000000000",
      kind: "retry",
      message: `${label} retry after ${classified.code}`,
      meta: { wait },
    }).catch(() => undefined);
    await sleep(wait);
    return await fn();
  }
}

export async function runDiagnosisPipeline(
  incidentId: string,
  opts?: { forceOracle?: boolean },
) {
  const [incident] = await sql<
    { id: string; title: string; service_id: number; status: string }[]
  >`
    SELECT id::text AS id, title, service_id, status
    FROM incidents WHERE id = ${incidentId}::uuid
  `;
  if (!incident) throw new Error(`Incident ${incidentId} not found`);

  (
    globalThis as unknown as { __currentIncidentId?: string }
  ).__currentIncidentId = incidentId;

  await setIncidentStatus(incidentId, "investigating");
  await appendIncidentEvent({
    incidentId,
    kind: "investigating",
    message: "Diagnosis pipeline started",
  });

  const rt = { serviceId: incident.service_id, incidentId };
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
        () => runIncidentAgent(rt, incident.title),
        "incident-agent",
      );
      recommendation = await withRetry(
        () => runEvidenceAgent(rt, hypotheses),
        "evidence-agent",
      );
    }
  } catch (err) {
    const classified = classifyProviderError(err);
    await captureAppException(err, { incidentId, stage: "diagnosis" });
    await setIncidentStatus(incidentId, "needs_human", {
      needsHumanReason: `${classified.code}: ${classified.userMessage}`,
    });
    await appendIncidentEvent({
      incidentId,
      kind: "diagnosis_failed",
      message: classified.userMessage,
      meta: { code: classified.code, raw: classified.raw.slice(0, 500) },
    });
    return { ok: false as const, status: "needs_human", classified };
  }

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
