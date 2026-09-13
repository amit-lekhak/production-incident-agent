# How to run evals

```bash
pnpm db:seed
pnpm eval:oracle   # no Gemini key
pnpm eval          # oracle + live Gemini Incident/Evidence agents (requires GEMINI_API_KEY)
pnpm test          # unit tests including control-plane checks
```

## Oracle cases (deterministic)

- `n_plus_one_rollback` — cause `n_plus_one`, action `rollback`
- `payment_timeout_disable_flag` — cause `payment_timeout`, action `disable_flag` (not rollback)
- `error_spike_rollback` — cause `error_spike`, action `rollback`
- `pool_exhaustion_rollback` — cause `pool_exhaustion`, action `rollback`

## Gemini agent cases

Same four scenarios. Scoring checks cause, recommended action, action target shape, required tool groups, evidence grounding, and code-path leak absence.

Per-case timeout: `EVAL_AGENT_TIMEOUT_MS` (default 180s). JSON reports land in `evals/results/` (gitignored).
