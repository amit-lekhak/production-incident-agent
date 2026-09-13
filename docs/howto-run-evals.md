# How to run evals

```bash
pnpm db:seed
pnpm eval:oracle   # no Gemini key
pnpm eval          # oracle + live Gemini Incident/Evidence agents (requires GEMINI_API_KEY)
pnpm test          # unit tests including control-plane checks
```

## Oracle cases (deterministic)

- `n_plus_one_revert_pr` — cause `n_plus_one`, action `revert_pr`
- `payment_timeout_disable_flag` — cause `payment_timeout`, action `disable_flag` (not revert_pr)
- `error_spike_revert_pr` — cause `error_spike`, action `revert_pr`
- `pool_exhaustion_revert_pr` — cause `pool_exhaustion`, action `revert_pr`

## Gemini agent cases

Same four scenarios. Scoring checks cause, recommended action, action target shape, required tool groups, evidence grounding, and code-path leak absence.

Per-case timeout: `EVAL_AGENT_TIMEOUT_MS` (default 180s). JSON reports land in `evals/results/` (gitignored).
