import Link from "next/link";
import { sql } from "@/lib/db";
import { langfuseTraceUrl } from "@/lib/observability/incident-events";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  const events = await sql<
    {
      id: number;
      incident_id: string;
      kind: string;
      message: string;
      created_at: string;
      title: string;
      status: string;
      langfuse_trace_id: string | null;
    }[]
  >`
    SELECT
      e.id,
      e.incident_id::text AS incident_id,
      e.kind,
      e.message,
      e.created_at::text,
      i.title,
      i.status,
      i.langfuse_trace_id
    FROM incident_events e
    JOIN incidents i ON i.id = e.incident_id
    ORDER BY e.created_at DESC
    LIMIT 40
  `;

  const langfuseConfigured = Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Ops</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Operator timeline from{" "}
          <code className="font-mono">incident_events</code>. LLM/tool
          waterfalls live in Langfuse when configured — not a homemade APM.
        </p>
      </header>

      <div className="panel p-4 text-sm">
        <div>
          Langfuse:{" "}
          <span
            className={
              langfuseConfigured ? "text-[var(--ok)]" : "text-[var(--warn)]"
            }
          >
            {langfuseConfigured
              ? "configured"
              : "not configured (local demo OK)"}
          </span>
        </div>
        <div className="mt-1 text-[var(--muted)]">
          Sentry DSN: {process.env.SENTRY_DSN ? "set" : "unset (noop)"}
        </div>
      </div>

      <div className="panel divide-y divide-[var(--line)]">
        {events.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">
            No pipeline events yet.
          </p>
        ) : (
          events.map((e) => {
            const url = langfuseTraceUrl(e.langfuse_trace_id);
            return (
              <div key={e.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge bg-[var(--line)]">{e.kind}</span>
                  <Link
                    href={`/incidents/${e.incident_id}`}
                    className="text-[var(--accent)]"
                  >
                    {e.title}
                  </Link>
                  <span className="text-xs text-[var(--muted)]">
                    {e.status}
                  </span>
                </div>
                <div className="mt-1">{e.message}</div>
                <div className="mt-1 flex gap-3 text-xs text-[var(--muted)]">
                  <span>{e.created_at}</span>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--accent)]"
                    >
                      Langfuse trace
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
