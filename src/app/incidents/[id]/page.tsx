import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { langfuseTraceUrl } from "@/lib/observability/incident-events";
import { DiagnoseButton } from "@/components/incidents/DiagnoseButton";
import {
  actionLabel,
  actionTargetLabel,
  causeLabel,
  eventKindLabel,
  looksLikeDump,
  nextStepHint,
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

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
      opened_at: string;
    }[]
  >`
    SELECT id::text AS id, title, status, severity, trigger_metric, trigger_value,
           suspect_deploy_sha, needs_human_reason, langfuse_trace_id, opened_at::text
    FROM incidents WHERE id = ${id}::uuid
  `;
  if (!incident) notFound();

  const events = await sql<
    { kind: string; message: string; created_at: string }[]
  >`
    SELECT kind, message, created_at::text
    FROM incident_events WHERE incident_id = ${id}::uuid
    ORDER BY created_at ASC
  `;

  const hypotheses = await sql<
    {
      rank: number;
      cause_type: string;
      suspect_deploy: string | null;
      why: string;
      supporting_tool_names: string[];
    }[]
  >`
    SELECT rank, cause_type, suspect_deploy, why, supporting_tool_names
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

  const similar = await sql<{ id: string; title: string; status: string }[]>`
    SELECT id::text AS id, title, status FROM incidents
    WHERE status = 'resolved' AND id <> ${id}::uuid
    ORDER BY opened_at DESC LIMIT 3
  `;

  const traceUrl = langfuseTraceUrl(incident.langfuse_trace_id);
  const topCause = hypotheses[0]?.cause_type ?? null;
  const summary = rec
    ? operatorSummary({
        cause: topCause,
        action: rec.recommended_action,
        target: rec.action_target,
        summary: rec.summary,
      })
    : null;
  const target = rec
    ? actionTargetLabel(rec.recommended_action, rec.action_target)
    : "";
  const reviewHref = rec?.pr_number != null ? "/prs" : "/review";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/incidents" className="text-xs text-(--muted)">
            ← Incidents
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{incident.title}</h1>
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
        <DiagnoseButton incidentId={id} status={incident.status} />
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
              <dd className="inline font-medium">{causeLabel(topCause)}</dd>
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
          <h2 className="mb-2 text-sm font-semibold">Timeline</h2>
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
                <div>{e.message}</div>
              </li>
            ))}
          </ul>
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
                      #{h.rank} {causeLabel(h.cause_type)}
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
                  {s.title}
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
