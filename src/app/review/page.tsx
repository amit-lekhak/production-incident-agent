import Link from "next/link";
import { sql } from "@/lib/db";
import { ReviewActions } from "@/components/review/ReviewActions";

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
      v.id AS review_id
    FROM reviews v
    JOIN incidents i ON i.id = v.incident_id
    JOIN recommendations r ON r.id = v.recommendation_id
    WHERE v.decision = 'pending' AND i.status = 'awaiting_review'
    ORDER BY v.created_at ASC
  `;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Humans approve actions. The LLM never mutates deploys or flags.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="panel p-4 text-sm text-[var(--muted)]">
          Queue empty. Inject a fault, wait for an incident, then run diagnose.
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => (
            <div key={row.review_id} className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/incidents/${row.incident_id}`}
                    className="font-medium text-[var(--accent)]"
                  >
                    {row.title}
                  </Link>
                  <div className="mt-1 text-sm">
                    <span className="badge bg-[#0c4a6e] text-[var(--accent)]">
                      {row.recommended_action} → {row.action_target}
                    </span>
                    <span className="ml-2 badge bg-[var(--line)]">
                      {row.confidence}%
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[var(--muted)]">
                    {row.summary}
                  </p>
                </div>
              </div>
              <ReviewActions incidentId={row.incident_id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
