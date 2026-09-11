import { google } from "@ai-sdk/google";
import { generateText, Output, stepCountIs } from "ai";
import { buildAiTools } from "./ai-tools";
import { buildTools, type ToolRuntime } from "./tools";
import { ensureGeminiKey, geminiModel } from "./provider-config";
import {
  hypothesesSchema,
  recommendationSchema,
  type HypothesesOutput,
  type RecommendationOutput,
} from "./schemas";

ensureGeminiKey();

export async function runIncidentAgent(
  rt: ToolRuntime,
  incidentTitle: string,
): Promise<HypothesesOutput> {
  const tools = buildAiTools(rt);
  const result = await generateText({
    model: google(geminiModel()),
    tools,
    stopWhen: stepCountIs(10),
    output: Output.object({ schema: hypothesesSchema }),
    telemetry: {
      functionId: "incident-agent",
      metadata: { incidentId: rt.incidentId },
    },
    system: `You are the Incident Agent for Relay Checkout.
Gather evidence with tools. Do NOT recommend or execute actions.
Propose ranked hypotheses. Prefer tool display strings over invention.
Typical causes: n_plus_one (many catalog.lookup spans), payment_timeout (payments p99), error_spike, pool_exhaustion.
Use code_query/code_explain for fixture source when deploys look suspicious.`,
    prompt: `Investigate incident: ${incidentTitle}
Call get_service_health, query_metrics, query_traces, list_deployments, and any other needed tools, then output ranked hypotheses.`,
  });

  if (!result.output) {
    throw new Error("Incident agent returned no structured hypotheses");
  }
  return result.output;
}

export async function runEvidenceAgent(
  rt: ToolRuntime,
  hypotheses: HypothesesOutput,
): Promise<RecommendationOutput> {
  const tools = buildAiTools(rt);
  const result = await generateText({
    model: google(geminiModel()),
    tools,
    stopWhen: stepCountIs(10),
    output: Output.object({ schema: recommendationSchema }),
    telemetry: {
      functionId: "evidence-agent",
      metadata: { incidentId: rt.incidentId },
    },
    system: `You are the Evidence Agent. Try to DISPROVE hypotheses first.
Cite tool display strings. Never invent metric series.
Choose recommended_action carefully:
- n_plus_one / error_spike / pool_exhaustion config deploy → rollback with deploy sha as action_target
- payment_timeout → disable_flag with action_target=payments_v2 (rollback would be wrong)
- if unsure → page_human or watch
Do not execute mutations.`,
    prompt: `Hypotheses to evaluate:
${JSON.stringify(hypotheses, null, 2)}

Re-check metrics/traces/deployments/similar incidents/code graph as needed, then output a recommendation with confidence.`,
  });

  if (!result.output) {
    throw new Error("Evidence agent returned no recommendation");
  }
  return result.output;
}

/** Deterministic fallback when Gemini is unavailable — used by evals/oracle and no-key demos. */
export async function oracleDiagnose(rt: ToolRuntime): Promise<{
  hypotheses: HypothesesOutput;
  recommendation: RecommendationOutput;
}> {
  const tools = buildTools(rt);
  const health = await tools.get_service_health();
  const traces = await tools.query_traces({ limit: 8 });
  const deploys = await tools.list_deployments({ limit: 5 });
  const similar = await tools.list_similar_incidents({
    causeHint: "n_plus_one",
  });
  const code = await tools.code_query({
    question: "lookupProductNPlusOne N+1",
  });

  const fault = health.fault?.scenario ?? null;
  const activeSha = health.deploy?.sha ?? null;
  const db = await tools.query_db_timings({ minutes: 15 });
  const catalogAvgMs = db.catalogAvgMs;

  let cause: HypothesesOutput["hypotheses"][0]["cause_type"] = "unknown";
  let action: RecommendationOutput["recommended_action"] = "page_human";
  let target = activeSha ?? "unknown";
  let confidence = 55;
  let why = "Insufficient signal";

  // Prefer explicit active fault. Do not treat "3 catalog lookups" as N+1 — that is a normal cart size.
  if (fault === "payment_timeout") {
    cause = "payment_timeout";
    action = "disable_flag";
    target = "payments_v2";
    confidence = 84;
    why =
      "payments latency elevated; dependency isolation preferred over rollback";
  } else if (fault === "error_spike") {
    cause = "error_spike";
    action = "rollback";
    target = activeSha ?? "err321null";
    confidence = 80;
    why = "error events spiked after deploy";
  } else if (fault === "pool_exhaustion") {
    cause = "pool_exhaustion";
    action = "rollback";
    target = activeSha ?? "pool654cfg";
    confidence = 82;
    why = "db pool wait elevated after config deploy";
  } else if (fault === "n_plus_one" || catalogAvgMs >= 200) {
    cause = "n_plus_one";
    action = "rollback";
    target = activeSha ?? "abc123nplus1";
    confidence = 87;
    why = `catalog.lookup avg=${catalogAvgMs}ms after deploy ${activeSha}; similar: ${similar.display}`;
  }

  const hypotheses: HypothesesOutput = {
    hypotheses: [
      {
        rank: 1,
        cause_type: cause,
        suspect_deploy: activeSha,
        supporting_tool_names: [
          "query_traces",
          "list_deployments",
          "code_query",
          "list_similar_incidents",
        ],
        why,
      },
    ],
  };

  const recommendation: RecommendationOutput = {
    winning_hypothesis_rank: 1,
    confidence_0_100: confidence,
    evidence: [
      { tool: "query_traces", display: traces.display, supports: true },
      { tool: "list_deployments", display: deploys.display, supports: true },
      {
        tool: "code_query",
        display: code.display,
        supports: cause === "n_plus_one",
      },
      {
        tool: "list_similar_incidents",
        display: similar.display,
        supports: true,
      },
    ],
    recommended_action: action,
    action_target: target,
    summary: why,
  };

  return { hypotheses, recommendation };
}
