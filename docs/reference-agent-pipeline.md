# Agent pipeline

Diagnosis, tools, specialists, confidence gate, actions, and verify. Runtime HTTP is in [Reference: Runtime](reference-runtime.md). Tables are in [Data model](reference-data-model.md).

Code in `src/lib/agent/` orchestrates Gemini. The model can only call read-only tools. Mutations run in `executeApprovedAction` after a human decision.

## Status machine

```
detected → investigating → awaiting_review → acting → verifying → resolved
```

Also: `needs_human`, `closed_rejected`.

| Status            | Who sets it                                            | What happens next                     |
| ----------------- | ------------------------------------------------------ | ------------------------------------- |
| `detected`        | Watcher insert                                         | Optional `AUTO_DIAGNOSE`              |
| `investigating`   | Diagnose CAS                                           | Incident + evidence (or oracle)       |
| `awaiting_review` | Pipeline after persist (+ PR for revert)               | Human on `/prs` or `/review`          |
| `acting`          | `executeApprovedAction`                                | Merge / flag / restart / page / watch |
| `verifying`       | `verifyRecovery`                                       | Tick trigger metric                   |
| `resolved`        | Review route after verify or no-op approve             | Postmortem best-effort                |
| `closed_rejected` | Reject                                                 | PR closed if present                  |
| `needs_human`     | Diagnosis, persist, PR open, action, or verify failure | Diagnose allowed again                |

Diagnose CAS only from `detected` | `needs_human` | `awaiting_review`. Review requires `awaiting_review` plus a `pending` review row.

`suspect_deploy_sha` is set at open only when the watcher change-point check correlates (or sample count `< 4`). It is not required for diagnosis.

## Confidence gate

`DIAGNOSIS_MIN_CONFIDENCE` (default 60). If `confidence_0_100` is below the gate **and** `recommended_action` is `revert_pr`, `disable_flag`, or `restart`, the pipeline rewrites the action to `page_human` before persist/PR open. `watch` and `page_human` are unchanged.

## Specialists

Implemented in `src/lib/agent/specialists.ts`. Model from `GEMINI_MODEL` (default `gemini-3.1-flash-lite`).

| Function           | Role                                            | Loop                                                                                    |
| ------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| `runIncidentAgent` | Gather tools, then structured hypotheses (1–5)  | `generateText` tools `stopWhen: stepCountIs(8)`, then `Output.object(hypothesesSchema)` |
| `runEvidenceAgent` | Try to disprove, then structured recommendation | Same two-step shape                                                                     |
| `oracleDiagnose`   | Deterministic fallback                          | Calls the same read-only tools; never reads `active_faults.scenario`                    |
| Postmortem agent   | After resolve                                   | `src/lib/agent/postmortem.ts`                                                           |

Retryable Gemini failures retry up to `DIAGNOSIS_MAX_RETRIES` (default 2). Auth/quota/unknown after retries → `needs_human` + `diagnosis_failed`.

Re-diagnose deletes reviews, recommendations, and hypotheses for that incident (FK order), then inserts fresh rows. Open revert PRs from prior runs are closed first (`pr_superseded`).

## Structured outputs

Hypotheses (`hypothesesSchema`):

| Field                   | Constraint                                         |
| ----------------------- | -------------------------------------------------- |
| `rank`                  | int ≥ 1                                            |
| `headline`              | non-empty free-form line (not a closed cause enum) |
| `suspect_deploy`        | string or null                                     |
| `supporting_tool_names` | string[]                                           |
| `why`                   | string                                             |
| array length            | 1–5                                                |

Recommendation (`recommendationSchema`):

| Field                     | Constraint                                                            |
| ------------------------- | --------------------------------------------------------------------- |
| `winning_hypothesis_rank` | int ≥ 1                                                               |
| `confidence_0_100`        | 0–100                                                                 |
| `evidence[]`              | `{ tool, display, supports }`                                         |
| `recommended_action`      | `revert_pr` \| `disable_flag` \| `restart` \| `watch` \| `page_human` |
| `action_target`           | string (deploy SHA or flag key or oncall)                             |
| `summary`                 | string                                                                |

Postmortem (`postmortemSchema`): `title`, `summary`, `timeline[]`, `root_cause`, `impact`, `resolution`, `action_items[]`.

## Tools (read-only)

Built in `src/lib/agent/tools.ts`, wrapped for the AI SDK in `src/lib/agent/ai-tools.ts`. Every tool returns a `display` string the model is told to quote.

| Tool                     | Inputs (defaults, caps)                  | Reads                                                                                              |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `query_metrics`          | `name?`, `minutes` default 15            | Last 40 `metric_samples` in the window                                                             |
| `query_logs`             | `level?`, `limit` default 20, max 50     | `log_lines`                                                                                        |
| `query_traces`           | `limit` default 10, max 30               | Checkout traces; summarizes `catalog.lookup` counts, payment and pool spans                        |
| `list_deployments`       | `limit` default 10, max 20               | GitHub production deploys (index 0 = active)                                                       |
| `list_commits`           | `limit` default 10, max 20               | Commits via release provider                                                                       |
| `read_source`            | `path` required, `sha?`                  | File under `services/relay-checkout` at SHA (default live deploy). Display truncates to 1200 chars |
| `diff_deploys`           | `base?`, `head?`                         | Defaults previous vs live. Display truncates to 2000 chars                                         |
| `list_errors`            | `limit` default 10, max 20               | `error_events`                                                                                     |
| `query_db_timings`       | `minutes` default 15                     | Last 40 `db_timings`; highlights `catalog.lookup`                                                  |
| `list_similar_incidents` | `searchHint?`, `limit` default 5, max 10 | Resolved incidents, optional ILIKE on headline/why/title/summary                                   |
| `get_service_health`     | none                                     | Live SHA, flags, latest metrics. **Does not** return chaos scenario or `active_faults`             |
| `code_query`             | `question`                               | Graphify graph, 1500 token budget                                                                  |
| `code_path`              | `from`, `to`                             | Shortest path, 1500 token budget                                                                   |
| `code_explain`           | `symbol`                                 | Symbol explain, 1500 token budget                                                                  |

Graph file: `services/relay-checkout/graphify-out/graph.json`. The Next.js app is not indexed.

Oracle inference order (source first, then metrics): N+1 source → null-deref source → pool size 2 → `chargePaymentSlow` → high payment latency → error rate/events → pool wait → catalog averages.

## Actions (code only)

| `recommended_action` | `action_target`          | Executor                                                               |
| -------------------- | ------------------------ | ---------------------------------------------------------------------- |
| `revert_pr`          | bad deploy SHA           | `mergePr` + `createDeployment` + `activateDeployedSha` + `clearFaults` |
| `disable_flag`       | flag key (`payments_v2`) | SQL `enabled = false`; no redeploy                                     |
| `restart`            | unused                   | `clearFaults` + activate current SHA                                   |
| `watch`              | unused                   | no-op; skip verify                                                     |
| `page_human`         | e.g. `oncall`            | POST `PAGE_WEBHOOK_URL` JSON; unset URL → local note, `ok: true`       |
| `rollback`           | legacy                   | Only if `pr_number` exists; otherwise throws                           |

PR open (diagnosis, not approve): only when the gated action is `revert_pr`. Uses previous production SHA as `restoreSha` when present. Failure → `needs_human` / `pr_open_failed`.

## Verify

`verifyRecovery` ticks until `VERIFY_SAMPLES` (default 3) or `VERIFY_TIMEOUT_MS` (default 15000). Success if the last reading of `trigger_metric` is **strictly below** the threshold:

| Metric         | Default threshold                 |
| -------------- | --------------------------------- |
| `*error_rate*` | `ERROR_RATE_THRESHOLD` (0.05)     |
| `*pool*`       | 500                               |
| `*payments*`   | 1500                              |
| else (latency) | `LATENCY_P95_THRESHOLD_MS` (2000) |

Worse = last reading `> 1.2 ×` first reading. Either miss → `needs_human` / `verify_failed`.

Resolved incidents stay resolved if postmortem writing throws (`postmortem_failed` event).

## Examples

Oracle diagnose from the incident page: **Oracle** sends `{ forceOracle: true }`.

Programmatic approve after a revert PR:

```bash
curl -s -X POST http://localhost:3000/api/reviews \
  -H 'content-type: application/json' \
  -d '{"incidentId":"<uuid>","decision":"approved"}'
```

## Related

- [How to review and merge remediations](howto-review-and-merge.md)
- [How to run evals](howto-run-evals.md)
- [Explanation: Design decisions](explanation-design-decisions.md)
- [diagrams/ARCHITECTURE.md](../diagrams/ARCHITECTURE.md)
