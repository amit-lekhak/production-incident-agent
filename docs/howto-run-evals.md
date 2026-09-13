# How to run evals

Score the deterministic oracle and (optionally) live Gemini specialists against the four chaos scenarios.

An eval here is a scored fixture: inject a fault, run diagnose, check cause signals, recommended action, tool use, and leak absence. It is not a production load test.

## Prerequisites

- `DATABASE_URL` reachable (oracle uses the app DB plus a `LocalReleaseProvider`, not live GitHub)
- Seeded service: `pnpm db:seed`
- For live Gemini cases: `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY`
- `pnpm eval:oracle` does not need a Gemini key

Oracle cases install `LocalReleaseProvider` so they do not push to GitHub. Live agent cases call `injectFault`, which **does** commit and deploy to `GITHUB_REPO`. Use a repo you own.

## Steps

1. Seed (wipes incidents/metrics and restores Relay Checkout + one historical resolved incident):

   ```bash
   pnpm db:seed
   ```

2. Run the deterministic oracle only:

   ```bash
   pnpm eval:oracle
   ```

   That is `tsx evals/runner.ts --oracle-only`.

3. Run oracle plus live Gemini Incident/Evidence agents:

   ```bash
   pnpm eval
   ```

   Exits 1 if `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` is missing (unless you passed `--oracle-only`).

4. Run unit tests on the isolated test database:

   ```bash
   pnpm test
   ```

   Uses `TEST_DATABASE_URL` (default `postgres://localhost:5432/relay_incident_test`).

## Cases

Shared by oracle and Gemini (`evals/cases.ts`):

| Id                             | Scenario          | Expected action | Must not    | Target          |
| ------------------------------ | ----------------- | --------------- | ----------- | --------------- |
| `n_plus_one_revert_pr`         | `n_plus_one`      | `revert_pr`     | (none)      | live deploy SHA |
| `payment_timeout_disable_flag` | `payment_timeout` | `disable_flag`  | `revert_pr` | `payments_v2`   |
| `error_spike_revert_pr`        | `error_spike`     | `revert_pr`     | (none)      | live deploy SHA |
| `pool_exhaustion_revert_pr`    | `pool_exhaustion` | `revert_pr`     | (none)      | live deploy SHA |

Headline/why must include at least one expected phrase (`catalog`+`lookup`, `payment`, `error`/`metadata`/`throw`, `pool`).

Gemini scoring (`evals/score.ts`) also checks:

- `structured_output`: hypothesis + action present
- `requiredToolGroups`: at least one tool from each group was called
- `evidence_grounded`: evidence tools were actually invoked and displays look quoted
- `no_path_leak`: no `node_modules` / lockfile paths
- `no_scenario_leak`: no `scenario=n_plus_one` (etc.) or `active_faults` in tool/evidence text

## Timeouts and reports

- `evals/agent.ts` reads `process.env.EVAL_AGENT_TIMEOUT_MS` and defaults to **180000 ms** if unset
- `src/lib/env.ts` / `.env.example` default the same name to **90000** for the Next app. The eval runner does not use `getEnv()` for this knob
- Set `EVAL_AGENT_TIMEOUT_MS=180000` in `.env.local` if live Gemini cases time out at 90s
- JSON reports write to `evals/results/` (gitignored)

Each run clears leftover faults in a `finally` block.

## Verification

Oracle-only success looks like:

```
=== oracle ===
PASS oracle n_plus_one_revert_pr ...
PASS oracle payment_timeout_disable_flag ...
PASS oracle error_spike_revert_pr ...
PASS oracle pool_exhaustion_revert_pr ...
Wrote evals/results/<timestamp>.json
```

Exit code 0 means every case in that run passed. Exit code 1 means at least one failed, or Gemini keys were missing on `pnpm eval`.

## Troubleshooting

**`Relay Checkout service missing`.** Run `pnpm db:seed`.

**Oracle payment case fails action.** Oracle prefers live source. Confirm `LocalReleaseProvider` applied `chargePaymentSlow` and that a leftover N+1 tree is not still checked out. The runner calls `clearFaults()` between cases.

**Agent `headline_signals` fail.** Gemini used a free-form headline that missed the required words. Re-run; this is model variance, not a broken scorer.

**Agent `EVAL_AGENT_TIMEOUT_MS exceeded`.** Raise the env var. Incident + evidence each may call tools up to 8 steps.

**GitHub rate limit on `pnpm eval`.** Live agent cases use the real release provider. Prefer `pnpm eval:oracle` when you only need the control-plane check.

See [Reference: Agent pipeline](reference-agent-pipeline.md) for what the oracle inspects.
