import { sql } from "@/lib/db";

export type PendingReviewRow = {
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
};

export type PendingReviewFilter = "with_pr" | "without_pr";

export async function listPendingReviews(
  filter: PendingReviewFilter,
): Promise<PendingReviewRow[]> {
  const prClause =
    filter === "with_pr"
      ? sql`r.pr_number IS NOT NULL`
      : sql`r.pr_number IS NULL`;

  return sql<PendingReviewRow[]>`
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
    WHERE v.decision = 'pending'
      AND i.status = 'awaiting_review'
      AND ${prClause}
    ORDER BY v.created_at ASC
  `;
}
