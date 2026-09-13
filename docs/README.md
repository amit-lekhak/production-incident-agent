# Documentation

Relay Incident Agent docs, split by reader job (Diataxis: tutorial / how-to / reference / explanation).

| Doc                                                               | Quadrant    | What it covers                                      |
| ----------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| [Tutorial: Getting started](tutorial-getting-started.md)          | Tutorial    | Install, seed, first incident, merge a revert PR    |
| [How to run a chaos scenario](howto-chaos.md)                     | How-to      | Inject a real GitHub fault and open an incident     |
| [How to review and merge remediations](howto-review-and-merge.md) | How-to      | `/prs` vs `/review`, approve, reject, more evidence |
| [How to run evals](howto-run-evals.md)                            | How-to      | Oracle suite and live Gemini agent scoring          |
| [Reference: Runtime](reference-runtime.md)                        | Reference   | Pages, HTTP APIs, env, scripts, metrics             |
| [Reference: Agent pipeline](reference-agent-pipeline.md)          | Reference   | Status machine, tools, specialists, actions         |
| [Reference: Data model](reference-data-model.md)                  | Reference   | Postgres tables, incident statuses, recommendations |
| [Explanation: Design decisions](explanation-design-decisions.md)  | Explanation | Why code orchestrates and humans gate mutations     |

Architecture diagrams: [diagrams/ARCHITECTURE.md](../diagrams/ARCHITECTURE.md)

Start at the [root README](../README.md) if you only need the demo loop.
