import Link from "next/link";
import { sql } from "@/lib/db";
import { ReviewActions } from "@/components/review/ReviewActions";
import { actionLabel, shortSha } from "@/lib/ui/labels";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const rows = await sql<
    {
      incident_id: string;
      title: string;
      status: string;
      recommended_action: string;
      action_target: string;
      confidence: number;
      summary: string;
      review_id: number;
      pr_number: number | null;
      pr_url: string | null;
      pr_head_sha: string | null;
    }[]
  >`
    SELECT
      i.id::text AS incident_id,
      i.title,
      i.status,
      r.recommended_action,
      r.action_target,
      r.confidence,
      r.summary,
      v.id AS review_id,
      r.pr_number,
      r.pr_url,
      r.pr_head_sha
    FROM reviews v
    JOIN incidents i ON i.id = v.incident_id
    JOIN recommendations r ON r.id = v.recommendation_id
    WHERE v.decision = 'pending' AND i.status = 'awaiting_review'
    ORDER BY v.created_at ASC
  `;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Diagnose may open a revert PR so you can inspect the fix. Approve
          merges it and redeploys; reject closes the PR. The model never writes
          to git.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="panel p-4 text-sm text-(--muted)">
          Queue empty. Inject a fault on Chaos, wait for an incident (and
          diagnose), then come back to review the proposed PR.
        </div>
      ) : (
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
              <ReviewActions
                incidentId={row.incident_id}
                hasPr={Boolean(row.pr_number)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
