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

const MIN_CONFIDENCE = Number(process.env.DIAGNOSIS_MIN_CONFIDENCE ?? 60);
const MUTATING_ACTIONS = new Set(["revert_pr", "disable_flag", "restart"]);

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

/** Close any open remediation PRs from prior diagnosis runs. */
async function closeSupersededPrs(incidentId: string) {
  const rows = await sql<{ pr_number: number | null }[]>`
    SELECT pr_number FROM recommendations
    WHERE incident_id = ${incidentId}::uuid AND pr_number IS NOT NULL
  `;
  if (rows.length === 0) return;
  const { getReleaseProvider } = await import("@/lib/release");
  const provider = getReleaseProvider();
  for (const row of rows) {
    if (!row.pr_number) continue;
    try {
      await provider.closePr(row.pr_number);
      await appendIncidentEvent({
        incidentId,
        kind: "pr_superseded",
        message: `Closed superseded PR #${row.pr_number}`,
        meta: { prNumber: row.pr_number },
      });
    } catch (err) {
      console.warn("[pipeline] close superseded PR failed", err);
    }
  }
}

function applyConfidenceGate(
  recommendation: RecommendationOutput,
): RecommendationOutput {
  if (
    recommendation.confidence_0_100 < MIN_CONFIDENCE &&
    MUTATING_ACTIONS.has(recommendation.recommended_action)
  ) {
    return {
      ...recommendation,
      recommended_action: "page_human",
      action_target: recommendation.action_target || "oncall",
      summary: `Confidence ${recommendation.confidence_0_100}% below ${MIN_CONFIDENCE}% gate — paging human instead of ${recommendation.recommended_action}. ${recommendation.summary}`,
    };
  }
  return recommendation;
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
        async () => {
          const r = await runIncidentAgent(rt, claimed.title);
          return r.hypotheses;
        },
        "incident-agent",
        incidentId,
      );
      recommendation = await withRetry(
        async () => {
          const r = await runEvidenceAgent(rt, hypotheses);
          return r.recommendation;
        },
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

  recommendation = applyConfidenceGate(recommendation);

  // Close prior PRs before wiping recommendations
  await closeSupersededPrs(incidentId);

  let recId: number;
  try {
    recId = await sql.begin(async (tx) => {
      // reviews → recommendations → hypotheses (FK order)
      await tx`DELETE FROM reviews WHERE incident_id = ${incidentId}::uuid`;
      await tx`DELETE FROM recommendations WHERE incident_id = ${incidentId}::uuid`;
      await tx`DELETE FROM hypotheses WHERE incident_id = ${incidentId}::uuid`;

      const hypByRank = new Map<number, number>();
      for (const h of hypotheses.hypotheses) {
        const [row] = await tx<{ id: number }[]>`
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
        hypByRank.set(h.rank, row!.id);
      }

      const winning =
        hypByRank.get(recommendation.winning_hypothesis_rank) ??
        hypByRank.get(1) ??
        [...hypByRank.values()][0] ??
        null;

      const [rec] = await tx<{ id: number }[]>`
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

      await tx`
        INSERT INTO reviews (incident_id, recommendation_id, decision, reviewer)
        VALUES (${incidentId}::uuid, ${rec!.id}, 'pending', 'oncall')
      `;

      return rec!.id;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[diagnosis] persist failed", incidentId, err);
    await setIncidentStatus(incidentId, "needs_human", {
      needsHumanReason: `persist_failed: ${message}`,
    });
    await appendIncidentEvent({
      incidentId,
      kind: "diagnosis_failed",
      message,
    });
    return { ok: false as const, status: "needs_human", error: message };
  }

  // Open revert PR for human merge — LLM never mutates. Only after confidence gate.
  if (recommendation.recommended_action === "revert_pr") {
    try {
      const { getReleaseProvider } = await import("@/lib/release");
      const provider = getReleaseProvider();
      const deploys = await provider.listDeployments(2);
      const badSha = recommendation.action_target || deploys[0]?.sha || "";
      const restoreSha = deploys[1]?.sha;
      const pr = await provider.openRevertPr({
        sha: badSha,
        restoreSha,
        title: `incident: revert deploy ${badSha.slice(0, 12)}`,
        body: [
          `Automated remediation for incident \`${incidentId}\`.`,
          "",
          recommendation.summary,
          "",
          `Suspect deploy: \`${badSha}\``,
          restoreSha ? `Restore tree from: \`${restoreSha}\`` : "",
          "",
          "Approve in the review queue to merge this PR and redeploy production.",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      await sql`
        UPDATE recommendations
        SET pr_number = ${pr.number},
            pr_url = ${pr.url},
            pr_head_sha = ${pr.headSha}
        WHERE id = ${recId}
      `;
      await appendIncidentEvent({
        incidentId,
        kind: "pr_opened",
        message: `Opened revert PR #${pr.number}`,
        meta: { prNumber: pr.number, prUrl: pr.url, headSha: pr.headSha },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setIncidentStatus(incidentId, "needs_human", {
        needsHumanReason: `pr_open_failed: ${message}`,
      });
      await appendIncidentEvent({
        incidentId,
        kind: "pr_open_failed",
        message,
      });
      return { ok: false as const, status: "needs_human", error: message };
    }
  }

  await setIncidentStatus(incidentId, "awaiting_review");
  await appendIncidentEvent({
    incidentId,
    kind: "awaiting_review",
    message: `Recommendation: ${recommendation.recommended_action} ${recommendation.action_target} (${recommendation.confidence_0_100}%)`,
    meta: { recommendationId: recId },
  });

  return {
    ok: true as const,
    status: "awaiting_review",
    hypotheses,
    recommendation,
    recommendationId: recId,
  };
}
