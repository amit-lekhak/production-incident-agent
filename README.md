# Relay Incident Agent

AI production incident response over a **simulated** checkout service (Relay Checkout). Inject faults, watch alerts open incidents, let Gemini specialists diagnose with grounded tools, approve actions as a human, then verify and write a postmortem.

This is **not** a chatbot and does not talk to real Kubernetes / Prometheus / Grafana / Jira.

**Local demo risk:** APIs are unauthenticated. Anyone who can reach the process can inject faults, spend Gemini tokens, and approve rollbacks.

## Prerequisites

- Node 20+ and pnpm
- Postgres 14+
- Optional: `GEMINI_API_KEY`, Langfuse keys

## Setup

```bash
cd production_incident_agent
cp .env.example .env.local
# set DATABASE_URL (required)
createdb relay_incident   # if needed
pnpm install
pnpm db:migrate   # or pnpm db:push on an existing DB
pnpm db:seed
pnpm dev
```

Open http://localhost:3000 — ticker/watcher start on boot. Check `GET /api/health`.

## Demo loop

1. **/chaos** — inject `n_plus_one` (or other scenarios)
2. Hit **/sim/checkout** or wait for the ticker — latency rises
3. Watcher opens an incident when windowed p95 > 2s
4. Incident + Evidence agents propose a recommendation
5. **/review** — approve / reject / request more evidence
6. On approve, code rolls back (LLM never mutates), verifier checks metrics, postmortem is written

## Scripts

- `pnpm db:migrate` / `pnpm db:push` / `pnpm db:seed` — schema + seed world
- `pnpm graph:rebuild` — rebuild Graphify `graph.json` for the Relay fixture
- `pnpm eval` — oracle + live Gemini agent evals (**requires `GEMINI_API_KEY`**)
- `pnpm eval:oracle` — deterministic oracle only
- `pnpm test` — unit tests
- `pnpm smoke:loop` / `smoke:diagnose` / `smoke:chaos` — end-to-end CLI checks

## Docs

- [Architecture](diagrams/ARCHITECTURE.md)
- [docs/](docs/) Diataxis guides
