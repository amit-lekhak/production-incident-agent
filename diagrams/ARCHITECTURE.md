# Relay Incident Agent — architecture

Gemini specialists via the Vercel AI SDK tool loop, orchestrated by a **deterministic** pipeline. Human review gates all mutations. Observability uses Langfuse/OpenTelemetry — not homemade APM spans.

## 1. End-to-end incident loop

```mermaid
flowchart TD
  Chaos["POST /api/chaos inject scenario"]
  Sim["Relay Checkout /sim/checkout"]
  Tick["Metric ticker writes timeseries"]
  Watch["Watcher code: alert rules"]
  Dedup{"Duplicate open incident for same service plus rule?"}
  Open["Create incident status=detected"]
  Auto["AUTO_DIAGNOSE pipeline (optional)"]
  IncAgent["Incident Agent tools plus structured hypotheses"]
  IncFail{"Gemini / tool / schema error?"}
  Hyp["Persist hypotheses"]
  EvAgent["Evidence Agent confidence plus action"]
  EvFail{"Gemini / schema / timeout?"}
  Rec["Persist recommendation"]
  Queue["Human review queue"]
  Human{"Approve / reject / more evidence"}
  Act["Action executor code only"]
  ActFail{"Rollback / flag change fails?"}
  Ver["Verifier code: trigger metric recovered?"]
  Recov{"Recovered / timeout / worse"}
  Post["Postmortem Agent"]
  Done["status=resolved"]

  Chaos --> Sim
  Sim --> Tick
  Tick --> Watch
  Watch --> Dedup
  Dedup -->|yes| Watch
  Dedup -->|no| Open
  Open --> Auto
  Auto --> IncAgent
  IncAgent --> IncFail
  IncFail -->|retryable timeout rpm tpm transient| IncAgent
  IncFail -->|auth quota unknown after retries| NeedsHuman1["status=needs_human diagnosis_failed"]
  IncFail -->|ok| Hyp
  Hyp --> EvAgent
  EvAgent --> EvFail
  EvFail -->|retryable| EvAgent
  EvFail -->|exhausted| NeedsHuman2["status=needs_human evidence_failed"]
  EvFail -->|ok| Rec
  Rec --> Queue
  Queue --> Human
  Human -->|reject| Closed["status=closed_rejected"]
  Human -->|more evidence| EvAgent
  Human -->|approve| Act
  Act --> ActFail
  ActFail -->|yes| NeedsHuman3["status=needs_human action_failed"]
  ActFail -->|no| Ver
  Ver --> Recov
  Recov -->|recovered| Post
  Recov -->|timeout or worse| NeedsHuman4["status=needs_human verify_failed"]
  Post --> Done
```

## 2. Agents vs code vs tools

```mermaid
flowchart LR
  subgraph code [Deterministic code]
    Watcher[Watcher]
    Pipeline[Pipeline runner]
    Actions[Action executor]
    Verifier[Verifier]
  end

  subgraph llm [Gemini specialists]
    Incident[Incident Agent]
    Evidence[Evidence Agent]
    Postmortem[Postmortem Agent]
  end

  subgraph tools [Read-only Zod tools]
    Tm[query_metrics]
    Tl[query_logs]
    Tt[query_traces]
    Td[list_deployments]
    Tc[list_commits]
    Te[list_errors]
    Tq[query_db_timings]
    Ts[list_similar_incidents]
    Th[get_service_health]
    Tcode[code_query path explain]
  end

  subgraph write [Mutating actions never LLM]
    Revert[merge_revert_pr]
    Flag[set_feature_flag]
  end

  Watcher --> Pipeline
  Pipeline --> Incident
  Pipeline --> Evidence
  Pipeline --> Actions
  Pipeline --> Verifier
  Pipeline --> Postmortem
  Incident --> tools
  Evidence --> tools
  Actions --> write
```

Detection opens `detected` then optionally kicks `AUTO_DIAGNOSE` (default on). Humans still gate every mutation.

## 3. Observability layers

```mermaid
flowchart TD
  subgraph product [Product data Postgres]
    SimTraces[Simulated checkout traces]
    Timeline[incident_events]
  end

  subgraph platform [Platform packages]
    AISDK["AI SDK telemetry"]
    Langfuse[Langfuse optional]
  end

  Checkout["/sim/checkout"] --> SimTraces
  Pipeline[Pipeline] --> Timeline
  Agents[Gemini agents] --> AISDK
  AISDK --> Langfuse
```

## 4. Code graph scope

Agents query `services/relay-checkout/graphify-out/graph.json` with a token budget and prefer live `read_source` / `diff_deploys` at the GitHub deploy SHA. `.graphifyignore` excludes `node_modules`, lockfiles, and `graphify-out` rebuild noise. The Next.js dashboard itself is never indexed.
