import Link from "next/link";
import { sql } from "@/lib/db";
import { formatLocalTime, formatRelativeTime } from "@/lib/ui/time";

export const dynamic = "force-dynamic";

export default async function PostmortemsPage() {
  const rows = await sql<
    {
      id: string;
      incident_id: string;
      title: string;
      summary: string;
      created_at: string;
      incident_title: string;
    }[]
  >`
    SELECT
      p.id::text AS id,
      p.incident_id::text AS incident_id,
      p.title,
      p.summary,
      p.created_at::text,
      i.title AS incident_title
    FROM postmortems p
    JOIN incidents i ON i.id = p.incident_id
    ORDER BY p.created_at DESC
    LIMIT 50
  `;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Postmortems</h1>
        <p className="mt-1 text-sm text-(--muted)">
          Written after a remediation is verified (or a no-op approve). One per
          resolved incident.
        </p>
      </header>

      <div className="panel divide-y divide-(--line)">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-(--muted)">
            No postmortems yet. Merge a revert PR (or approve a non-PR action)
            and wait for verification to finish.
          </p>
        ) : (
          rows.map((r) => (
            <Link
              key={r.id}
              href={`/postmortems/${r.id}`}
              className="block px-4 py-3 hover:bg-[#0f172a]"
            >
              <div className="font-medium">{r.title}</div>
              <div className="mt-1 line-clamp-2 text-sm text-(--muted)">
                {r.summary}
              </div>
              <div
                className="mt-1 text-xs text-(--muted)"
                title={formatLocalTime(r.created_at)}
              >
                Written {formatRelativeTime(r.created_at)}
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
