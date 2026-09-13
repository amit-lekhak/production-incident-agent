import { randomUUID } from "node:crypto";
import { clearFaults, getServiceId, injectFault } from "../src/lib/sim/faults";
import { tickOnce } from "../src/lib/sim/ticker";
import { sql } from "../src/lib/db";
import { getReleaseProvider } from "../src/lib/release";
import { ensureGeminiKey } from "../src/lib/agent/provider-config";
import {
  classifyProviderError,
  isRetryableDiagnosisCode,
} from "../src/lib/agent/provider-errors";
import {
  runEvidenceAgent,
  runIncidentAgent,
} from "../src/lib/agent/specialists";
import type { EvalCase } from "./cases";
import { scoreAgent, type AgentScore } from "./score";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

async function seedScenarioMetrics(c: EvalCase, serviceId: number) {
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
    const deploy = await getReleaseProvider().currentDeploy();
    await sql`
      INSERT INTO error_events (
        service_id, fingerprint, title, message, count, last_seen_at, deploy_sha
      )
      VALUES (
        ${serviceId},
        'null-deref',
        'TypeError: cart.meta',
        'Cannot read properties of undefined',
        42,
        NOW(),
        ${deploy?.sha ?? null}
      )
    `;
  }
}

export type AgentCaseResult = {
  id: string;
  pass: boolean;
  latency_ms: number;
  score: AgentScore;
  cause?: string;
  action?: string;
  error?: string;
};

export async function runAgentCase(c: EvalCase): Promise<AgentCaseResult> {
  ensureGeminiKey();
  const timeoutMs = Number(process.env.EVAL_AGENT_TIMEOUT_MS ?? 180_000);
  const started = Date.now();

  await clearFaults();
  await injectFault(c.scenario);
  await tickOnce();
  const serviceId = await getServiceId();
  await seedScenarioMetrics(c, serviceId);

  const active = await getReleaseProvider().currentDeploy();

  const rt = {
    serviceId,
    incidentId: randomUUID(),
  };
  const title = `Eval ${c.id}: ${c.scenario}`;

  const runOnce = async () => {
    const incident = await runIncidentAgent(rt, title);
    const evidence = await runEvidenceAgent(rt, incident.hypotheses);
    return {
      hypotheses: incident.hypotheses,
      recommendation: evidence.recommendation,
      tools: [...incident.tools, ...evidence.tools],
    };
  };

  try {
    const work = (async () => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await runOnce();
        } catch (err) {
          lastErr = err;
          const classified = classifyProviderError(err);
          if (!isRetryableDiagnosisCode(classified.code)) throw err;
          await sleep(classified.retryAfterMs ?? 2000 * (attempt + 1));
        }
      }
      throw lastErr;
    })();

    const timed = await Promise.race([
      work,
      sleep(timeoutMs).then(() => {
        throw new Error(`EVAL_AGENT_TIMEOUT_MS exceeded (${timeoutMs})`);
      }),
    ]);

    const score = scoreAgent({
      c,
      hypotheses: timed.hypotheses,
      recommendation: timed.recommendation,
      tools: timed.tools,
      activeSha: active?.sha ?? null,
    });

    return {
      id: c.id,
      pass: score.pass,
      latency_ms: Date.now() - started,
      score,
      cause: timed.hypotheses.hypotheses[0]?.headline,
      action: timed.recommendation.recommended_action,
    };
  } catch (err) {
    const classified = classifyProviderError(err);
    return {
      id: c.id,
      pass: false,
      latency_ms: Date.now() - started,
      score: {
        pass: false,
        checks: [
          {
            name: "agent_error",
            ok: false,
            detail: `${classified.code}: ${classified.raw.slice(0, 300)}`,
          },
        ],
      },
      error: classified.raw.slice(0, 500),
    };
  }
}
