import { sql } from "@/lib/db";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** Durable operator timeline for /incidents/[id] — not an APM span store. */
export async function appendIncidentEvent(input: {
  incidentId: string;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
}) {
  await sql`
    INSERT INTO incident_events (incident_id, kind, message, meta)
    VALUES (
      ${input.incidentId}::uuid,
      ${input.kind},
      ${input.message},
      ${jsonb(input.meta ?? {})}
    )
  `;
}

export async function setIncidentStatus(
  incidentId: string,
  status: string,
  patch: {
    needsHumanReason?: string | null;
    langfuseTraceId?: string | null;
  } = {},
) {
  await sql`
    UPDATE incidents
    SET status = ${status},
        updated_at = NOW(),
        needs_human_reason = COALESCE(${patch.needsHumanReason ?? null}, needs_human_reason),
        langfuse_trace_id = COALESCE(${patch.langfuseTraceId ?? null}, langfuse_trace_id),
        resolved_at = CASE
          WHEN ${status} IN ('resolved', 'closed_rejected') THEN NOW()
          ELSE resolved_at
        END
    WHERE id = ${incidentId}::uuid
  `;
}

export function langfuseTraceUrl(
  traceId: string | null | undefined,
): string | null {
  if (!traceId) return null;
  if (!process.env.LANGFUSE_PUBLIC_KEY) return null;
  const host = (
    process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com"
  ).replace(/\/$/, "");
  return `${host}/trace/${traceId}`;
}
