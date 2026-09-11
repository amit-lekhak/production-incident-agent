# Explanation: Design decisions

## Why not a chatbot?

Incident response is a **known sequence** (detect → diagnose → review → act → verify → postmortem). A free-form chat that can “fix prod” is the wrong UX and the wrong trust boundary.

## Why code orchestrates Gemini

AI SDK `ToolLoopAgent` / `generateText` tool loops are great for judgment. Detection, dedupe, status transitions, rollback, and metric verification must be deterministic and auditable. Gemini only runs at diagnosis, evidence, and postmortem steps.

## Why humans gate mutations

`toolApproval` in the AI SDK pauses a single request. Reviews can sit for minutes. We persist a Postgres review queue; only the Action executor mutates deploys/flags after `decision=approved`.

## Why Langfuse instead of agent_spans

Homemade span tables duplicate what OTel + Langfuse already do. Product UX still needs `incident_events` and simulated checkout traces in Postgres — those are the world the agent investigates, not APM.

## Why Graphify on a fixture, not this repo

Dumping the Next.js app (with `node_modules` and lockfiles) wastes tokens and confuses “production code” with the console. Agents query a checked-in graph of `fixtures/relay-checkout` under a hard token budget.
