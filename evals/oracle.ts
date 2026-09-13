import "../src/lib/load-env";
import { injectFault, clearFaults, getServiceId } from "../src/lib/sim/faults";
import { tickOnce } from "../src/lib/sim/ticker";
import { buildTools } from "../src/lib/agent/tools";
import { oracleDiagnose } from "../src/lib/agent/specialists";
import { sql } from "../src/lib/db";
import { EVAL_CASES, type EvalCase } from "./cases";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export type OracleCase = EvalCase;
export const ORACLE_CASES = EVAL_CASES;

export async function runOracleCase(c: EvalCase) {
  await clearFaults();
  await injectFault(c.scenario);
  await tickOnce();

  if (c.scenario === "payment_timeout") {
    const serviceId = await getServiceId();
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

  const serviceId = await getServiceId();
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
  const cause = out.hypotheses.hypotheses[0]?.cause_type;
  const action = out.recommendation.recommended_action;
  const target = out.recommendation.action_target;
  const [active] = await sql<{ sha: string }[]>`
    SELECT sha FROM deployments
    WHERE service_id = ${serviceId} AND status = 'active'
    ORDER BY deployed_at DESC LIMIT 1
  `;

  const targetOk =
    c.expectTarget === "active_sha"
      ? target === active?.sha
      : c.expectTarget
        ? target === c.expectTarget
        : true;

  const pass =
    cause === c.expectCause &&
    action === c.expectAction &&
    targetOk &&
    (c.expectNotAction ? action !== c.expectNotAction : true);

  return {
    id: c.id,
    pass,
    cause,
    action,
    target,
    confidence: out.recommendation.confidence_0_100,
    tracesDisplay: traces.display.slice(0, 200),
    codeDisplay: code.display,
  };
}
