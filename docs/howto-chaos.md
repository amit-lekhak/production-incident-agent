# How to run a chaos scenario

Inject a real fault into Relay Checkout, watch metrics degrade, and get an incident you can diagnose.

Chaos is not a fake label. `injectFault` in `src/lib/sim/faults.ts` writes patched files under `services/relay-checkout`, commits and pushes them, creates a GitHub production deployment, and activates that SHA in the local deployed runtime.

## Prerequisites

- App running (`pnpm dev`) with valid `DATABASE_URL`, `GITHUB_TOKEN`, `GITHUB_REPO`
- Seeded warehouse (`pnpm db:seed`) so service slug `relay-checkout` exists
- `pnpm service:bootstrap` already run once (healthy history + a production deploy)

## Steps

1. Open http://localhost:3000/chaos or list scenarios:

   ```bash
   curl -s http://localhost:3000/api/chaos
   ```

   You get four ids: `n_plus_one`, `payment_timeout`, `error_spike`, `pool_exhaustion`.

2. Inject one scenario. The UI posts this body; you can do the same from the shell:

   ```bash
   curl -s -X POST http://localhost:3000/api/chaos \
     -H 'content-type: application/json' \
     -d '{"action":"inject","scenario":"n_plus_one"}'
   ```

   Inject already runs `tickOnce()` and `runWatcher()` so you do not wait for `TICKER_INTERVAL_MS` / `WATCHER_INTERVAL_MS`.

3. Pick the scenario that matches the demo you want:

   | Scenario          | UI label                    | What the patch does                                 | Typical recommendation                      |
   | ----------------- | --------------------------- | --------------------------------------------------- | ------------------------------------------- |
   | `n_plus_one`      | N+1 catalog lookups         | Per-item `catalog.lookup` (`lookupProductNPlusOne`) | `revert_pr`                                 |
   | `payment_timeout` | Payments dependency timeout | Slow payments path + `payments_v2` flag on          | `disable_flag` → `payments_v2` (not revert) |
   | `error_spike`     | Null deref error spike      | Checkout throws on missing cart metadata            | `revert_pr`                                 |
   | `pool_exhaustion` | DB pool exhaustion          | `DB_POOL_SIZE = 2` in `src/pool.ts`                 | `revert_pr`                                 |

   Injecting a new scenario resets service files to healthy first, then applies that patch. Scenarios do not stack.

4. Optionally run one checkout to see latency/errors:

   ```bash
   curl -s http://localhost:3000/sim/checkout
   ```

   That writes one live request plus a `traces` row. The ticker also runs five checkouts per sample.

5. If you did not inject via POST (inject already ticks + watches), sample now:

   ```bash
   curl -s -X POST http://localhost:3000/api/chaos \
     -H 'content-type: application/json' \
     -d '{"action":"tick"}'
   curl -s -X POST http://localhost:3000/api/chaos \
     -H 'content-type: application/json' \
     -d '{"action":"watch"}'
   ```

6. Open **/incidents**. With `AUTO_DIAGNOSE=true` (default), diagnosis starts when an incident opens. Otherwise click **Run diagnose** on the incident page.

7. When finished, clear bookkeeping and re-sync the runtime from the current production deploy:

   ```bash
   curl -s -X POST http://localhost:3000/api/chaos \
     -H 'content-type: application/json' \
     -d '{"action":"clear"}'
   ```

   Clear does not revert git. Merging a revert PR (or pushing a healthy commit and deploying) is what restores the tree.

## Verification

- GitHub shows a new commit on the configured repo and a production deployment at that SHA
- `GET /api/health` still reports `ticker: running` and `watcher: running`
- An incident exists for the fired alert rule, or the watch response says `insufficient samples` / `ok` if the window has not tripped yet
- Tools and the incident UI do not show `scenario=n_plus_one`. Agents must infer from metrics, traces, and source

## Troubleshooting

**Watcher says `insufficient samples`.** Need `WATCHER_MIN_SAMPLES` (default 2) inside the rule window (default 60s). Inject already ticks once; click **Sample metrics & check alerts** or POST `tick` then `watch` again.

**No new incident, reason `deduped`.** An open incident already exists for that `service_id + alert_rule_id`. Open statuses are `detected`, `investigating`, `awaiting_review`, `acting`, `verifying`, `needs_human`. Resolve or reject the old one, or work on it.

**Incident opened but `suspect_deploy_sha` is null.** The watcher only stores the live SHA when a change-point check says the metric rose after the deploy (or there are fewer than 4 samples). Diagnosis still reads the live SHA via `get_service_health` / `list_deployments`.

**Payment timeout still recommends revert.** The oracle prefers live source (`chargePaymentSlow`) then payments latency. If an older N+1 patch is still in the deployed tree, reset with inject (it starts from healthy files) or merge a revert first.

**GitHub 401 / 403.** Token scopes are wrong or `GITHUB_REPO` is not the repo the token can write. Chaos cannot inject without commit + deployment permission.

See [How to review and merge remediations](howto-review-and-merge.md) for `/prs` vs `/review`. See [Reference: Runtime](reference-runtime.md) for the chaos API contract.
