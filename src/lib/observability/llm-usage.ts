import { sql } from "@/lib/db";

export type LlmUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
};

/** Persist one generation's token usage and roll up onto the incident. */
export async function recordLlmUsage(input: {
  incidentId: string;
  functionId: string;
  usage?: LlmUsage | null;
  latencyMs?: number | null;
}): Promise<void> {
  const inn = input.usage?.inputTokens ?? null;
  const out = input.usage?.outputTokens ?? null;
  const total =
    input.usage?.totalTokens ??
    (inn != null || out != null ? (inn ?? 0) + (out ?? 0) : null);

  await sql`
    INSERT INTO llm_generations (
      incident_id, function_id, input_tokens, output_tokens, total_tokens, latency_ms
    )
    VALUES (
      ${input.incidentId}::uuid,
      ${input.functionId},
      ${inn},
      ${out},
      ${total},
      ${input.latencyMs ?? null}
    )
  `;

  if (inn == null && out == null) return;

  await sql`
    UPDATE incidents
    SET
      input_tokens = COALESCE(input_tokens, 0) + ${inn ?? 0},
      output_tokens = COALESCE(output_tokens, 0) + ${out ?? 0},
      updated_at = NOW()
    WHERE id = ${input.incidentId}::uuid
  `;
}

export async function clearLlmUsage(incidentId: string): Promise<void> {
  await sql`DELETE FROM llm_generations WHERE incident_id = ${incidentId}::uuid`;
  await sql`
    UPDATE incidents
    SET input_tokens = NULL, output_tokens = NULL, updated_at = NOW()
    WHERE id = ${incidentId}::uuid
  `;
}

export function formatTokenCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
