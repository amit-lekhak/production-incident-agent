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

`detected` → `investigating` → `awaiting_review` → `acting` → `verifying` → `resolved`

Also: `needs_human`, `closed_rejected`. Diagnose CAS only from `detected` | `needs_human` | `awaiting_review`. Review requires `awaiting_review` and a pending review row.

## Tools (read-only)

`query_metrics`, `query_logs`, `query_traces`, `list_deployments`, `list_commits`, `list_errors`, `query_db_timings`, `list_similar_incidents`, `get_service_health`, `code_query`, `code_path`, `code_explain`.

## Env

See `.env.example`. `DATABASE_URL` is required. Langfuse is optional. `GEMINI_API_KEY` enables live specialists; otherwise the oracle path runs. Watcher/ticker/verify knobs and `METRIC_RETENTION_HOURS` are validated via Zod in `src/lib/env.ts`.
