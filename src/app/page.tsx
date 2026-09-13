import { sql } from "@/lib/db";
import { getReleaseProvider } from "@/lib/release";

export const dynamic = "force-dynamic";

async function loadOverview() {
  const [service] = await sql<{ id: number; name: string }[]>`
    SELECT id, name FROM services WHERE slug = 'relay-checkout' LIMIT 1
  `;
  if (!service) {
    return { service: null, metrics: [], incidents: [], deploy: null };
  }

  const metrics = await sql<
    { name: string; value: number; sampled_at: string }[]
  >`
    SELECT DISTINCT ON (name) name, value, sampled_at::text
    FROM metric_samples
    WHERE service_id = ${service.id}
    ORDER BY name, sampled_at DESC
  `;

  const incidents = await sql<
    { id: string; title: string; status: string; opened_at: string }[]
  >`
    SELECT id::text AS id, title, status, opened_at::text
    FROM incidents
    WHERE service_id = ${service.id} AND status NOT IN ('resolved', 'closed_rejected')
    ORDER BY opened_at DESC
    LIMIT 10
  `;

  // Deployments live on GitHub (table dropped in 0002_drop_git_tables).
  let deploy: { sha: string; version: string; summary: string } | null = null;
  try {
    const current = await getReleaseProvider().currentDeploy();
    if (current) {
      deploy = {
        sha: current.sha.slice(0, 12),
        version: current.description || current.environment,
        summary: current.description,
      };
    }
  } catch {
    deploy = null;
  }

  return { service, metrics, incidents, deploy };
}

export default async function HomePage() {
  const { service, metrics, incidents, deploy } = await loadOverview();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Production overview
        </h1>
        <p className="mt-1 text-sm text-(--muted)">
          Simulated Relay Checkout world. Inject faults from Chaos, then watch
          incidents open.
        </p>
      </header>

      {!service ? (
        <div className="panel p-4 text-sm text-(--warn)">
          Database not seeded yet. Run{" "}
          <code className="font-mono">pnpm db:push && pnpm db:seed</code>.
        </div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <div className="panel p-4">
              <div className="text-xs uppercase tracking-wide text-(--muted)">
                Service
              </div>
              <div className="mt-1 text-lg font-medium">{service.name}</div>
            </div>
            <div className="panel p-4">
              <div className="text-xs uppercase tracking-wide text-(--muted)">
                Active deploy
              </div>
              <div className="mt-1 font-mono text-sm text-(--accent)">
                {deploy?.sha ?? "—"}
              </div>
              <div className="text-xs text-(--muted)">
                {deploy?.version}
              </div>
            </div>
            <div className="panel p-4">
              <div className="text-xs uppercase tracking-wide text-(--muted)">
                Open incidents
              </div>
              <div className="mt-1 text-lg font-medium">{incidents.length}</div>
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">Latest metrics</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {metrics.map((m) => (
                <div
                  key={m.name}
                  className="rounded-lg border border-(--line) p-3"
                >
                  <div className="font-mono text-xs text-(--muted)">
                    {m.name}
                  </div>
                  <div className="mt-1 text-xl font-semibold">
                    {m.name.includes("rate")
                      ? `${(m.value * 100).toFixed(2)}%`
                      : `${Math.round(m.value)}${m.name.includes("latency") || m.name.includes("wait") ? "ms" : ""}`}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel p-4">
            <h2 className="mb-3 text-sm font-semibold">Active incidents</h2>
            {incidents.length === 0 ? (
              <p className="text-sm text-(--muted)">
                None open. Healthy baseline is seeded.
              </p>
            ) : (
              <ul className="space-y-2">
                {incidents.map((i) => (
                  <li key={i.id}>
                    <a
                      href={`/incidents/${i.id}`}
                      className="flex items-center justify-between rounded-lg border border-(--line) px-3 py-2 hover:border-(--accent)"
                    >
                      <span>{i.title}</span>
                      <span className="badge bg-(--line) text-(--warn)">
                        {i.status}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
