import { tool } from "ai";
import { z } from "zod";
import { buildTools, type ToolRuntime } from "./tools";

export function buildAiTools(rt: ToolRuntime) {
  const t = buildTools(rt);
  return {
    query_metrics: tool({
      description:
        "Read recent metric samples (latency, error rate, pool wait, payments p99). Quote display.",
      inputSchema: z.object({
        name: z.string().optional(),
        minutes: z.number().optional(),
      }),
      execute: async (args) => t.query_metrics(args),
    }),
    query_logs: tool({
      description: "Read recent structured logs for the service.",
      inputSchema: z.object({
        level: z.string().optional(),
        limit: z.number().optional(),
      }),
      execute: async (args) => t.query_logs(args),
    }),
    query_traces: tool({
      description:
        "Read simulated checkout request traces. Use catalog.lookup counts to detect N+1.",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: async (args) => t.query_traces(args),
    }),
    list_deployments: tool({
      description: "List recent deployments and which SHA is active.",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: async (args) => t.list_deployments(args),
    }),
    list_commits: tool({
      description: "List recent git commits for the service.",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: async (args) => t.list_commits(args),
    }),
    list_errors: tool({
      description: "List simulated error events (error inbox).",
      inputSchema: z.object({ limit: z.number().optional() }),
      execute: async (args) => t.list_errors(args),
    }),
    query_db_timings: tool({
      description:
        "Read simulated DB query timings (catalog.lookup, pool.wait).",
      inputSchema: z.object({ minutes: z.number().optional() }),
      execute: async (args) => t.query_db_timings(args),
    }),
    list_similar_incidents: tool({
      description:
        "Find resolved past incidents and their recommended actions.",
      inputSchema: z.object({
        causeHint: z.string().optional(),
        limit: z.number().optional(),
      }),
      execute: async (args) => t.list_similar_incidents(args),
    }),
    get_service_health: tool({
      description:
        "Snapshot of active deploy, active fault, and latest metrics.",
      inputSchema: z.object({}),
      execute: async () => t.get_service_health(),
    }),
    code_query: tool({
      description:
        "Query the Relay Checkout code graph (token-budgeted). Never invent file paths.",
      inputSchema: z.object({ question: z.string() }),
      execute: async (args) => t.code_query(args),
    }),
    code_path: tool({
      description: "Shortest path between two symbols in the code graph.",
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      execute: async (args) => t.code_path(args),
    }),
    code_explain: tool({
      description: "Explain a symbol from the code graph.",
      inputSchema: z.object({ symbol: z.string() }),
      execute: async (args) => t.code_explain(args),
    }),
  };
}
