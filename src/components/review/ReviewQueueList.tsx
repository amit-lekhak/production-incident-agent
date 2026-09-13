import Link from "next/link";
import { ReviewActions } from "@/components/review/ReviewActions";
import {
  actionLabel,
  actionTargetLabel,
  looksLikeDump,
  nextStepHint,
  operatorSummary,
  operatorIncidentTitle,
  statusLabel,
} from "@/lib/ui/labels";
import { formatLocalTime, formatOpenedAgo } from "@/lib/ui/time";
import type { PendingReviewRow } from "@/lib/review/pending";

export function ReviewQueueList({
  rows,
  hasPr,
  emptyMessage,
}: {
  rows: PendingReviewRow[];
  hasPr: boolean;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="panel p-4 text-sm text-(--muted)">{emptyMessage}</div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const target = actionTargetLabel(
          row.recommended_action,
          row.action_target,
        );
        const summary = operatorSummary({
          cause: row.headline,
          action: row.recommended_action,
          target: row.action_target,
          summary: row.summary,
        });
        const evidence = row.evidence ?? [];
        const showRawSummary =
          row.summary &&
          looksLikeDump(row.summary) &&
          row.summary.trim() !== summary;

        return (
          <div key={row.review_id} className="panel space-y-3 p-4">
            <div>
              <Link
                href={`/incidents/${row.incident_id}`}
                className="font-medium text-(--accent)"
              >
                {row.headline ? row.headline : operatorIncidentTitle(row.title)}
              </Link>
              {row.headline ? (
                <div className="mt-1 text-xs text-(--muted)">
                  Triggered by {operatorIncidentTitle(row.title)}
                </div>
              ) : null}
              <div className="mt-1 text-xs text-(--muted)">
                <time
                  dateTime={row.opened_at}
                  title={formatLocalTime(row.opened_at)}
                >
                  {formatOpenedAgo(row.opened_at)}
                </time>
                {" · "}
                {row.severity}
                {" · "}
                {statusLabel(row.status)}
              </div>

              <dl className="mt-3 space-y-1 text-sm">
                <div>
                  <dt className="inline text-(--muted)">Likely cause: </dt>
                  <dd className="inline font-medium">
                    {row.headline ?? "Unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-(--muted)">Recommend: </dt>
                  <dd className="inline font-medium">
                    {actionLabel(row.recommended_action)}
                    {target ? ` → ${target}` : ""}
                    {` (${row.confidence}% confidence)`}
                  </dd>
                </div>
                <div>
                  <dt className="inline text-(--muted)">Next: </dt>
                  <dd className="inline">
                    {nextStepHint({
                      status: row.status,
                      action: row.recommended_action,
                      hasPr: Boolean(row.pr_number) || hasPr,
                    })}
                  </dd>
                </div>
              </dl>

              <p className="mt-2 text-sm text-(--muted)">{summary}</p>

              {row.pr_url ? (
                <p className="mt-2 text-sm">
                  <span className="text-(--muted)">
                    Proposed remediation (awaiting merge):{" "}
                  </span>
                  <a
                    href={row.pr_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-(--accent) underline"
                  >
                    GitHub PR #{row.pr_number}
                  </a>
                </p>
              ) : null}
            </div>

            <ReviewActions incidentId={row.incident_id} hasPr={hasPr} />

            {(evidence.length > 0 || showRawSummary) && (
              <details className="rounded-lg border border-(--line) p-3 text-xs text-(--muted)">
                <summary className="cursor-pointer text-sm text-foreground">
                  Technical evidence
                </summary>
                {showRawSummary ? (
                  <p className="mt-2 whitespace-pre-wrap">{row.summary}</p>
                ) : null}
                <ul className="mt-2 space-y-1">
                  {evidence.map((e, i) => (
                    <li key={i}>
                      [{e.supports ? "supports" : "against"}] {e.tool}:{" "}
                      {e.display}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
