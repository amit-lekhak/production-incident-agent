import { sql } from "@/lib/db";
import { codeExplain, codePath, codeQuery } from "@/lib/codegraph/query";

export type ToolRuntime = { serviceId: number; incidentId: string };

function displayMetric(name: string, value: number) {
  if (name.includes("rate")) return `${name}=${(value * 100).toFixed(2)}%`;
  return `${name}=${Math.round(value)}${name.includes("latency") || name.includes("wait") ? "ms" : ""}`;
}

export function buildTools(rt: ToolRuntime) {
  return {
    async query_metrics(input: { name?: string; minutes?: number } = {}) {
      const minutes = input.minutes ?? 15;
      const rows = await sql<
        { name: string; value: number; sampled_at: string }[]
      >`
        SELECT name, value, sampled_at::text
        FROM metric_samples
        WHERE service_id = ${rt.serviceId}
          AND sampled_at > NOW() - (${minutes} || ' minutes')::interval
          ${input.name ? sql`AND name = ${input.name}` : sql``}
        ORDER BY sampled_at DESC
        LIMIT 40
      `;
      return {
        display: rows
          .map((r) => `${displayMetric(r.name, r.value)} @ ${r.sampled_at}`)
          .join("; "),
        rows,
      };
    },

    async query_logs(input: { level?: string; limit?: number } = {}) {
      const limit = Math.min(input.limit ?? 20, 50);
      const rows = await sql<
        { level: string; message: string; logged_at: string }[]
      >`
        SELECT level, message, logged_at::text
        FROM log_lines
        WHERE service_id = ${rt.serviceId}
          ${input.level ? sql`AND level = ${input.level}` : sql``}
        ORDER BY logged_at DESC
        LIMIT ${limit}
      `;
      return {
        display: rows
          .map((r) => `[${r.level}] ${r.message}`)
          .slice(0, 10)
          .join(" | "),
        rows,
      };
    },

    async query_traces(input: { limit?: number } = {}) {
      const limit = Math.min(input.limit ?? 10, 30);
      const rows = await sql<
        {
          request_id: string;
          duration_ms: number;
          status: string;
          spans: Array<{ name: string; durationMs: number }>;
          traced_at: string;
        }[]
      >`
        SELECT request_id, duration_ms, status, spans, traced_at::text
        FROM traces
        WHERE service_id = ${rt.serviceId}
        ORDER BY traced_at DESC
        LIMIT ${limit}
      `;
      const catalogCounts = rows.map((r) => ({
        requestId: r.request_id,
        durationMs: r.duration_ms,
        catalogLookups: (r.spans ?? []).filter(
          (s) => s.name === "catalog.lookup",
        ).length,
        paymentMs:
          (r.spans ?? []).find((s) => s.name === "payments.charge")
            ?.durationMs ?? null,
      }));
      return {
        display: catalogCounts
          .map(
            (c) =>
              `${c.requestId}: ${c.durationMs}ms, catalog.lookup×${c.catalogLookups}, pay=${c.paymentMs ?? "—"}ms`,
          )
          .join("; "),
        rows: catalogCounts,
      };
    },

    async list_deployments(input: { limit?: number } = {}) {
      const limit = Math.min(input.limit ?? 10, 20);
      const rows = await sql<
        {
          sha: string;
          version: string;
          status: string;
          summary: string;
          deployed_at: string;
        }[]
      >`
        SELECT sha, version, status, summary, deployed_at::text
        FROM deployments
        WHERE service_id = ${rt.serviceId}
        ORDER BY deployed_at DESC
        LIMIT ${limit}
      `;
      return {
        display: rows
          .map((r) => `${r.sha} (${r.status}) ${r.summary}`)
          .join("; "),
        rows,
      };
    },

    async list_commits(input: { limit?: number } = {}) {
      const limit = Math.min(input.limit ?? 10, 20);
      const rows = await sql<
        {
          sha: string;
          message: string;
          author: string;
          files_changed: string[];
          committed_at: string;
        }[]
      >`
        SELECT sha, message, author, files_changed, committed_at::text
        FROM commits
        WHERE service_id = ${rt.serviceId}
        ORDER BY committed_at DESC
        LIMIT ${limit}
      `;
      return {
        display: rows.map((r) => `${r.sha}: ${r.message}`).join("; "),
        rows,
      };
    },

    async list_errors(input: { limit?: number } = {}) {
      const limit = Math.min(input.limit ?? 10, 20);
      const rows = await sql<
        {
          fingerprint: string;
          title: string;
          message: string;
          count: number;
          deploy_sha: string | null;
        }[]
      >`
        SELECT fingerprint, title, message, count, deploy_sha
        FROM error_events
        WHERE service_id = ${rt.serviceId}
        ORDER BY last_seen_at DESC
        LIMIT ${limit}
      `;
      return {
        display:
          rows.map((r) => `${r.title} ×${r.count}`).join("; ") ||
          "no error events",
        rows,
      };
    },

    async query_db_timings(input: { minutes?: number } = {}) {
      const minutes = input.minutes ?? 15;
      const rows = await sql<
        { query_name: string; duration_ms: number; sampled_at: string }[]
      >`
        SELECT query_name, duration_ms, sampled_at::text
        FROM db_timings
        WHERE service_id = ${rt.serviceId}
          AND sampled_at > NOW() - (${minutes} || ' minutes')::interval
        ORDER BY sampled_at DESC
        LIMIT 40
      `;
      const catalog = rows.filter((r) => r.query_name === "catalog.lookup");
      const avg =
        catalog.length === 0
          ? 0
          : Math.round(
              catalog.reduce((s, r) => s + r.duration_ms, 0) / catalog.length,
            );
      return {
        display: `catalog.lookup samples=${catalog.length} avg=${avg}ms; total rows=${rows.length}`,
        rows,
        catalogAvgMs: avg,
        catalogCount: catalog.length,
      };
    },

    async list_similar_incidents(
      input: { causeHint?: string; limit?: number } = {},
    ) {
      const limit = Math.min(input.limit ?? 5, 10);
      const rows = await sql<
        {
          id: string;
          title: string;
          status: string;
          cause_type: string | null;
          recommended_action: string | null;
          summary: string | null;
        }[]
      >`
        SELECT
          i.id::text AS id,
          i.title,
          i.status,
          h.cause_type,
          r.recommended_action,
          r.summary
        FROM incidents i
        LEFT JOIN LATERAL (
          SELECT cause_type FROM hypotheses WHERE incident_id = i.id ORDER BY rank ASC LIMIT 1
        ) h ON true
        LEFT JOIN LATERAL (
          SELECT recommended_action, summary FROM recommendations WHERE incident_id = i.id ORDER BY created_at DESC LIMIT 1
        ) r ON true
        WHERE i.service_id = ${rt.serviceId}
          AND i.id <> ${rt.incidentId}::uuid
          AND i.status = 'resolved'
          ${input.causeHint ? sql`AND (h.cause_type ILIKE ${"%" + input.causeHint + "%"} OR i.title ILIKE ${"%" + input.causeHint + "%"})` : sql``}
        ORDER BY i.opened_at DESC
        LIMIT ${limit}
      `;
      return {
        display:
          rows
            .map((r) => `${r.title} → ${r.recommended_action ?? "n/a"}`)
            .join("; ") || "none",
        rows,
      };
    },

    async get_service_health() {
      const [deploy] = await sql<{ sha: string; version: string }[]>`
        SELECT sha, version FROM deployments
        WHERE service_id = ${rt.serviceId} AND status = 'active'
        ORDER BY deployed_at DESC LIMIT 1
      `;
      const metrics = await sql<{ name: string; value: number }[]>`
        SELECT DISTINCT ON (name) name, value
        FROM metric_samples
        WHERE service_id = ${rt.serviceId}
        ORDER BY name, sampled_at DESC
      `;
      const [fault] = await sql<
        { scenario: string; deploy_sha: string | null }[]
      >`
        SELECT scenario, deploy_sha FROM active_faults
        WHERE service_id = ${rt.serviceId} AND active = true
        ORDER BY injected_at DESC LIMIT 1
      `;
      return {
        display: `active=${deploy?.sha ?? "none"}; fault=${fault?.scenario ?? "none"}; metrics=${metrics
          .map((m) => displayMetric(m.name, m.value))
          .join(", ")}`,
        deploy,
        fault,
        metrics,
      };
    },

    async code_query(input: { question: string }) {
      const res = codeQuery(input.question, 1500);
      return { display: res.display, ...res };
    },

    async code_path(input: { from: string; to: string }) {
      const res = codePath(input.from, input.to, 1500);
      return { display: res.display, ...res };
    },

    async code_explain(input: { symbol: string }) {
      const res = codeExplain(input.symbol, 1500);
      return { display: res.display, ...res };
    },
  };
}

export type IncidentTools = ReturnType<typeof buildTools>;
