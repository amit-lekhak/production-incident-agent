import Link from "next/link";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function IncidentsPage() {
  const rows = await sql<
    {
      id: string;
      title: string;
      status: string;
      severity: string;
      trigger_metric: string | null;
      opened_at: string;
      confidence: number | null;
      recommended_action: string | null;
    }[]
  >`
    SELECT
      i.id::text AS id,
      i.title,
      i.status,
      i.severity,
      i.trigger_metric,
      i.opened_at::text,
      r.confidence,
      r.recommended_action
    FROM incidents i
    LEFT JOIN LATERAL (
      SELECT confidence, recommended_action
      FROM recommendations
      WHERE incident_id = i.id
      ORDER BY created_at DESC
      LIMIT 1
    ) r ON true
    ORDER BY i.opened_at DESC
    LIMIT 50
  `;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Incidents</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Opened by the watcher when alert rules fire against live metrics.
        </p>
      </header>
      <div className="panel divide-y divide-[var(--line)]">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-[var(--muted)]">No incidents yet.</p>
        ) : (
          rows.map((r) => (
            <Link
              key={r.id}
              href={`/incidents/${r.id}`}
              className="flex flex-col gap-1 px-4 py-3 hover:bg-[#0f172a] sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-medium">{r.title}</div>
                <div className="text-xs text-[var(--muted)]">{r.opened_at}</div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="badge bg-[var(--line)]">{r.status}</span>
                {r.recommended_action ? (
                  <span className="badge bg-[#0c4a6e] text-[var(--accent)]">
                    {r.recommended_action}
                    {r.confidence != null ? ` · ${r.confidence}%` : ""}
                  </span>
                ) : null}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
