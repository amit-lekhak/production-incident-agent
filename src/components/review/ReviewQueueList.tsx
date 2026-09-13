import Link from "next/link";
import { ReviewActions } from "@/components/review/ReviewActions";
import { actionLabel, shortSha } from "@/lib/ui/labels";
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
      {rows.map((row) => (
        <div key={row.review_id} className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Link
                href={`/incidents/${row.incident_id}`}
                className="font-medium text-(--accent)"
              >
                {row.title}
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="badge bg-[#0c4a6e] text-(--accent)">
                  {actionLabel(row.recommended_action)}
                  {row.recommended_action === "revert_pr" ||
                  row.recommended_action === "rollback"
                    ? ` → ${shortSha(row.action_target)}`
                    : row.action_target
                      ? ` → ${row.action_target}`
                      : ""}
                </span>
                <span className="badge bg-(--line)">
                  {row.confidence}% confidence
                </span>
              </div>
              <p className="mt-2 text-sm text-(--muted)">{row.summary}</p>
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
                  {row.pr_head_sha ? (
                    <span className="ml-2 font-mono text-xs text-(--muted)">
                      {shortSha(row.pr_head_sha)}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          </div>
          <ReviewActions incidentId={row.incident_id} hasPr={hasPr} />
        </div>
      ))}
    </div>
  );
}
