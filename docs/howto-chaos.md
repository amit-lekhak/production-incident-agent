# How to run a chaos scenario

1. Go to `/chaos`.
2. Pick a scenario:
   - `n_plus_one` → expect revert_pr
   - `payment_timeout` → expect disable `payments_v2` (not revert_pr). Recovery is flag-only — no silent redeploy.
   - `error_spike` / `pool_exhaustion` → expect revert_pr of the bad deploy
3. Optionally hit `/sim/checkout` to feel latency/errors.
4. Use **Tick + watch now** if you do not want to wait for background timers.
5. With `AUTO_DIAGNOSE=true` (default), the watcher starts diagnosis when an incident opens; otherwise click **Run diagnose**.
6. Clear faults when finished.

The watcher dedupes: the same open `service + rule` will not spawn a second incident (DB partial unique index + app check).
Tools never expose chaos `scenario` labels — agents must diagnose from metrics/traces/source.
