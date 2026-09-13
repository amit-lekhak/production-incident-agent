# How to run a chaos scenario

1. Go to `/chaos`.
2. Pick a scenario:
   - **N+1 catalog lookups** → expect _Revert bad deploy_
   - **Payments timeout** → expect _Disable feature flag_ `payments_v2` (not revert). Recovery is flag-only — no silent redeploy.
   - **Null deref / DB pool** → expect _Revert bad deploy_
3. Optionally **Run one checkout** to feel latency/errors (writes one live request + trace).
4. Use **Sample metrics & check alerts** if you do not want to wait for background timers (forces one ticker sample + watcher pass).
5. With `AUTO_DIAGNOSE=true` (default), the watcher starts diagnosis when an incident opens; otherwise click **Run diagnose**. For `revert_pr`, diagnose opens a GitHub PR you can inspect; **Approve** on Review merges it and redeploys.
6. **Clear chaos state** when finished.

The watcher dedupes: the same open `service + rule` will not spawn a second incident (DB partial unique index + app check).
Tools never expose chaos `scenario` labels — agents must diagnose from metrics/traces/source.
