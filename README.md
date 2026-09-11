# Relay Incident Agent

AI production incident response over a **simulated** checkout service (Relay Checkout). Inject faults, watch alerts open incidents, let Gemini specialists diagnose with grounded tools, approve actions as a human, then verify and write a postmortem.

This is **not** a chatbot and does not talk to real Kubernetes / Prometheus / Grafana / Jira.

## Prerequisites

- Node 20+ and pnpm
- Postgres 14+
- Optional: `GEMINI_API_KEY`, Langfuse keys, Sentry DSN

## Setup

```bash
cd production_incident_agent
cp .env.example .env.local
# set DATABASE_URL (default postgres://localhost:5432/relay_incident)
createdb relay_incident   # if needed
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

Open http://localhost:3000

## Demo loop

1. **/chaos** — inject `n_plus_one` (or other scenarios)
2. Hit **/sim/checkout** or wait for the ticker — latency rises
3. Watcher opens an incident when p95 > 2s
4. Incident + Evidence agents propose a recommendation
5. **/review** — approve / reject / request more evidence
6. On approve, code rolls back (LLM never mutates), verifier checks metrics, postmortem is written

## Scripts

- `pnpm db:push` / `pnpm db:seed` — schema + seed world (includes a historical N+1 twin)
- `pnpm graph:rebuild` — rebuild Graphify `graph.json` for the Relay fixture
- `pnpm eval` — oracle + agent evals
- `pnpm test` — unit tests

## Docs

- [Architecture](diagrams/ARCHITECTURE.md)
- [docs/](docs/) Diataxis guides
