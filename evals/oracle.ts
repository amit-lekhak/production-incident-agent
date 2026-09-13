import "../src/lib/load-env";
import { injectFault, clearFaults, getServiceId } from "../src/lib/sim/faults";
import { tickOnce } from "../src/lib/sim/ticker";
import { buildTools } from "../src/lib/agent/tools";
import { oracleDiagnose } from "../src/lib/agent/specialists";
import { getReleaseProvider } from "../src/lib/release";
import { sql } from "../src/lib/db";
import { EVAL_CASES, type EvalCase } from "./cases";
import { installLocalRelease, uninstallLocalRelease } from "./local-release";
import type { LocalReleaseProvider } from "../src/lib/release";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export type OracleCase = EvalCase;
export const ORACLE_CASES = EVAL_CASES;

let provider: LocalReleaseProvider | null = null;

export async function setupOracleEnv() {
  provider = await installLocalRelease();
}

export function teardownOracleEnv() {
  uninstallLocalRelease(provider ?? undefined);
  provider = null;
}

export async function runOracleCase(c: EvalCase) {
  if (!provider) await setupOracleEnv();
  await clearFaults();
  const serviceId = await getServiceId();
  // Clear scenario leftovers so metrics/errors from prior cases do not bleed.
  await sql`
    DELETE FROM error_events WHERE service_id = ${serviceId}
  `;
  await sql`
    DELETE FROM metric_samples
    WHERE service_id = ${serviceId}
      AND name IN ('payments_latency_p99', 'checkout_error_rate', 'db_pool_wait_ms')
  `;
  await injectFault(c.scenario);
  await tickOnce();

  if (c.scenario === "payment_timeout") {
    await sql`
      INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
      VALUES (
        ${serviceId},
        'payments_latency_p99',
        2200,
        ${jsonb({ dependency: "payments" })},
        NOW()
      )
    `;
  }
  if (c.scenario === "error_spike") {
    await sql`
      INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
      VALUES (
        ${serviceId},
        'checkout_error_rate',
        0.4,
        ${jsonb({ service: "relay-checkout" })},
        NOW()
      )
    `;
  }

  const rt = {
    serviceId,
    incidentId: "00000000-0000-0000-0000-000000000001",
  };
  const tools = buildTools(rt);
  const traces = await tools.query_traces({ limit: 5 });
  const code = await tools.code_query({
    question: "N+1 lookupProductNPlusOne",
  });
  if (code.text.includes("node_modules") || code.text.includes("pnpm-lock")) {
    throw new Error("code tools leaked blocked paths");
  }

  const out = await oracleDiagnose(rt);
  const headline = out.hypotheses.hypotheses[0]?.headline ?? "";
  const why = out.hypotheses.hypotheses[0]?.why ?? "";
  const action = out.recommendation.recommended_action;
  const target = out.recommendation.action_target;
  const active = await getReleaseProvider().currentDeploy();

  const targetOk =
    c.expectTarget === "active_sha"
      ? target === active?.sha
      : c.expectTarget
        ? target === c.expectTarget
        : true;

  const blob = `${headline}\n${why}`.toLowerCase();
  const headlineOk = c.expectHeadlineIncludes.some((p) =>
    blob.includes(p.toLowerCase()),
  );

  const pass =
    headlineOk &&
    action === c.expectAction &&
    targetOk &&
    (c.expectNotAction ? action !== c.expectNotAction : true);

  return {
    id: c.id,
    pass,
    headline,
    action,
    target,
    confidence: out.recommendation.confidence_0_100,
    tracesDisplay: traces.display.slice(0, 200),
    codeDisplay: code.display,
  };
}
