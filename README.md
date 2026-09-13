# Relay Incident Agent

AI production incident response over **Relay Checkout** — a real in-repo service under `services/relay-checkout` with GitHub commits, Deployments, and PRs. Seed data fills the metrics/incident warehouse; remediations are live GitHub PRs.

**Local demo risk:** APIs are unauthenticated. Anyone who can reach the process can inject faults, spend Gemini tokens, and merge remediation PRs.

## Prerequisites

- Node 20+ and pnpm
- Postgres 14+
- **Required:** `GITHUB_TOKEN`, `GITHUB_REPO` (this repo is fine: `amit-lekhak/production-incident-agent`)
- Optional: `GEMINI_API_KEY`, Langfuse keys

### How to get `GITHUB_TOKEN`

1. Open [https://github.com/settings/tokens](https://github.com/settings/tokens)
2. Prefer a **fine-grained** token limited to this repo with:
   - **Contents** (read/write)
   - **Pull requests** (read/write)
   - **Deployments** (read/write)
   - **Metadata** (read)
3. Or a classic token with the `repo` scope
4. Put it in `.env.local` (never commit it)

## Setup

```bash
cd production_incident_agent
cp .env.example .env.local
# set DATABASE_URL, GITHUB_TOKEN, GITHUB_REPO
createdb relay_incident   # if needed
pnpm install
pnpm db:migrate   # stamps baseline if you previously used db:push
pnpm db:seed
pnpm service:bootstrap   # seed-like git history + production deploy (once)
pnpm dev
```

Open http://localhost:3000 — ticker/watcher start on boot. Check `GET /api/health`.

## Demo loop

1. **/chaos** — inject `n_plus_one` (commits a real patch + GitHub production deploy)
2. Hit **/sim/checkout** or wait for the ticker — latency rises because the deployed tree is buggy
3. Watcher opens an incident when windowed p95 > 2s (`suspect_deploy_sha` only when change-point correlates)
4. With `AUTO_DIAGNOSE=true` (default), diagnosis starts automatically; otherwise click Diagnose — agents read metrics + GitHub commits/diffs; for revert recommendations, code opens a **revert PR** (confidence gate applies)
5. **/prs** — **Merge PR** / more evidence / **Close PR** for revert remediations; **/review** — **Approve** / **Reject** for page/watch/restart/flag actions
6. On merge, production redeploys, verifier checks the **trigger metric**, postmortem is written (failures do not keep the incident open)

## Scripts

- `pnpm db:migrate` / `pnpm db:push` / `pnpm db:seed` — schema + incident warehouse seed
- `pnpm service:bootstrap` — add-then-fix history under `services/relay-checkout` + GitHub deploys
- `pnpm graph:rebuild` — rebuild Graphify `graph.json` for the service
- `pnpm eval` — oracle + live Gemini agent evals (**requires `GEMINI_API_KEY`**)
- `pnpm eval:oracle` — deterministic oracle only (uses LocalReleaseProvider)
- `pnpm test` — unit tests against `TEST_DATABASE_URL` (`relay_incident_test`, never the app DB)
- `pnpm smoke:loop` / `smoke:diagnose` / `smoke:chaos` — end-to-end CLI checks

## Docs

Short path is this README. Full set is [docs/](docs/) (tutorial, how-tos, reference, explanation).

- [Tutorial: Getting started](docs/tutorial-getting-started.md)
- [How to run a chaos scenario](docs/howto-chaos.md)
- [How to review and merge remediations](docs/howto-review-and-merge.md)
- [How to run evals](docs/howto-run-evals.md)
- [Reference: Runtime](docs/reference-runtime.md) (pages, HTTP, env, scripts)
- [Reference: Agent pipeline](docs/reference-agent-pipeline.md) (tools, statuses, actions)
- [Reference: Data model](docs/reference-data-model.md)
- [Explanation: Design decisions](docs/explanation-design-decisions.md)
- [Architecture diagrams](diagrams/ARCHITECTURE.md)
