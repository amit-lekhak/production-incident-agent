# Runtime

HTTP surface, pages, scripts, metrics, and environment for the Relay Incident console. For tools, statuses, and actions see [Agent pipeline](reference-agent-pipeline.md). For tables see [Data model](reference-data-model.md).

The app is a Next.js 16 process. `src/instrumentation.ts` validates env on boot, starts the ticker and watcher in the Node runtime, and optionally registers Langfuse / OpenTelemetry.

## Pages

| Path                | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `/`                 | Overview                                                                      |
| `/chaos`            | Inject / clear / tick / watch                                                 |
| `/incidents`        | Incident list                                                                 |
| `/incidents/[id]`   | Timeline, hypotheses, **Run diagnose** / **Oracle**                           |
| `/review`           | Pending reviews with no PR (`disable_flag`, `restart`, `watch`, `page_human`) |
| `/prs`              | Pending reviews with a revert PR                                              |
| `/postmortems`      | Postmortem list                                                               |
| `/postmortems/[id]` | Single postmortem                                                             |
| `/ops`              | `incident_events` feed (25 per page; `?noise=1` includes `alert_repeat`)      |

APIs are unauthenticated. Anyone who can reach the process can inject faults, spend Gemini tokens, and merge PRs.

## HTTP

All JSON routes below use `dynamic = "force-dynamic"`. Diagnose and reviews set `maxDuration = 120`.

### `GET /api/health`

Postgres probe plus loop status.

**200** when `SELECT 1` succeeds; **503** when it fails.

```json
{
  "ok": true,
  "db": "up",
  "dbError": null,
  "ticker": "running",
  "watcher": "running",
  "github": "owner/repo",
  "gemini": "configured",
  "langfuse": "missing"
}
```

`gemini` is `configured` if `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` is non-empty. `langfuse` is `configured` only if both public and secret keys are set.

### `GET /sim/checkout` and `POST /sim/checkout`

Runs one fault-aware checkout against the deployed Relay Checkout tree. Starts ticker/watcher if needed. POST body is optional (`CheckoutBody`); invalid JSON is treated as `{}`.

Response is the checkout result JSON. Status is the checkout HTTP status (success or injected failure).

### `GET /api/chaos`

```json
{
  "scenarios": [
    {
      "id": "n_plus_one",
      "label": "N+1 catalog lookups",
      "version": "v1.5.0-bad",
      "summary": "Per-item product enrichment introduces N+1 catalog queries",
      "commitMessage": "feat: per-item product enrichment (chaos n_plus_one)",
      "flag": "catalog_enrichment"
    }
  ]
}
```

Ids: `n_plus_one`, `payment_timeout`, `error_spike`, `pool_exhaustion`. `flag` is present only on `n_plus_one` (`catalog_enrichment`) and `payment_timeout` (`payments_v2`).

### `POST /api/chaos`

```ts
{ action: "inject" | "clear" | "tick" | "watch", scenario?: FaultScenario }
```

| action   | Body                | Result                                                                           |
| -------- | ------------------- | -------------------------------------------------------------------------------- |
| `inject` | `scenario` required | `{ injected, watch }` after commit, deploy, one tick, one watcher pass           |
| `clear`  | none                | `{ cleared }`: deactivates `active_faults`, re-syncs runtime from current deploy |
| `tick`   | none                | `{ tick }`: five checkouts, then metric_samples                                  |
| `watch`  | none                | `{ watch }`: `WatchResult[]`                                                     |

**400** if the body fails Zod or `inject` is missing `scenario`.

### `POST /api/incidents/diagnose`

```ts
{ incidentId: string /* uuid */, forceOracle?: boolean }
```

Allowed current statuses: `detected`, `needs_human`, `awaiting_review`. The pipeline CAS-updates to `investigating`.

- `forceOracle: true` or no Gemini key → `oracleDiagnose`
- Otherwise Incident Agent then Evidence Agent

Success: `{ ok: true, status: "awaiting_review", hypotheses, recommendation, recommendationId }`.

Failure after retries: `{ ok: false, status: "needs_human", classified }` or persist/PR errors.

**400** validation (`apiError` `{ ok:false, error:{ code, message } }`). **409** `DiagnosisConflictError`. Provider errors **502** (or **500** if `unknown`).

### `POST /api/reviews`

```ts
{
  incidentId: string, // uuid
  decision: "approved" | "rejected" | "more_evidence",
  note?: string,
  reviewer?: string // default "oncall"
}
```

Incident must exist (**404**) and be `awaiting_review` (**409**). Claims one `pending` review (**409** if none).

| decision                 | Typical JSON                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `rejected`               | `{ ok: true, status: "closed_rejected" }`                                           |
| `more_evidence`          | `{ ok: true, status, diagnosis }`                                                   |
| `approved` + watch/page  | `{ ok: true, status: "resolved", skippedVerify: true }`                             |
| `approved` + verify ok   | `{ ok: true, status: "resolved", postmortemId?, postmortem? }` or `postmortemError` |
| `approved` + action fail | `{ ok: false, status: "needs_human", action }`                                      |
| `approved` + verify fail | `{ ok: false, status: "needs_human", error, verify }`                               |

## Metrics the ticker writes

Each `tickOnce()` runs 5 checkouts and inserts:

| name                   | How it is computed                                          |
| ---------------------- | ----------------------------------------------------------- |
| `checkout_latency_p95` | p95 of the 5 durations                                      |
| `checkout_error_rate`  | errors / 5                                                  |
| `db_pool_wait_ms`      | p95 of `db.pool.wait` spans, or a small idle jitter if none |
| `payments_latency_p99` | p99 of `payments.charge` spans, or idle jitter if none      |

Rows older than `METRIC_RETENTION_HOURS` (default 6) are deleted.

Seeded alert rules (`scripts/seed.ts`):

| Rule                 | metric                 | operator | threshold | window |
| -------------------- | ---------------------- | -------- | --------- | ------ |
| Checkout latency p95 | `checkout_latency_p95` | `>`      | 2000      | 60s    |
| Checkout error rate  | `checkout_error_rate`  | `>`      | 0.05      | 60s    |
| DB pool wait         | `db_pool_wait_ms`      | `>`      | 500       | 60s    |

Watcher aggregation: average for `*rate*`, windowed p95 otherwise. Operators implemented: `>` and `>=`.

## Scripts

| Script                                               | What it runs                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                       | Next.js                                                         |
| `pnpm db:migrate`                                    | Drizzle migrations (+ baseline stamp after old `db:push`)       |
| `pnpm db:push`                                       | `ensure-db` + `drizzle-kit push`                                |
| `pnpm db:seed` / `db:reset`                          | Wipe + seed warehouse                                           |
| `pnpm db:generate`                                   | `drizzle-kit generate`                                          |
| `pnpm service:bootstrap`                             | Git history + production deploy under `services/relay-checkout` |
| `pnpm graph:rebuild`                                 | Rebuild Graphify `graph.json` for the service                   |
| `pnpm eval`                                          | Oracle + live Gemini agents                                     |
| `pnpm eval:oracle`                                   | Oracle only (`LocalReleaseProvider`)                            |
| `pnpm test`                                          | Unit tests on `TEST_DATABASE_URL`                               |
| `pnpm smoke:loop` / `smoke:diagnose` / `smoke:chaos` | CLI end-to-end checks                                           |

## Environment

Validated by Zod in `src/lib/env.ts` unless noted. Invalid boot throws `Invalid environment: …`.

| Name                           | Required | Default                                         | Effect                                               |
| ------------------------------ | -------- | ----------------------------------------------- | ---------------------------------------------------- |
| `DATABASE_URL`                 | yes      | (none)                                          | App Postgres URL                                     |
| `TEST_DATABASE_URL`            | no       | `postgres://localhost:5432/relay_incident_test` | Tests only; **not** in the Zod schema                |
| `GITHUB_TOKEN`                 | yes      | (none)                                          | GitHub PAT                                           |
| `GITHUB_REPO`                  | yes      | (none)                                          | `owner/repo` (regex `^[^/]+/[^/]+$`)                 |
| `GITHUB_DEPLOY_ENV`            | no       | `production`                                    | Deployments environment name                         |
| `GEMINI_API_KEY`               | no       | `""`                                            | Enables live specialists                             |
| `GOOGLE_GENERATIVE_AI_API_KEY` | no       | `""`                                            | Alternate Gemini key                                 |
| `GEMINI_MODEL`                 | no       | `gemini-3.1-flash-lite`                         | Model id                                             |
| `LANGFUSE_SECRET_KEY`          | no       | `""`                                            | With public key, enables OTel export                 |
| `LANGFUSE_PUBLIC_KEY`          | no       | `""`                                            | With secret key, enables OTel export                 |
| `LANGFUSE_HOST`                | no       | `https://cloud.langfuse.com`                    | Langfuse base URL                                    |
| `WATCHER_INTERVAL_MS`          | no       | `5000`                                          | Watcher poll                                         |
| `TICKER_INTERVAL_MS`           | no       | `3000`                                          | Ticker poll                                          |
| `LATENCY_P95_THRESHOLD_MS`     | no       | `2000`                                          | Verifier default for latency metrics                 |
| `ERROR_RATE_THRESHOLD`         | no       | `0.05`                                          | Verifier default for error-rate metrics              |
| `DIAGNOSIS_MAX_RETRIES`        | no       | `2`                                             | Retryable Gemini errors                              |
| `DIAGNOSIS_MIN_CONFIDENCE`     | no       | `60`                                            | Mutating actions below this become `page_human`      |
| `AUTO_DIAGNOSE`                | no       | `true`                                          | Watcher starts diagnosis on open; `"false"` disables |
| `PAGE_WEBHOOK_URL`             | no       | `""`                                            | Optional POST target for `page_human`                |
| `WATCHER_MIN_SAMPLES`          | no       | `2`                                             | Samples required in the alert window                 |
| `VERIFY_SAMPLES`               | no       | `3`                                             | Ticks required during verify                         |
| `VERIFY_INTERVAL_MS`           | no       | `1000`                                          | Sleep between verify ticks                           |
| `VERIFY_TIMEOUT_MS`            | no       | `15000`                                         | Verify deadline                                      |
| `EVAL_AGENT_TIMEOUT_MS`        | no       | schema `90000`; evals fallback `180000`         | See [How to run evals](howto-run-evals.md)           |
| `METRIC_RETENTION_HOURS`       | no       | `6`                                             | Ticker deletes older samples; `0` skips delete       |
| `NODE_ENV`                     | no       | `development`                                   | Passed through Zod                                   |

Numeric env values that are empty or NaN fall back to the default.

## Examples

Health after a good boot:

```bash
curl -s http://localhost:3000/api/health
```

Diagnose an incident with the oracle:

```bash
curl -s -X POST http://localhost:3000/api/incidents/diagnose \
  -H 'content-type: application/json' \
  -d '{"incidentId":"<uuid>","forceOracle":true}'
```

Approve a pending review:

```bash
curl -s -X POST http://localhost:3000/api/reviews \
  -H 'content-type: application/json' \
  -d '{"incidentId":"<uuid>","decision":"approved","reviewer":"oncall"}'
```

## Related

- [How to run a chaos scenario](howto-chaos.md)
- [How to review and merge remediations](howto-review-and-merge.md)
- [Agent pipeline](reference-agent-pipeline.md)
- [Data model](reference-data-model.md)
