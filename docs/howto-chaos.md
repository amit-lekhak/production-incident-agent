# How to run a chaos scenario

1. Go to `/chaos`.
2. Pick a scenario:
   - `n_plus_one` → expect rollback
   - `payment_timeout` → expect disable `payments_v2` (not rollback)
   - `error_spike` / `pool_exhaustion` → expect rollback of the bad deploy
3. Optionally hit `/sim/checkout` to feel latency/errors.
4. Use **Tick + watch now** if you do not want to wait for background timers.
5. Clear faults when finished.

The watcher dedupes: the same open `service + rule` will not spawn a second incident.
