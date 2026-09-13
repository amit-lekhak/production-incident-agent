import Link from "next/link";
import { sql } from "@/lib/db";
import { langfuseTraceUrl } from "@/lib/observability/incident-events";
import { eventKindLabel, statusLabel } from "@/lib/ui/labels";
import { formatLocalTime, formatRelativeTime } from "@/lib/ui/time";

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
        <p className="mt-1 text-sm text-(--muted)">
          Operator event stream across incidents. LLM tool traces show in
          Langfuse when keys are set.
        </p>
      </header>

      <div className="panel p-4 text-sm">
        <div>
          Langfuse:{" "}
          <span
            className={langfuseConfigured ? "text-(--ok)" : "text-(--warn)"}
          >
            {langfuseConfigured
              ? "configured"
              : "not configured (local demo OK)"}
          </span>
        </div>
        <div className="mt-1 text-(--muted)">
          Trace links appear when Langfuse is configured and a diagnosis run
          recorded an OTel trace id.
        </div>
      </div>

      <div className="panel divide-y divide-(--line)">
        {events.length === 0 ? (
          <p className="p-4 text-sm text-(--muted)">No pipeline events yet.</p>
        ) : (
          events.map((e) => {
            const url = langfuseTraceUrl(e.langfuse_trace_id);
            return (
              <div key={e.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="badge bg-(--line)" title={e.kind}>
                    {eventKindLabel(e.kind)}
                  </span>
                  <Link
                    href={`/incidents/${e.incident_id}`}
                    className="text-(--accent)"
                  >
                    {e.title}
                  </Link>
                  <span className="text-xs text-(--muted)">
                    {statusLabel(e.status)}
                  </span>
                </div>
                <div className="mt-1">{e.message}</div>
                <div className="mt-1 flex gap-3 text-xs text-(--muted)">
                  <time
                    dateTime={e.created_at}
                    title={formatLocalTime(e.created_at)}
                  >
                    {formatRelativeTime(e.created_at)}
                  </time>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-(--accent)"
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
