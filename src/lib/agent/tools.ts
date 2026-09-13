import { sql } from "@/lib/db";
import { codeExplain, codePath, codeQuery } from "@/lib/codegraph/query";
import { getReleaseProvider } from "@/lib/release";

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
      const byName = new Map<string, number[]>();
      for (const r of rows) {
        const list = byName.get(r.name) ?? [];
        list.push(r.value);
        byName.set(r.name, list);
      }
      const summaries = [...byName.entries()].map(([name, values]) => {
        const latest = values[0] ?? 0;
        const avg =
          values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
        return `${displayMetric(name, latest)} (n=${values.length}, avg≈${displayMetric(name, avg).split("=")[1]})`;
      });
      return {
        display: summaries.join("; ") || "no samples",
        sampleCount: rows.length,
        latestByName: Object.fromEntries(
          [...byName.entries()].map(([name, values]) => [name, values[0] ?? 0]),
        ),
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
      const examples = rows.slice(0, 3).map((r) => `[${r.level}] ${r.message}`);
      return {
        display:
          rows.length === 0
            ? "no logs"
            : `${rows.length} lines; examples: ${examples.join(" | ")}`,
        count: rows.length,
        examples,
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
        poolWaitMs:
          (r.spans ?? []).find((s) => s.name === "db.pool.wait")?.durationMs ??
          null,
      }));
      const n = catalogCounts.length;
      const avg = (vals: number[]) =>
        vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
      const avgCatalogLookups = avg(catalogCounts.map((c) => c.catalogLookups));
      const durations = catalogCounts
        .map((c) => c.durationMs)
        .sort((a, b) => a - b);
      const p95DurationMs =
        durations.length === 0
          ? 0
          : durations[
              Math.min(
                durations.length - 1,
                Math.floor(durations.length * 0.95),
              )
            ]!;
      const payMs = catalogCounts
        .map((c) => c.paymentMs ?? 0)
        .filter((v) => v > 0);
      const poolMs = catalogCounts
        .map((c) => c.poolWaitMs ?? 0)
        .filter((v) => v > 0);
      const examples = catalogCounts
        .slice(0, 2)
        .map(
          (c) =>
            `${c.requestId}: ${c.durationMs}ms, catalog.lookup×${c.catalogLookups}, pay=${c.paymentMs ?? "—"}ms, pool=${c.poolWaitMs ?? "—"}ms`,
        );
      return {
        display:
          n === 0
            ? "no traces"
            : `n=${n} avg catalog.lookup×${avgCatalogLookups.toFixed(1)} p95=${Math.round(p95DurationMs)}ms avgPay=${payMs.length ? Math.round(avg(payMs)) : "—"}ms avgPool=${poolMs.length ? Math.round(avg(poolMs)) : "—"}ms; examples: ${examples.join("; ") || "none"}`,
        sampleCount: n,
        avgCatalogLookups,
        p95DurationMs,
        avgPaymentMs: payMs.length ? avg(payMs) : 0,
        avgPoolWaitMs: poolMs.length ? avg(poolMs) : 0,
        examples: catalogCounts.slice(0, 2),
      };
    },

    async list_deployments(input: { limit?: number } = {}) {
      const limit = Math.min(input.limit ?? 10, 20);
      const provider = getReleaseProvider();
      const rows = await provider.listDeployments(limit);
      return {
        display: rows
          .map(
            (r, i) =>
              `${r.sha.slice(0, 12)} (${i === 0 ? "active" : "previous"}) ${r.description}`,
          )
          .join("; "),
        rows: rows.map((r, i) => ({
          sha: r.sha,
          version: r.description,
          status: i === 0 ? "active" : "previous",
          summary: r.description,
          deployed_at: r.createdAt,
        })),
      };
    },

    async list_commits(input: { limit?: number } = {}) {
      const limit = Math.min(input.limit ?? 10, 20);
      const provider = getReleaseProvider();
      const rows = await provider.listCommits(limit);
      return {
        display: rows.map((r) => `${r.sha}: ${r.message}`).join("; "),
        rows: rows.map((r) => ({
          sha: r.sha,
          message: r.message,
          author: r.author,
          files_changed: r.filesChanged,
          committed_at: r.committedAt,
        })),
      };
    },

    async read_source(input: { path: string; sha?: string }) {
      const provider = getReleaseProvider();
      const deploy = await provider.currentDeploy();
      const sha = input.sha ?? deploy?.sha;
      if (!sha) {
        return { display: "no production deploy SHA", text: "", sha: null };
      }
      try {
        const text = await provider.getFile(sha, input.path);
        const display = `${input.path}@${sha.slice(0, 12)} (${text.length} chars)\n${text.slice(0, 1200)}`;
        return { display, text, sha };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { display: `read_source failed: ${message}`, text: "", sha };
      }
    },

    async diff_deploys(input: { base?: string; head?: string } = {}) {
      const provider = getReleaseProvider();
      const deploys = await provider.listDeployments(5);
      const head = input.head ?? deploys[0]?.sha;
      const base = input.base ?? deploys[1]?.sha;
      if (!head || !base) {
        return {
          display: "need at least two production deploys to diff",
          diff: "",
          base: base ?? null,
          head: head ?? null,
        };
      }
      const diff = await provider.diff(base, head);
      return {
        display: `diff ${base.slice(0, 12)}...${head.slice(0, 12)}\n${diff.slice(0, 2000)}`,
        diff,
        base,
        head,
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
        catalogAvgMs: avg,
        catalogCount: catalog.length,
        sampleCount: rows.length,
      };
    },

    async list_similar_incidents(
      input: { searchHint?: string; limit?: number } = {},
    ) {
      const limit = Math.min(input.limit ?? 5, 10);
      const hint = input.searchHint?.trim();
      const rows = await sql<
        {
          id: string;
          title: string;
          status: string;
          headline: string | null;
          recommended_action: string | null;
          summary: string | null;
        }[]
      >`
        SELECT
          i.id::text AS id,
          i.title,
          i.status,
          h.headline,
          r.recommended_action,
          r.summary
        FROM incidents i
        LEFT JOIN LATERAL (
          SELECT headline, why FROM hypotheses WHERE incident_id = i.id ORDER BY rank ASC LIMIT 1
        ) h ON true
        LEFT JOIN LATERAL (
          SELECT recommended_action, summary FROM recommendations WHERE incident_id = i.id ORDER BY created_at DESC LIMIT 1
        ) r ON true
        WHERE i.service_id = ${rt.serviceId}
          AND i.id <> ${rt.incidentId}::uuid
          AND i.status = 'resolved'
          ${
            hint
              ? sql`AND (
                  h.headline ILIKE ${"%" + hint + "%"}
                  OR h.why ILIKE ${"%" + hint + "%"}
                  OR i.title ILIKE ${"%" + hint + "%"}
                  OR r.summary ILIKE ${"%" + hint + "%"}
                )`
              : sql``
          }
        ORDER BY i.opened_at DESC
        LIMIT ${limit}
      `;
      return {
        display:
          rows
            .map(
              (r) =>
                `${r.headline ?? r.title} → ${r.recommended_action ?? "n/a"}`,
            )
            .join("; ") || "none",
        rows,
      };
    },

    async get_service_health() {
      const provider = getReleaseProvider();
      const deploy = await provider.currentDeploy();
      const metrics = await sql<{ name: string; value: number }[]>`
        SELECT DISTINCT ON (name) name, value
        FROM metric_samples
        WHERE service_id = ${rt.serviceId}
        ORDER BY name, sampled_at DESC
      `;
      const flags = await sql<{ key: string; enabled: boolean }[]>`
        SELECT key, enabled FROM feature_flags
        WHERE service_id = ${rt.serviceId}
        ORDER BY key
      `;
      // Do not expose chaos scenario / active_faults — agents must diagnose from signals.
      return {
        display: `active=${deploy?.sha?.slice(0, 12) ?? "none"}; flags=${flags
          .map((f) => `${f.key}=${f.enabled}`)
          .join(",")}; metrics=${metrics
          .map((m) => displayMetric(m.name, m.value))
          .join(", ")}`,
        deploy: deploy
          ? { sha: deploy.sha, version: deploy.description }
          : null,
        flags,
        metrics,
      };
    },

    async code_query(input: { question: string }) {
      return codeQuery(input.question, 1500);
    },

    async code_path(input: { from: string; to: string }) {
      return codePath(input.from, input.to, 1500);
    },

    async code_explain(input: { symbol: string }) {
      return codeExplain(input.symbol, 1500);
    },
  };
}

export type IncidentTools = ReturnType<typeof buildTools>;
