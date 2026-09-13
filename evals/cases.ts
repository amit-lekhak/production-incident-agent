import type { FaultScenario } from "../src/lib/sim/types";

export type EvalCase = {
  id: string;
  scenario: FaultScenario;
  /** Phrases that must appear in headline+why (case-insensitive). */
  expectHeadlineIncludes: string[];
  expectAction: string;
  expectNotAction?: string;
  expectTarget?: string | "active_sha";
  /** Every group must have at least one tool called. */
  requiredToolGroups: string[][];
};

export const EVAL_CASES: EvalCase[] = [
  {
    id: "n_plus_one_revert_pr",
    scenario: "n_plus_one",
    expectHeadlineIncludes: ["catalog", "lookup"],
    expectAction: "revert_pr",
    expectTarget: "active_sha",
    requiredToolGroups: [
      ["query_metrics", "get_service_health", "query_db_timings"],
      ["query_traces"],
      ["list_deployments", "get_service_health", "diff_deploys", "read_source"],
    ],
  },
  {
    id: "payment_timeout_disable_flag",
    scenario: "payment_timeout",
    expectHeadlineIncludes: ["payment"],
    expectAction: "disable_flag",
    expectNotAction: "revert_pr",
    expectTarget: "payments_v2",
    requiredToolGroups: [
      ["query_metrics", "get_service_health"],
      ["query_traces", "list_errors", "read_source"],
    ],
  },
  {
    id: "error_spike_revert_pr",
    scenario: "error_spike",
    expectHeadlineIncludes: ["error", "metadata", "throw"],
    expectAction: "revert_pr",
    expectTarget: "active_sha",
    requiredToolGroups: [
      ["query_metrics", "get_service_health", "list_errors"],
      ["query_traces", "list_errors", "read_source"],
      ["list_deployments", "get_service_health"],
    ],
  },
  {
    id: "pool_exhaustion_revert_pr",
    scenario: "pool_exhaustion",
    expectHeadlineIncludes: ["pool"],
    expectAction: "revert_pr",
    expectTarget: "active_sha",
    requiredToolGroups: [
      ["query_metrics", "get_service_health", "query_db_timings"],
      ["query_traces", "query_db_timings", "read_source"],
      ["list_deployments", "get_service_health"],
    ],
  },
];
