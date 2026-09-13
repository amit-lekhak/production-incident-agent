# From zero to a merged revert PR

You will run the Relay Incident console locally, break Relay Checkout with a real GitHub deploy, watch the watcher open an incident, and merge the revert PR the diagnosis pipeline opens. By the end you will have seen detect → diagnose → human merge → verify → postmortem.

## What you'll need

- Node 20+ and pnpm 11 (`package.json` pins `pnpm@11.1.3`)
- Postgres 14+
- A GitHub token with Contents, Pull requests, Deployments (read/write) and Metadata (read) on `GITHUB_REPO`
- Optional: `GEMINI_API_KEY` (or `GOOGLE_GENERATIVE_AI_API_KEY`). Without it, diagnose uses the deterministic oracle so the loop still works

Copy [`.env.example`](../.env.example) to `.env.local`. Never commit tokens.

## Step 1: Create the env file

```bash
cd production_incident_agent
cp .env.example .env.local
```

Set at least:

```
DATABASE_URL=postgres://localhost:5432/relay_incident
GITHUB_TOKEN=...
GITHUB_REPO=amit-lekhak/production-incident-agent
```

`GITHUB_REPO` must match `owner/repo`. This console talks to GitHub for commits, production deployments, and remediation PRs.

## Step 2: Install schema and seed

```bash
createdb relay_incident   # skip if it already exists
pnpm install
pnpm db:migrate
pnpm db:seed
```

`pnpm db:migrate` applies `drizzle/` and stamps a baseline if you previously used `pnpm db:push`. `pnpm db:seed` wipes product tables and inserts Relay Checkout, three alert rules, feature flags, healthy metric history, and one resolved historical incident.

You should see seed logs, not a connection error. If Postgres is down, `GET /api/health` later returns 503.

## Step 3: Boot the console (first visible result)

```bash
pnpm service:bootstrap
pnpm dev
```

`service:bootstrap` writes add-then-fix history under `services/relay-checkout` and creates a GitHub production deploy (run once). `pnpm dev` starts Next.js. `src/instrumentation.ts` starts the metric ticker and watcher on boot.

Open http://localhost:3000. Then:

```bash
curl -s http://localhost:3000/api/health
```

You should get JSON like `{"ok":true,"db":"up","ticker":"running","watcher":"running",...}`. That is the first working result: the warehouse and background loops are live.

**If health is 503:** Postgres is unreachable or `DATABASE_URL` is wrong. Fix the URL, create the DB, re-run `pnpm db:migrate`.

**If boot logs `Invalid environment`:** `GITHUB_TOKEN` or `GITHUB_REPO` is missing. Those are required even for a local demo.

## Step 4: Inject N+1 and open an incident

Open **/chaos**. Inject **N+1 catalog lookups**. The API commits a real patch, pushes it, and marks a GitHub production deployment live. Then it ticks metrics and runs the watcher once.

You can also force a sample without waiting for timers:

- **Run one checkout** writes one live request + trace
- **Sample metrics & check alerts** runs one ticker sample + watcher pass

When windowed p95 checkout latency exceeds 2s (and `WATCHER_MIN_SAMPLES` is met), the watcher opens an incident at `detected`. With `AUTO_DIAGNOSE=true` (default), diagnosis starts immediately.

Open **/incidents** and click the new row. You should see status move toward `investigating` then `awaiting_review`.

## Step 5: Diagnose if auto-diagnose is off

If `AUTO_DIAGNOSE=false`, or diagnosis failed, the incident page shows **Run diagnose** and **Oracle**.

- **Run diagnose** uses Gemini when a key is set
- **Oracle** posts `{ forceOracle: true }` and uses the deterministic path even if a key exists

Without a Gemini key, the pipeline always uses the oracle. Tools never see chaos scenario labels; they read metrics, traces, and source at the live deploy SHA.

For N+1, expect action `revert_pr` and a GitHub revert PR.

## Step 6: Merge the PR

Open **/prs**. You should see the revert PR with **Merge PR**, **More evidence**, and **Close PR**.

Click **Merge PR**. Code (not the model) merges the PR, creates a production deployment, activates that SHA locally, clears chaos bookkeeping, samples the trigger metric, and writes a postmortem if metrics recover.

You land on **/postmortems/[id]** when a postmortem row is created. The incident is `resolved` even if postmortem writing fails.

Non-PR actions (disable flag, watch, page, restart) appear on **/review**, not **/prs**. See [How to review and merge remediations](howto-review-and-merge.md).

## Step 7: Prove tests do not touch the app DB

```bash
pnpm test
```

Unit tests use `TEST_DATABASE_URL` (default `postgres://localhost:5432/relay_incident_test`). They never write into `relay_incident`.

## What you built

A local IR console that:

1. Breaks a real in-repo checkout service via GitHub
2. Detects the break from windowed metrics
3. Diagnoses with read-only tools (oracle or Gemini)
4. Lets you merge a revert PR and verify recovery

Next:

- [How to run a chaos scenario](howto-chaos.md) for the other three faults
- [Reference: Runtime](reference-runtime.md) for APIs and env
- [Explanation: Design decisions](explanation-design-decisions.md) for why the loop is code-orchestrated
