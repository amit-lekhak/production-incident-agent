# Tutorial: Getting started

1. `cp .env.example .env.local` and set `DATABASE_URL` (default `postgres://localhost:5432/relay_incident`).
2. `createdb relay_incident` if needed.
3. `pnpm install && pnpm db:push && pnpm db:seed`
4. `pnpm dev` → http://localhost:3000
5. Open **/chaos**, inject **N+1 catalog lookups**, click **Tick + watch now**.
6. Open **/incidents**, open the new incident, click **Oracle** (or **Run diagnose** with a Gemini key).
7. Open **/prs**, **Merge PR** — code merges the revert PR, redeploys, metrics verify, postmortem opens. Non-PR actions (page/watch) appear on **/review**.
8. `pnpm test` uses `TEST_DATABASE_URL` (`relay_incident_test`) so it never writes into the app DB.

Without `GEMINI_API_KEY`, diagnose uses the deterministic oracle so the demo still works.
