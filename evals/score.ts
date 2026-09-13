import type { EvalCase } from "./cases";
import type { ToolInvocation } from "../src/lib/agent/specialists";
import type {
  HypothesesOutput,
  RecommendationOutput,
} from "../src/lib/agent/schemas";

export type Check = { name: string; ok: boolean; detail: string };

export type AgentScore = {
  pass: boolean;
  checks: Check[];
};

function collectDisplays(value: unknown, into: string[]) {
  if (value == null) return;
  if (typeof value === "string") {
    into.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDisplays(item, into);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "display" || k.endsWith("_display")) {
        if (typeof v === "string") into.push(v);
      }
      collectDisplays(v, into);
    }
  }
}

function headlineBlob(hypotheses: HypothesesOutput): string {
  return hypotheses.hypotheses
    .map((h) => `${h.headline}\n${h.why}`)
    .join("\n")
    .toLowerCase();
}

/** Pass if any expected phrase appears in headline+why. */
export function headlineSignalsOk(
  hypotheses: HypothesesOutput,
  phrases: string[],
): boolean {
  if (!phrases.length) return true;
  const blob = headlineBlob(hypotheses);
  return phrases.some((p) => blob.includes(p.toLowerCase()));
}

export function scoreAgent(input: {
  c: EvalCase;
  hypotheses: HypothesesOutput;
  recommendation: RecommendationOutput;
  tools: ToolInvocation[];
  activeSha: string | null;
}): AgentScore {
  const checks: Check[] = [];
  const headline = input.hypotheses.hypotheses[0]?.headline;
  const action = input.recommendation.recommended_action;
  const target = input.recommendation.action_target;
  const called = new Set(input.tools.map((t) => t.name));

  checks.push({
    name: "structured_output",
    ok: Boolean(input.hypotheses.hypotheses.length && action && headline),
    detail: `headline=${headline?.slice(0, 80)} action=${action}`,
  });

  const signalsOk = headlineSignalsOk(
    input.hypotheses,
    input.c.expectHeadlineIncludes,
  );
  checks.push({
    name: "headline_signals",
    ok: signalsOk,
    detail: signalsOk
      ? `matched one of [${input.c.expectHeadlineIncludes.join(", ")}]`
      : `headline/why missing signals [${input.c.expectHeadlineIncludes.join(", ")}]; got ${headline}`,
  });

  checks.push({
    name: "action",
    ok: action === input.c.expectAction,
    detail: `got ${action}, want ${input.c.expectAction}`,
  });

  if (input.c.expectNotAction) {
    checks.push({
      name: "forbidden_action",
      ok: action !== input.c.expectNotAction,
      detail: `must not be ${input.c.expectNotAction}`,
    });
  }

  if (input.c.expectTarget === "active_sha") {
    const ok = Boolean(
      input.activeSha &&
      target === input.activeSha &&
      /^[a-z0-9]+$/i.test(target),
    );
    checks.push({
      name: "action_target_sha",
      ok,
      detail: `target=${target} active=${input.activeSha}`,
    });
  } else if (input.c.expectTarget) {
    checks.push({
      name: "action_target",
      ok: target === input.c.expectTarget,
      detail: `got ${target}, want ${input.c.expectTarget}`,
    });
  }

  for (const group of input.c.requiredToolGroups) {
    const ok = group.some((tool) => called.has(tool));
    checks.push({
      name: `tools_any_${group.join("|")}`,
      ok,
      detail: ok
        ? `called one of [${group.join(", ")}]`
        : `missing all of [${group.join(", ")}]`,
    });
  }

  const toolDisplays: string[] = [];
  for (const t of input.tools) collectDisplays(t.output, toolDisplays);
  const blob = toolDisplays.join("\n").toLowerCase();
  const evidenceToolsOk = input.recommendation.evidence.every(
    (e) => called.has(e.tool) || e.tool === "unknown",
  );
  const evidenceQuoteOk =
    input.recommendation.evidence.length === 0 ||
    input.recommendation.evidence.some((e) => {
      const snippet = e.display.slice(0, 24).toLowerCase();
      return snippet.length < 8 || blob.includes(snippet);
    });
  checks.push({
    name: "evidence_grounded",
    ok: evidenceToolsOk && evidenceQuoteOk,
    detail:
      evidenceToolsOk && evidenceQuoteOk
        ? "evidence tools/displays grounded"
        : `toolsOk=${evidenceToolsOk} quoteOk=${evidenceQuoteOk}`,
  });

  const leak = [
    ...toolDisplays,
    ...input.recommendation.evidence.map((e) => e.display),
  ]
    .join("\n")
    .match(/node_modules|pnpm-lock|package-lock/);
  checks.push({
    name: "no_path_leak",
    ok: !leak,
    detail: leak ? `leaked ${leak[0]}` : "clean",
  });

  const evidenceBlob = [
    ...toolDisplays,
    ...input.recommendation.evidence.map((e) => e.display),
    input.recommendation.summary,
  ]
    .join("\n")
    .toLowerCase();
  // Agents must not receive chaos ground truth (scenario=… / active_faults).
  const scenarioLeak = evidenceBlob.match(
    /scenario\s*[:=]\s*(n_plus_one|payment_timeout|error_spike|pool_exhaustion)|active_faults|chaos injected scenario/,
  );
  checks.push({
    name: "no_scenario_leak",
    ok: !scenarioLeak,
    detail: scenarioLeak ? `leaked ${scenarioLeak[0]}` : "clean",
  });

  return { pass: checks.every((c) => c.ok), checks };
}
