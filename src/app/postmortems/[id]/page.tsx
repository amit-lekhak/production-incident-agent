import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PostmortemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [pm] = await sql<
    {
      id: string;
      incident_id: string;
      title: string;
      summary: string;
      timeline: Array<{ at: string; event: string }>;
      root_cause: string;
      impact: string;
      resolution: string;
      action_items: string[];
      created_at: string;
    }[]
  >`
    SELECT id::text AS id, incident_id::text, title, summary, timeline,
           root_cause, impact, resolution, action_items, created_at::text
    FROM postmortems WHERE id = ${id}::uuid
  `;
  if (!pm) notFound();

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/incidents/${pm.incident_id}`}
          className="text-xs text-(--muted)"
        >
          ← Incident
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{pm.title}</h1>
        <div className="text-xs text-(--muted)">{pm.created_at}</div>
      </header>

      <section className="panel space-y-3 p-4 text-sm">
        <div>
          <h2 className="font-semibold">Summary</h2>
          <p className="text-(--muted)">{pm.summary}</p>
        </div>
        <div>
          <h2 className="font-semibold">Root cause</h2>
          <p className="text-(--muted)">{pm.root_cause}</p>
        </div>
        <div>
          <h2 className="font-semibold">Impact</h2>
          <p className="text-(--muted)">{pm.impact}</p>
        </div>
        <div>
          <h2 className="font-semibold">Resolution</h2>
          <p className="text-(--muted)">{pm.resolution}</p>
        </div>
        <div>
          <h2 className="font-semibold">Timeline</h2>
          <ul className="space-y-1 text-(--muted)">
            {(pm.timeline ?? []).map((t, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{t.at}</span> — {t.event}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-semibold">Action items</h2>
          <ul className="list-disc pl-5 text-(--muted)">
            {(pm.action_items ?? []).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
