# Why the loop is a pipeline, not a chat

Incident response here is a known sequence: detect → diagnose → human gate → mutate → verify → write it down. A chatbot that can "fix prod" is the wrong UX and the wrong trust boundary. This page is the why. Contracts live in [Agent pipeline](reference-agent-pipeline.md).

## The problem

Without a hard split, three things go wrong in a demo that talks to a real GitHub repo:

1. The model invents a rollback SHA or merges the wrong PR.
2. Detection double-opens incidents for the same alert, or blames a deploy that did not change the metric.
3. You cannot tell a Gemini timeout from a bad action, so the console lies about "resolved".

A local unauthenticated demo makes this worse: anyone who can reach `:3000` can spend tokens and merge. The design keeps mutations in one code path so a bad prompt cannot skip the human.

## The approach

```
  Watcher (code)                 Gemini (judgment)              Human                 Code
  --------------                 -----------------              -----                 ----
  windowed metrics               Incident Agent tools           /prs Merge           merge + deploy
  dedupe + change-point    -->   Evidence Agent rec       -->   /review Approve  --> verify metric
  AUTO_DIAGNOSE                  oracle if no key               or reject            postmortem
                                 confidence gate
```

- **Detection is code.** Alert rules, sample floors, and a partial unique index decide when an incident exists. The watcher may record `suspect_deploy_sha` only when the window looks like a change-point.
- **Diagnosis is judgment.** Gemini (or the oracle) reads tools and emits Zod-shaped hypotheses and a recommendation. It cannot call `mergePr`.
- **Mutation is code after a CAS review.** `POST /api/reviews` claims `decision='pending'` once. Only then does `executeApprovedAction` merge, flip a flag, or page.
- **Verify is code.** The trigger metric must fall under a threshold. `watch` / `page_human` skip verify because they do not change prod. Postmortem failure does not reopen a recovered incident.

Langfuse (optional) traces the model. `incident_events` and simulated checkout `traces` are the world the agent investigates.

## Trade-offs

**Code orchestrates, Gemini fills structured slots.** You lose free-form "just fix it" chat. You gain an auditable state machine and retries that do not double-merge.

**Humans persist in Postgres, not `toolApproval`.** AI SDK approval pauses one HTTP request. Reviews sit for minutes across refreshes. Cost: a custom queue and two UI pages (`/prs` vs `/review`).

**GitHub is required at boot.** Commits and the live SHA come from the Deployments API, not seed rows. Local oracle evals swap in `LocalReleaseProvider` so CI does not push. Cost: a PAT in `.env.local` even for "just looking".

**Chaos writes real commits.** The agent cannot cheat by reading `active_faults.scenario`. Cost: a dirty git history on the configured repo; inject resets files to healthy first so scenarios do not stack.

**Graphify indexes `services/relay-checkout` only.** Dumping the Next.js app (and `node_modules`) wastes tokens and confuses "production code" with the console. Agents still prefer `read_source` / `diff_deploys` at the live SHA. Cost: the graph can go stale until `pnpm graph:rebuild`.

**Oracle is a deterministic stand-in, not a hidden label map.** It reads the same tools. Headlines stay free-form (`cause_type` is leftover and unused in the UI). Cost: oracle quality is capped by those heuristics; Gemini can still pick the wrong action, which evals catch.

**No login.** Fast dogfood on localhost. Network exposure is unsafe.

## Alternatives considered

**Chat-only IR.** Rejected: no status CAS, no dedupe, no verify contract.

**Let the model merge.** Rejected: one hallucinated SHA writes to the repo you configured. PRs exist so a human sees the diff.

**Store deploys in Postgres.** Rejected earlier (`drizzle/0002_drop_git_tables.sql`). Seed rows drift from GitHub. The live SHA must be where the service is deployed.

**Homemade `agent_spans` APM.** Rejected. OTel + Langfuse already do that. Product still needs `incident_events` and checkout traces because those are the investigation surface, not APM.

**Closed cause enums in the product UI.** Rejected. Evals score phrases in headline+why. The model must describe what the evidence shows (`Checkout awaits catalog.lookup once per cart line…`), not emit `n_plus_one`.

## Related

- [Tutorial: Getting started](tutorial-getting-started.md)
- [Reference: Agent pipeline](reference-agent-pipeline.md)
- [diagrams/ARCHITECTURE.md](../diagrams/ARCHITECTURE.md)
