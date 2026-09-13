# Explanation: Design decisions

## Why not a chatbot?

Incident response is a **known sequence** (detect → diagnose → review → act → verify → postmortem). A free-form chat that can “fix prod” is the wrong UX and the wrong trust boundary.

## Why code orchestrates Gemini

AI SDK `ToolLoopAgent` / `generateText` tool loops are great for judgment. Detection, dedupe, status transitions, PR merge/redeploy, and metric verification must be deterministic and auditable. Gemini only runs at diagnosis, evidence, and postmortem steps.

## Why humans gate mutations

`toolApproval` in the AI SDK pauses a single request. Reviews can sit for minutes. We persist a Postgres review queue; only the Action executor mutates deploys/flags after `decision=approved`.

## Why Langfuse instead of agent_spans

Homemade span tables duplicate what OTel + Langfuse already do. Product UX still needs `incident_events` and simulated checkout traces in Postgres — those are the world the agent investigates, not APM.

## Why Graphify on the service tree, not this console

Dumping the Next.js app (with `node_modules` and lockfiles) wastes tokens and confuses “production code” with the console. Agents query a checked-in graph of `services/relay-checkout` under a hard token budget, and prefer live `read_source` / `diff_deploys` at the GitHub deploy SHA.

## Why GitHub is required

Commits and the live SHA must come from where the service is deployed (GitHub Deployments API), not seed rows. Remediations are PRs humans merge — never writes to `main` by the LLM.

## Why this stays an open local demo

No login by design. Chaos, diagnose, and review stay reachable on localhost so the loop is easy to dogfood. Treat network exposure as unsafe — a merged PR mutates the configured GitHub repo.
