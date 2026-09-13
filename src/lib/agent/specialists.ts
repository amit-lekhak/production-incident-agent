import { google } from "@ai-sdk/google";
import { generateText, Output, stepCountIs } from "ai";
import { buildAiTools } from "./ai-tools";
import { buildTools, type ToolRuntime } from "./tools";
import { ensureGeminiKey, geminiModel } from "./provider-config";
import { recordLlmUsage } from "@/lib/observability/llm-usage";
import {
  hypothesesSchema,
  recommendationSchema,
  type HypothesesOutput,
  type RecommendationOutput,
} from "./schemas";

ensureGeminiKey();

export type ToolInvocation = {
  name: string;
  output: unknown;
};

function collectToolInvocations(
  steps: Array<{
    toolCalls?: Array<{ toolName: string }>;
    toolResults?: Array<{ toolName: string; output?: unknown }>;
  }>,
): ToolInvocation[] {
  const out: ToolInvocation[] = [];
  for (const step of steps) {
    for (const tr of step.toolResults ?? []) {
      out.push({ name: tr.toolName, output: tr.output });
    }
    if (!step.toolResults?.length) {
      for (const tc of step.toolCalls ?? []) {
        out.push({ name: tc.toolName, output: null });
      }
    }
  }
  return out;
}

function summarizeTools(tools: ToolInvocation[]): string {
  return tools
    .map((t) => {
      const display =
        t.output &&
        typeof t.output === "object" &&
        t.output !== null &&
        "display" in t.output
          ? String((t.output as { display: unknown }).display)
          : JSON.stringify(t.output)?.slice(0, 800);
      return `### ${t.name}\n${display ?? "(no output)"}`;
    })
    .join("\n\n");
}

async function captureUsage(
  incidentId: string,
  functionId: string,
  result: {
    usage?: {
      inputTokens?: number | null;
      outputTokens?: number | null;
      totalTokens?: number | null;
    };
  },
  startedAt: number,
) {
  await recordLlmUsage({
    incidentId,
    functionId,
    usage: result.usage,
    latencyMs: Date.now() - startedAt,
  }).catch((err) => {
    console.warn("[llm-usage]", functionId, err);
  });
}

export async function runIncidentAgent(
  rt: ToolRuntime,
  incidentTitle: string,
): Promise<{ hypotheses: HypothesesOutput; tools: ToolInvocation[] }> {
  const tools = buildAiTools(rt);
  const gatherStarted = Date.now();
  const gather = await generateText({
    model: google(geminiModel()),
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 400,
    runtimeContext: { incidentId: rt.incidentId },
    telemetry: {
      functionId: "incident-agent-gather",
      includeRuntimeContext: { incidentId: true },
    },
    system: `You are the Incident Agent for Relay Checkout.
Gather evidence with tools. Do NOT recommend or execute actions.
Call get_service_health, query_metrics, query_traces, list_deployments, and any other needed tools.
Infer the actual failure from metrics/traces/diffs/source — never expect a "scenario" label.
After tools, write at most 3 plain sentences about what broke. Never paste request IDs, metric series, JSON, or tool dumps.`,
    prompt: `Investigate incident: ${incidentTitle}
Use tools now to gather evidence. Prefer tool display strings over invention.`,
  });
  await captureUsage(
    rt.incidentId,
    "incident-agent-gather",
    gather,
    gatherStarted,
  );

  const toolInvocations = collectToolInvocations(gather.steps ?? []);
  const evidencePack = summarizeTools(toolInvocations);

  const structuredStarted = Date.now();
  const structured = await generateText({
    model: google(geminiModel()),
    output: Output.object({ schema: hypothesesSchema }),
    maxOutputTokens: 800,
    runtimeContext: { incidentId: rt.incidentId },
    telemetry: {
      functionId: "incident-agent-structure",
      includeRuntimeContext: { incidentId: true },
    },
    system: `You propose ranked hypotheses for Relay Checkout incidents.
Use ONLY the provided tool evidence. Do not invent metrics.
Each hypothesis needs a free-form headline that names the actual root cause in one line
(e.g. "Checkout awaits catalog.lookup once per cart line after deploy abc1234").
Do not use closed enum labels like n_plus_one — describe what the evidence shows.`,
    prompt: `Incident: ${incidentTitle}

Tool evidence:
${evidencePack || "(no tools called — use get_service_health signals if present in text below)"}

Agent notes:
${gather.text || "(none)"}

Output ranked hypotheses with headline + why.`,
  });
  await captureUsage(
    rt.incidentId,
    "incident-agent-structure",
    structured,
    structuredStarted,
  );

  if (!structured.output) {
    throw new Error("Incident agent returned no structured hypotheses");
  }
  return {
    hypotheses: structured.output,
    tools: toolInvocations,
  };
}

export async function runEvidenceAgent(
  rt: ToolRuntime,
  hypotheses: HypothesesOutput,
): Promise<{
  recommendation: RecommendationOutput;
  tools: ToolInvocation[];
}> {
  const tools = buildAiTools(rt);
  const gatherStarted = Date.now();
  const gather = await generateText({
    model: google(geminiModel()),
    tools,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 400,
    runtimeContext: { incidentId: rt.incidentId },
    telemetry: {
      functionId: "evidence-agent-gather",
      includeRuntimeContext: { incidentId: true },
    },
    system: `You are the Evidence Agent. Try to DISPROVE hypotheses first.
Re-check metrics/traces/deployments/flags/code as needed. Do not execute mutations.
After tools, write at most 3 plain sentences. Never paste request IDs, metric series, or JSON.`,
    prompt: `Hypotheses to evaluate:
${JSON.stringify(hypotheses, null, 2)}

Gather evidence with tools.`,
  });
  await captureUsage(
    rt.incidentId,
    "evidence-agent-gather",
    gather,
    gatherStarted,
  );

  const toolInvocations = collectToolInvocations(gather.steps ?? []);
  const evidencePack = summarizeTools(toolInvocations);

  const structuredStarted = Date.now();
  const structured = await generateText({
    model: google(geminiModel()),
    output: Output.object({ schema: recommendationSchema }),
    maxOutputTokens: 900,
    runtimeContext: { incidentId: rt.incidentId },
    telemetry: {
      functionId: "evidence-agent-structure",
      includeRuntimeContext: { incidentId: true },
    },
    system: `Choose recommended_action from evidence — not from a fixed cause label map:
- Symptom started after a deploy and live diff/source explains it → revert_pr with that live deploy sha as action_target
- A feature flag is on and traces/metrics pin the failure to that path → disable_flag with the flag key as action_target
- Unsure or conflicting evidence → page_human or watch
Write summary as 1–2 plain sentences for an on-call engineer (what broke + what to do).
Never paste tool display strings, similar-incident lists, metric series, or "catalog.lookup …" dumps into summary.
Put tool quotes only in evidence[].display. Never invent metric series.
Do not execute mutations — on approve, code opens/merges a GitHub PR for revert_pr.`,
    prompt: `Hypotheses:
${JSON.stringify(hypotheses, null, 2)}

Tool evidence:
${evidencePack || "(none)"}

Agent notes:
${gather.text || "(none)"}

Output a recommendation with confidence and a plain-language summary.`,
  });
  await captureUsage(
    rt.incidentId,
    "evidence-agent-structure",
    structured,
    structuredStarted,
  );

  if (!structured.output) {
    throw new Error("Evidence agent returned no recommendation");
  }
  return {
    recommendation: structured.output,
    tools: toolInvocations,
  };
}

/** Deterministic fallback when Gemini is unavailable — used by evals/oracle and no-key demos.
 * Infers cause from traces/metrics/source/diff — does not peek at active_faults.scenario.
 */
function checkoutLooksNPlusOne(src: string) {
  return src.includes("lookupProductNPlusOne");
}

export async function oracleDiagnose(rt: ToolRuntime): Promise<{
  hypotheses: HypothesesOutput;
  recommendation: RecommendationOutput;
}> {
  const tools = buildTools(rt);
  const health = await tools.get_service_health();
  const traces = await tools.query_traces({ limit: 8 });
  const deploys = await tools.list_deployments({ limit: 5 });
  const source = await tools.read_source({ path: "src/checkout.ts" });
  const poolSrc = await tools.read_source({ path: "src/pool.ts" });
  const diff = await tools.diff_deploys({});
  const errors = await tools.list_errors({ limit: 5 });
  const db = await tools.query_db_timings({ minutes: 15 });
  const metrics = health.metrics ?? [];

  // Infer similar-incident search hint from live signals (not a closed cause enum).
  let searchHint: string | undefined;
  const errRate =
    metrics.find((m: { name: string }) => m.name === "checkout_error_rate")
      ?.value ?? 0;
  const payP99 =
    metrics.find((m: { name: string }) => m.name === "payments_latency_p99")
      ?.value ?? 0;
  const poolMetric =
    metrics.find((m: { name: string }) => m.name === "db_pool_wait_ms")
      ?.value ?? 0;
  if (checkoutLooksNPlusOne(source.text) || (db.catalogAvgMs ?? 0) >= 200) {
    searchHint = "catalog lookup";
  } else if (payP99 >= 1000 || source.text.includes("chargePaymentSlow")) {
    searchHint = "payment";
  } else if (errRate >= 0.05 || (errors.rows?.length ?? 0) > 0) {
    searchHint = "error";
  } else if (poolMetric >= 400 || /DB_POOL_SIZE\s*=\s*2/.test(poolSrc.text)) {
    searchHint = "pool";
  }
  const similar = await tools.list_similar_incidents({
    searchHint,
    limit: 5,
  });

  const activeSha = health.deploy?.sha ?? null;
  const short = activeSha?.slice(0, 7) ?? "unknown";
  const catalogAvgMs = db.catalogAvgMs;
  const avgLookups = traces.avgCatalogLookups ?? 0;
  const avgPay = traces.avgPaymentMs ?? 0;
  const avgPool = traces.avgPoolWaitMs ?? 0;
  const errorRate =
    metrics.find((m: { name: string }) => m.name === "checkout_error_rate")
      ?.value ?? 0;
  const paymentsP99 =
    metrics.find((m: { name: string }) => m.name === "payments_latency_p99")
      ?.value ?? 0;

  const checkoutSrc = source.text;
  const poolText = poolSrc.text;
  void `${checkoutSrc}\n${poolText}\n${diff.diff}`;

  let action: RecommendationOutput["recommended_action"] = "page_human";
  let target = activeSha ?? "unknown";
  let confidence = 55;
  let headline = "Insufficient signal to name a root cause";
  let why = "Insufficient signal";

  // Prefer live source signals first so stale metrics cannot override the deploy.
  if (checkoutLooksNPlusOne(checkoutSrc)) {
    action = "revert_pr";
    target = activeSha ?? "unknown";
    confidence = 87;
    headline = `Checkout awaits catalog.lookup once per cart line after deploy ${short}`;
    why = `Catalog lookups ~${avgLookups.toFixed(1)}× per request (avg ${catalogAvgMs}ms) after deploy ${short} — recommend revert.`;
  } else if (/meta!\.source|req\.meta!\.source/.test(checkoutSrc)) {
    action = "revert_pr";
    target = activeSha ?? "unknown";
    confidence = 80;
    headline = `Checkout throws on missing cart metadata after deploy ${short}`;
    why =
      "Checkout throws on missing cart metadata after this deploy — recommend revert.";
  } else if (/DB_POOL_SIZE\s*=\s*2/.test(poolText)) {
    action = "revert_pr";
    target = activeSha ?? "unknown";
    confidence = 82;
    headline = `DB pool size reduced to 2 after deploy ${short}`;
    why =
      "DB pool size reduced to 2 in source; pool wait elevated — recommend revert.";
  } else if (checkoutSrc.includes("chargePaymentSlow")) {
    action = "disable_flag";
    target = "payments_v2";
    confidence = 84;
    headline = "Payments path is slow under the payments_v2 flag";
    why =
      "Payments path is slow under payments_v2 — disable the flag instead of reverting.";
  } else if (avgPay >= 1200 || paymentsP99 >= 1500) {
    action = "disable_flag";
    target = "payments_v2";
    confidence = 84;
    headline = "Payments latency elevated under payments_v2";
    why =
      "Payments latency elevated — disable payments_v2 instead of reverting the deploy.";
  } else if (errorRate >= 0.05 || (errors.rows?.length ?? 0) > 0) {
    action = "revert_pr";
    target = activeSha ?? "unknown";
    confidence = 80;
    headline = `Error rate elevated after deploy ${short}`;
    why = "Error rate / error events elevated after deploy — recommend revert.";
  } else if (avgPool >= 400) {
    action = "revert_pr";
    target = activeSha ?? "unknown";
    confidence = 82;
    headline = `DB pool wait elevated after deploy ${short}`;
    why = "DB pool wait elevated — recommend revert of the suspect deploy.";
  } else if (catalogAvgMs >= 200 || avgLookups >= 2.5) {
    action = "revert_pr";
    target = activeSha ?? "unknown";
    confidence = 87;
    headline = `Catalog lookups ~${avgLookups.toFixed(1)}× per request after deploy ${short}`;
    why = `Catalog lookups ~${avgLookups.toFixed(1)}× per request (avg ${catalogAvgMs}ms) after deploy ${short} — recommend revert.`;
  }

  const hypotheses: HypothesesOutput = {
    hypotheses: [
      {
        rank: 1,
        headline,
        suspect_deploy: activeSha,
        supporting_tool_names: [
          "query_traces",
          "list_deployments",
          "diff_deploys",
          "read_source",
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
      { tool: "diff_deploys", display: diff.display, supports: true },
      {
        tool: "read_source",
        display: source.display.slice(0, 400),
        supports: true,
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
