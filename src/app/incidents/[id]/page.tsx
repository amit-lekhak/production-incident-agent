import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { langfuseTraceUrl } from "@/lib/observability/incident-events";
import { formatTokenCount } from "@/lib/observability/llm-usage";
import { DiagnoseButton } from "@/components/incidents/DiagnoseButton";
import { CloseIncidentButton } from "@/components/incidents/CloseIncidentButton";
import {
  actionLabel,
  actionTargetLabel,
  eventKindLabel,
  looksLikeDump,
  nextStepHint,
  operatorEventMessage,
  operatorIncidentTitle,
  operatorSummary,
  shortSha,
  statusLabel,
} from "@/lib/ui/labels";
import {
  formatLocalTime,
  formatOpenedAgo,
  formatRelativeTime,
} from "@/lib/ui/time";

export const dynamic = "force-dynamic";

const TIMELINE_PAGE_SIZE = 25;

export default async function IncidentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; noise?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const showNoise = sp.noise === "1" || sp.noise === "true";

  const [incident] = await sql<
    {
      id: string;
      title: string;
      status: string;
      severity: string;
      trigger_metric: string | null;
      trigger_value: number | null;
      suspect_deploy_sha: string | null;
      needs_human_reason: string | null;
      langfuse_trace_id: string | null;
      input_tokens: number | null;
      output_tokens: number | null;
      opened_at: string;
    }[]
  >`
    SELECT id::text AS id, title, status, severity, trigger_metric, trigger_value,
           suspect_deploy_sha, needs_human_reason, langfuse_trace_id,
           input_tokens, output_tokens, opened_at::text
    FROM incidents WHERE id = ${id}::uuid
  `;
  if (!incident) notFound();

  const [eventCount] = await sql<{ n: number; noise: number }[]>`
    SELECT
      count(*) FILTER (
        WHERE ${showNoise ? sql`true` : sql`kind <> 'alert_repeat'`}
      )::int AS n,
      count(*) FILTER (WHERE kind = 'alert_repeat')::int AS noise
    FROM incident_events
    WHERE incident_id = ${id}::uuid
  `;
  const totalEvents = eventCount?.n ?? 0;
  const noiseCount = eventCount?.noise ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalEvents / TIMELINE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * TIMELINE_PAGE_SIZE;

  const events = await sql<
    {
      kind: string;
      message: string;
      meta: Record<string, unknown>;
      created_at: string;
    }[]
  >`
    SELECT kind, message, meta, created_at::text
    FROM incident_events
    WHERE incident_id = ${id}::uuid
      AND ${showNoise ? sql`true` : sql`kind <> 'alert_repeat'`}
    ORDER BY created_at DESC
    LIMIT ${TIMELINE_PAGE_SIZE}
    OFFSET ${offset}
  `;

  const [lastRepeat] = !showNoise
    ? await sql<{ created_at: string }[]>`
        SELECT created_at::text
        FROM incident_events
        WHERE incident_id = ${id}::uuid AND kind = 'alert_repeat'
        ORDER BY created_at DESC
        LIMIT 1
      `
    : [undefined];

  function timelineHref(nextPage: number, noise = showNoise) {
    const q = new URLSearchParams();
    if (nextPage > 1) q.set("page", String(nextPage));
    if (noise) q.set("noise", "1");
    const qs = q.toString();
    return qs ? `/incidents/${id}?${qs}` : `/incidents/${id}`;
  }

  const hypotheses = await sql<
    {
      rank: number;
      headline: string;
      suspect_deploy: string | null;
      why: string;
      supporting_tool_names: string[];
    }[]
  >`
    SELECT rank, headline, suspect_deploy, why, supporting_tool_names
    FROM hypotheses WHERE incident_id = ${id}::uuid
    ORDER BY rank ASC
  `;

  const [rec] = await sql<
    {
      id: number;
      confidence: number;
      recommended_action: string;
      action_target: string;
      summary: string;
      evidence: Array<{ tool: string; display: string; supports: boolean }>;
      pr_number: number | null;
      pr_url: string | null;
    }[]
  >`
    SELECT id, confidence, recommended_action, action_target, summary, evidence,
           pr_number, pr_url
    FROM recommendations WHERE incident_id = ${id}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;

  const generations = await sql<
    {
      function_id: string;
      input_tokens: number | null;
      output_tokens: number | null;
      latency_ms: number | null;
    }[]
  >`
    SELECT function_id, input_tokens, output_tokens, latency_ms
    FROM llm_generations
    WHERE incident_id = ${id}::uuid
    ORDER BY created_at ASC
  `;

  const similar = await sql<{ id: string; title: string; status: string }[]>`
    SELECT id::text AS id, title, status FROM incidents
    WHERE status = 'resolved' AND id <> ${id}::uuid
    ORDER BY opened_at DESC LIMIT 3
  `;

  const [postmortem] = await sql<{ id: string; title: string }[]>`
    SELECT id::text AS id, title FROM postmortems
    WHERE incident_id = ${id}::uuid
    LIMIT 1
  `;

  const traceUrl = langfuseTraceUrl(incident.langfuse_trace_id);
  const topHeadline = hypotheses[0]?.headline ?? null;
  const alertTitle = operatorIncidentTitle(incident.title, {
    metric: incident.trigger_metric,
    value: incident.trigger_value,
  });
  const pageTitle = topHeadline || alertTitle;
  const summary = rec
    ? operatorSummary({
        cause: topHeadline,
        action: rec.recommended_action,
        target: rec.action_target,
        summary: rec.summary,
      })
    : null;
  const target = rec
    ? actionTargetLabel(rec.recommended_action, rec.action_target)
    : "";
  const reviewHref = rec?.pr_number != null ? "/prs" : "/review";
  const hasTokenTotals =
    incident.input_tokens != null || incident.output_tokens != null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/incidents" className="text-xs text-(--muted)">
            ← Incidents
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{pageTitle}</h1>
          {topHeadline ? (
            <p className="mt-1 text-sm text-(--muted)">
              Triggered by {alertTitle}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-(--muted)">
            <time
              dateTime={incident.opened_at}
              title={formatLocalTime(incident.opened_at)}
            >
              {formatOpenedAgo(incident.opened_at)}
            </time>
            <span className="badge bg-(--line) text-foreground">
              {statusLabel(incident.status)}
            </span>
            <span className="badge bg-(--line) text-foreground">
              {incident.severity}
            </span>
            {incident.suspect_deploy_sha ? (
              <span className="badge bg-[#0c4a6e] font-mono text-(--accent)">
                deploy {shortSha(incident.suspect_deploy_sha)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <DiagnoseButton incidentId={id} status={incident.status} />
          {incident.status === "awaiting_review" ? (
            <CloseIncidentButton incidentId={id} />
          ) : null}
        </div>
      </header>

      {incident.needs_human_reason ? (
        <div className="panel border-(--danger) p-4 text-sm text-(--danger)">
          Needs human: {incident.needs_human_reason}
        </div>
      ) : null}

      <section className="panel space-y-2 p-4 text-sm">
        <h2 className="text-sm font-semibold">What&apos;s going on</h2>
        {rec ? (
          <dl className="space-y-1">
            <div>
              <dt className="inline text-(--muted)">Likely cause: </dt>
              <dd className="inline font-medium">{topHeadline ?? "Unknown"}</dd>
            </div>
            <div>
              <dt className="inline text-(--muted)">Recommend: </dt>
              <dd className="inline font-medium">
                {actionLabel(rec.recommended_action)}
                {target ? ` → ${target}` : ""}
                {` (${rec.confidence}% confidence)`}
              </dd>
            </div>
            <div>
              <dt className="inline text-(--muted)">Next: </dt>
              <dd className="inline">
                {nextStepHint({
                  status: incident.status,
                  action: rec.recommended_action,
                  hasPr: Boolean(rec.pr_number),
                })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-(--muted)">
            {nextStepHint({ status: incident.status })}
          </p>
        )}
        {summary ? <p className="text-(--muted)">{summary}</p> : null}
        {hasTokenTotals ? (
          <p className="text-xs text-(--muted)">
            Diagnosis {formatTokenCount(incident.input_tokens)} in /{" "}
            {formatTokenCount(incident.output_tokens)} out
            {generations.length > 0 ? ` · ${generations.length} calls` : ""}
          </p>
        ) : null}
        {generations.length > 0 ? (
          <ul className="text-xs text-(--muted)">
            {generations.map((g, i) => (
              <li key={`${g.function_id}-${i}`}>
                {g.function_id}: {formatTokenCount(g.input_tokens)} in /{" "}
                {formatTokenCount(g.output_tokens)} out
                {g.latency_ms != null ? ` · ${g.latency_ms}ms` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {rec?.pr_url ? (
          <p>
            <span className="text-(--muted)">
              Proposed remediation (awaiting merge):{" "}
            </span>
            <a
              href={rec.pr_url}
              target="_blank"
              rel="noreferrer"
              className="text-(--accent) underline"
            >
              GitHub PR #{rec.pr_number}
            </a>
          </p>
        ) : null}
        {incident.status === "awaiting_review" ? (
          <Link href={reviewHref} className="inline-block text-(--accent)">
            Open {rec?.pr_number != null ? "PRs" : "Review"} →
          </Link>
        ) : null}
        {postmortem ? (
          <p>
            <Link
              href={`/postmortems/${postmortem.id}`}
              className="text-(--accent)"
            >
              Open postmortem →
            </Link>
          </p>
        ) : null}
        {traceUrl ? (
          <a
            href={traceUrl}
            className="block text-(--accent)"
            target="_blank"
            rel="noreferrer"
          >
            Open Langfuse trace
          </a>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Timeline</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {!showNoise && noiseCount > 0 ? (
                <Link
                  href={timelineHref(1, true)}
                  className="text-(--muted) underline"
                >
                  Show {noiseCount} alert repeat
                  {noiseCount === 1 ? "" : "s"}
                  {lastRepeat?.created_at
                    ? ` (last ${formatRelativeTime(lastRepeat.created_at)})`
                    : ""}
                </Link>
              ) : null}
              {showNoise ? (
                <Link
                  href={timelineHref(1, false)}
                  className="text-(--muted) underline"
                >
                  Hide alert repeats
                </Link>
              ) : null}
            </div>
          </div>
          {events.length === 0 ? (
            <p className="text-sm text-(--muted)">No timeline events yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {events.map((e, i) => (
                <li
                  key={`${e.created_at}-${i}`}
                  className="border-l border-(--line) pl-3"
                >
                  <div className="text-xs text-(--muted)" title={e.kind}>
                    {eventKindLabel(e.kind)} ·{" "}
                    <time
                      dateTime={e.created_at}
                      title={formatLocalTime(e.created_at)}
                    >
                      {formatRelativeTime(e.created_at)}
                    </time>
                  </div>
                  <div>
                    {operatorEventMessage({
                      kind: e.kind,
                      message: e.message,
                      meta: e.meta,
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 ? (
            <nav
              className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs"
              aria-label="Timeline pagination"
            >
              <span className="text-(--muted)">
                Page {safePage} of {totalPages}
              </span>
              <div className="flex gap-2">
                {safePage > 1 ? (
                  <Link
                    href={timelineHref(safePage - 1)}
                    className="rounded border border-(--line) px-2 py-1"
                  >
                    Previous
                  </Link>
                ) : null}
                {safePage < totalPages ? (
                  <Link
                    href={timelineHref(safePage + 1)}
                    className="rounded border border-(--line) px-2 py-1"
                  >
                    Next
                  </Link>
                ) : null}
              </div>
            </nav>
          ) : null}
        </div>

        <div className="panel p-4">
          <h2 className="mb-2 text-sm font-semibold">Hypotheses</h2>
          {hypotheses.length === 0 ? (
            <p className="text-sm text-(--muted)">
              Run diagnose to gather hypotheses.
            </p>
          ) : (
            <ul className="space-y-3 text-sm">
              {hypotheses.map((h) => {
                const dump = looksLikeDump(h.why);
                return (
                  <li
                    key={h.rank}
                    className="rounded-lg border border-(--line) p-3"
                  >
                    <div className="font-medium">
                      #{h.rank} {h.headline}
                      {h.suspect_deploy ? (
                        <span className="ml-2 font-mono text-xs text-(--accent)">
                          {shortSha(h.suspect_deploy)}
                        </span>
                      ) : null}
                    </div>
                    {!dump ? (
                      <div className="mt-1 text-(--muted)">{h.why}</div>
                    ) : (
                      <details className="mt-1 text-xs text-(--muted)">
                        <summary className="cursor-pointer">
                          Technical notes
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap">{h.why}</p>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {rec ? (
        <details className="panel p-4 text-sm">
          <summary className="cursor-pointer font-semibold">
            Technical evidence
          </summary>
          {looksLikeDump(rec.summary) ? (
            <p className="mt-2 whitespace-pre-wrap text-xs text-(--muted)">
              {rec.summary}
            </p>
          ) : null}
          <ul className="mt-2 space-y-1 text-xs text-(--muted)">
            {(rec.evidence ?? []).map((e, i) => (
              <li key={i}>
                [{e.supports ? "supports" : "against"}] {e.tool}: {e.display}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <section className="panel p-4">
        <h2 className="mb-2 text-sm font-semibold">Similar past incidents</h2>
        {similar.length === 0 ? (
          <p className="text-sm text-(--muted)">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {similar.map((s) => (
              <li key={s.id}>
                <Link href={`/incidents/${s.id}`} className="text-(--accent)">
                  {operatorIncidentTitle(s.title)}
                </Link>
                <span className="ml-2 text-xs text-(--muted)">
                  {statusLabel(s.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
