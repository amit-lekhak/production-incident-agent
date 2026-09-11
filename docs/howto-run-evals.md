# How to run evals

```bash
pnpm db:seed
pnpm eval
# or
pnpm test
```

Oracle cases (no Gemini):

- `n_plus_one_rollback` — cause `n_plus_one`, action `rollback`
- `payment_timeout_disable_flag` — cause `payment_timeout`, action `disable_flag` (not rollback)

Code tools must never return `node_modules` or lockfile paths. JSON reports land in `evals/results/` (gitignored).
