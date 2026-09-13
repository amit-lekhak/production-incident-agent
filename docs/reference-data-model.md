# Data model

Postgres warehouse for Relay Checkout signals and the incident control plane. Schema: `src/lib/db/schema.ts`. Migrations: `drizzle/`.

Git commits and the live SHA are **not** stored as source of truth here. Those come from GitHub via `ReleaseProvider`. Seed may copy bootstrap SHAs into a historical incident only.

## Services and alerts

### `services`

| Column        | Type               | Notes                  |
| ------------- | ------------------ | ---------------------- |
| `id`          | serial PK          |                        |
| `name`        | varchar(120)       | Seed: `Relay Checkout` |
| `slug`        | varchar(80) unique | Seed: `relay-checkout` |
| `description` | text               |                        |
| `created_at`  | timestamptz        | default now            |

### `alert_rules`

| Column           | Type              | Notes                           |
| ---------------- | ----------------- | ------------------------------- |
| `id`             | serial PK         |                                 |
| `service_id`     | int FK → services |                                 |
| `name`           | varchar(120)      |                                 |
| `metric`         | varchar(80)       | e.g. `checkout_latency_p95`     |
| `operator`       | varchar(8)        | Watcher implements `>` and `>=` |
| `threshold`      | float8            |                                 |
| `window_seconds` | int               | default 60                      |
| `enabled`        | bool              | default true                    |

## Telemetry tables (product data, not Langfuse)

### `metric_samples`

`name`, `value`, `labels` jsonb, `sampled_at`. Indexes on `(name, sampled_at)` and `(service_id, sampled_at)`.

### `log_lines`

`level` varchar(16), `message`, `attrs` jsonb, `logged_at`.

### `traces`

UUID PK. Simulated checkout waterfalls: `request_id`, `root_span`, `duration_ms`, `status`, `spans` jsonb (`name`, `durationMs`, `status`, `attrs?`), `traced_at`.

### `error_events`

`fingerprint` varchar(120), `title`, `message`, `count`, `last_seen_at`, optional `deploy_sha`.

### `db_timings`

`query_name`, `duration_ms`, `rows`, `sampled_at`.

### `feature_flags`

Unique `(service_id, key)`. Seed keys: `payments_v2`, `catalog_enrichment` (both start `enabled=false`). Chaos inject may turn the scenario's flag on.

### `active_faults`

Chaos bookkeeping. `scenario` varchar(64), optional `deploy_sha`, `config` jsonb, `active`, `injected_at`, `cleared_at`. **Not** exposed to agent tools.

## Incident control plane

### `incidents`

| Column                                     | Type            | Notes                                         |
| ------------------------------------------ | --------------- | --------------------------------------------- |
| `id`                                       | uuid PK         |                                               |
| `service_id`                               | int FK          |                                               |
| `alert_rule_id`                            | int FK nullable |                                               |
| `title`                                    | varchar(240)    | From `incidentTitleFromAlert`                 |
| `status`                                   | varchar(40)     | see [pipeline](reference-agent-pipeline.md)   |
| `severity`                                 | varchar(24)     | default `high`; watcher: medium/high/critical |
| `trigger_metric`                           | varchar(80)     |                                               |
| `trigger_value`                            | float8          | Window aggregate that fired                   |
| `suspect_deploy_sha`                       | varchar(40)     | Null unless change-point                      |
| `langfuse_trace_id`                        | varchar(80)     |                                               |
| `needs_human_reason`                       | text            |                                               |
| `input_tokens` / `output_tokens`           | int             | Rollup                                        |
| `opened_at` / `resolved_at` / `updated_at` | timestamptz     |                                               |

Partial unique index (`drizzle/0003_open_incident_unique.sql`): one open incident per `(service_id, alert_rule_id)` where status is not `resolved` or `closed_rejected` and `alert_rule_id` is not null. Watcher also checks open statuses in a transaction (`FOR UPDATE`).

### `incident_events`

Append-only timeline: `kind`, `message`, `meta` jsonb. Ops hides `alert_repeat` unless `?noise=1`.

Common kinds include `detected`, `alert_repeat`, `auto_diagnose`, `investigating`, `oracle`, `retry`, `diagnosis_failed`, `pr_opened`, `pr_open_failed`, `pr_superseded`, `awaiting_review`, `review_approved` / `review_rejected` / `review_more_evidence`, `acting`, `action_succeeded`, `action_failed`, `verifying`, `verify_ok`, `verify_failed`, `resolved`, `postmortem_failed`.

### `hypotheses`

`rank`, `headline` (free-form), nullable legacy `cause_type` (unused by product UI), `suspect_deploy`, `supporting_tool_names` jsonb string[], `why`.

### `recommendations`

`confidence` int, `evidence` jsonb `{ tool, display, supports }[]`, `recommended_action` varchar(40), `action_target` varchar(120), `summary`, optional `pr_number`, `pr_url`, `pr_head_sha`, `winning_hypothesis_id`.

Actions: `revert_pr` | `disable_flag` | `restart` | `watch` | `page_human` (legacy `rollback` still handled in the executor).

### `reviews`

`decision`: `approved` | `rejected` | `more_evidence` | `pending`. `reviewer` default `oncall`. Claim updates `decided_at`.

### `actions`

Executor audit: `kind`, `target`, `status` `pending` | `succeeded` | `failed`, `result` jsonb, `error`, `executed_at`.

### `postmortems`

UUID PK, unique `incident_id`. `title`, `summary`, `timeline` `{ at, event }[]`, `root_cause`, `impact`, `resolution`, `action_items` string[].

### `llm_generations`

Per specialist call: `function_id`, token counts, `latency_ms`. Diagnosis clears prior usage for the incident before a new run.

## Seed behavior

`pnpm db:seed` / `db:reset` truncates the tables listed in `scripts/seed.ts` (including `services`) and re-inserts:

- One service
- Three alert rules
- Two flags
- ~13 ticks of healthy metrics (30s apart)
- One resolved historical N+1 incident + hypothesis/recommendation (for `list_similar_incidents`)

It does not recreate GitHub deploys. Run `pnpm service:bootstrap` for that.

## Examples

Open incidents for Relay Checkout:

```sql
SELECT id, title, status, trigger_metric, trigger_value, suspect_deploy_sha
FROM incidents
WHERE status NOT IN ('resolved', 'closed_rejected')
ORDER BY opened_at DESC;
```

Pending review queue (same split as `/prs` vs `/review`):

```sql
SELECT i.id, r.recommended_action, r.pr_number, v.decision
FROM reviews v
JOIN incidents i ON i.id = v.incident_id
JOIN recommendations r ON r.id = v.recommendation_id
WHERE v.decision = 'pending' AND i.status = 'awaiting_review';
```

## Related

- [Reference: Runtime](reference-runtime.md)
- [Reference: Agent pipeline](reference-agent-pipeline.md)
- [Explanation: Design decisions](explanation-design-decisions.md)
