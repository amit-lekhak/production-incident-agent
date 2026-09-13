import Link from "next/link";
import { sql } from "@/lib/db";
import { langfuseTraceUrl } from "@/lib/observability/incident-events";
import { formatTokenCount } from "@/lib/observability/llm-usage";
import {
  eventKindLabel,
  operatorEventMessage,
  operatorIncidentTitle,
  statusLabel,
} from "@/lib/ui/labels";
import { formatLocalTime, formatRelativeTime } from "@/lib/ui/time";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type OpsSearchParams = Promise<{
  page?: string;
  noise?: string;
}>;

export default async function OpsPage({
  searchParams,
}: {
  searchParams: OpsSearchParams;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const showNoise = sp.noise === "1" || sp.noise === "true";

  const [countRow] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM incident_events e
    WHERE ${showNoise ? sql`true` : sql`e.kind <> 'alert_repeat'`}
  `;
  const total = countRow?.n ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * PAGE_SIZE;

  const events = await sql<
    {
      id: number;
      incident_id: string;
      kind: string;
      message: string;
      meta: Record<string, unknown>;
      created_at: string;
      title: string;
      status: string;
      trigger_metric: string | null;
      trigger_value: number | null;
      langfuse_trace_id: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }[]
  >`
    SELECT
      e.id,
      e.incident_id::text AS incident_id,
      e.kind,
      e.message,
      e.meta,
      e.created_at::text,
      i.title,
      i.status,
      i.trigger_metric,
      i.trigger_value,
      i.langfuse_trace_id,
      i.input_tokens,
      i.output_tokens
    FROM incident_events e
    JOIN incidents i ON i.id = e.incident_id
    WHERE ${showNoise ? sql`true` : sql`e.kind <> 'alert_repeat'`}
    ORDER BY e.created_at DESC
    LIMIT ${PAGE_SIZE}
    OFFSET ${offset}
  `;

  const [tokenTotals] = await sql<
    {
      input_tokens: number;
      output_tokens: number;
      incidents_with_usage: number;
    }[]
  >`
    SELECT
      COALESCE(SUM(input_tokens), 0)::int AS input_tokens,
      COALESCE(SUM(output_tokens), 0)::int AS output_tokens,
      COUNT(*) FILTER (WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL)::int AS incidents_with_usage
    FROM incidents
  `;

  const [noiseCount] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM incident_events WHERE kind = 'alert_repeat'
  `;

  const langfuseConfigured = Boolean(
    process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY,
  );

  function pageHref(p: number, noise = showNoise) {
    const q = new URLSearchParams();
    if (p > 1) q.set("page", String(p));
    if (noise) q.set("noise", "1");
    const s = q.toString();
    return s ? `/ops?${s}` : "/ops";
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Ops</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Operator event stream across incidents. LLM tool traces show in
          Langfuse when keys are set.
        </p>
      </header>

      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <div>
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
            {showNoise
              ? `Showing all events · ${total} total`
              : `Quiet mode · ${total} events (hiding ${noiseCount?.n ?? 0} alert repeats)`}
          </div>
          {(tokenTotals?.incidents_with_usage ?? 0) > 0 ? (
            <div className="mt-1 text-(--muted)">
              LLM usage · {formatTokenCount(tokenTotals?.input_tokens)} in /{" "}
              {formatTokenCount(tokenTotals?.output_tokens)} out across{" "}
              {tokenTotals?.incidents_with_usage} incidents
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {showNoise ? (
            <Link
              href={pageHref(1, false)}
              className="rounded-lg border border-(--line) px-3 py-1.5"
            >
              Hide alert noise
            </Link>
          ) : (
            <Link
              href={pageHref(1, true)}
              className="rounded-lg border border-(--line) px-3 py-1.5"
            >
              Show alert repeats
            </Link>
          )}
        </div>
      </div>

      <div className="panel divide-y divide-(--line)">
        {events.length === 0 ? (
          <p className="p-4 text-sm text-(--muted)">No pipeline events yet.</p>
        ) : (
          events.map((e) => {
            const url = langfuseTraceUrl(e.langfuse_trace_id);
            const title = operatorIncidentTitle(e.title, {
              metric: e.trigger_metric,
              value: e.trigger_value,
            });
            const body = operatorEventMessage({
              kind: e.kind,
              message: e.message,
              meta: e.meta,
            });
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
                    {title}
                  </Link>
                  <span className="text-xs text-(--muted)">
                    {statusLabel(e.status)}
                  </span>
                </div>
                <div className="mt-1">{body}</div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-(--muted)">
                  <time
                    dateTime={e.created_at}
                    title={formatLocalTime(e.created_at)}
                  >
                    {formatRelativeTime(e.created_at)}
                    <span className="text-(--muted)">
                      {" "}
                      · {formatLocalTime(e.created_at)}
                    </span>
                  </time>
                  {e.input_tokens != null || e.output_tokens != null ? (
                    <span>
                      {formatTokenCount(e.input_tokens)} in /{" "}
                      {formatTokenCount(e.output_tokens)} out
                    </span>
                  ) : null}
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

      {totalPages > 1 ? (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-sm"
          aria-label="Ops pagination"
        >
          <div className="text-(--muted)">
            Page {safePage} of {totalPages}
          </div>
          <div className="flex gap-2">
            {safePage > 1 ? (
              <Link
                href={pageHref(safePage - 1)}
                className="rounded-lg border border-(--line) px-3 py-1.5"
              >
                Previous
              </Link>
            ) : (
              <span className="rounded-lg border border-(--line) px-3 py-1.5 opacity-40">
                Previous
              </span>
            )}
            {safePage < totalPages ? (
              <Link
                href={pageHref(safePage + 1)}
                className="rounded-lg border border-(--line) px-3 py-1.5"
              >
                Next
              </Link>
            ) : (
              <span className="rounded-lg border border-(--line) px-3 py-1.5 opacity-40">
                Next
              </span>
            )}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
