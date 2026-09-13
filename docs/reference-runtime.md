# Reference: Runtime

## HTTP

| Method   | Path                      | Purpose                                                     |
| -------- | ------------------------- | ----------------------------------------------------------- |
| GET      | `/api/health`             | Postgres + ticker/watcher/Gemini/Langfuse status            |
| GET/POST | `/sim/checkout`           | Simulated checkout (fault-aware)                            |
| GET/POST | `/api/chaos`              | List scenarios / inject / clear / tick / watch              |
| POST     | `/api/incidents/diagnose` | `{ incidentId, forceOracle? }` — only from allowed statuses |
| POST     | `/api/reviews`            | `{ incidentId, decision }` — claims pending review once     |

## Status machine

`detected` → (`AUTO_DIAGNOSE`) → `investigating` → `awaiting_review` → `acting` → `verifying` → `resolved`

Also: `needs_human`, `closed_rejected`. Diagnose CAS only from `detected` | `needs_human` | `awaiting_review`. Review requires `awaiting_review` and a pending review row. Approving `watch` / `page_human` skips verify. Postmortem failure does not unblock `resolved` once metrics recover.

## Tools (read-only)

`query_metrics`, `query_logs`, `query_traces`, `list_deployments`, `list_commits`, `read_source`, `diff_deploys`, `list_errors`, `query_db_timings`, `list_similar_incidents`, `get_service_health`, `code_query`, `code_path`, `code_explain`.

`get_service_health` returns deploy SHA, feature flags, and latest metrics — not chaos scenario labels.

Commits/deployments come from GitHub (`GITHUB_TOKEN` + `GITHUB_REPO` required). Metrics/incidents stay in Postgres.

## Env

See `.env.example`. `DATABASE_URL`, `GITHUB_TOKEN`, and `GITHUB_REPO` are required. Langfuse is optional. `GEMINI_API_KEY` enables live specialists; otherwise the oracle path runs. Notable knobs: `AUTO_DIAGNOSE`, `DIAGNOSIS_MIN_CONFIDENCE`, `PAGE_WEBHOOK_URL`, `WATCHER_MIN_SAMPLES`, verify/ticker intervals, `METRIC_RETENTION_HOURS` (validated via Zod in `src/lib/env.ts`).
