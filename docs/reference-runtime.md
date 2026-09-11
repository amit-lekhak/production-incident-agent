# Reference: Runtime

## HTTP

| Method   | Path                      | Purpose                                                       |
| -------- | ------------------------- | ------------------------------------------------------------- |
| GET/POST | `/sim/checkout`           | Simulated checkout (fault-aware)                              |
| GET/POST | `/api/chaos`              | List scenarios / inject / clear / tick / watch                |
| POST     | `/api/incidents/diagnose` | `{ incidentId, forceOracle? }`                                |
| POST     | `/api/reviews`            | `{ incidentId, decision: approved\|rejected\|more_evidence }` |

## Tools (read-only)

`query_metrics`, `query_logs`, `query_traces`, `list_deployments`, `list_commits`, `list_errors`, `query_db_timings`, `list_similar_incidents`, `get_service_health`, `code_query`, `code_path`, `code_explain`.

## Env

See `.env.example`. Langfuse and Sentry are optional. `GEMINI_API_KEY` enables live specialists; otherwise the oracle path runs.
