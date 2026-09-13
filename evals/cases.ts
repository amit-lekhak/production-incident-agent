import type { FaultScenario } from "../src/lib/sim/types";

export type EvalCase = {
  id: string;
  scenario: FaultScenario;
  expectCause: string;
  expectAction: string;
  expectNotAction?: string;
  expectTarget?: string | "active_sha";
  /** Every group must have at least one tool called. */
  requiredToolGroups: string[][];
};

export const EVAL_CASES: EvalCase[] = [
  {
    id: "n_plus_one_rollback",
    scenario: "n_plus_one",
    expectCause: "n_plus_one",
    expectAction: "rollback",
    expectTarget: "active_sha",
    requiredToolGroups: [
      ["query_metrics", "get_service_health", "query_db_timings"],
      ["query_traces"],
      ["list_deployments", "get_service_health"],
    ],
  },
  {
    id: "payment_timeout_disable_flag",
    scenario: "payment_timeout",
    expectCause: "payment_timeout",
    expectAction: "disable_flag",
    expectNotAction: "rollback",
    expectTarget: "payments_v2",
    requiredToolGroups: [
      ["query_metrics", "get_service_health"],
      ["query_traces", "list_errors"],
    ],
  },
  {
    id: "error_spike_rollback",
    scenario: "error_spike",
    expectCause: "error_spike",
    expectAction: "rollback",
    expectTarget: "active_sha",
    requiredToolGroups: [
      ["query_metrics", "get_service_health", "list_errors"],
      ["query_traces", "list_errors"],
      ["list_deployments", "get_service_health"],
    ],
  },
  {
    id: "pool_exhaustion_rollback",
    scenario: "pool_exhaustion",
    expectCause: "pool_exhaustion",
    expectAction: "rollback",
    expectTarget: "active_sha",
    requiredToolGroups: [
      ["query_metrics", "get_service_health", "query_db_timings"],
      ["query_traces", "query_db_timings"],
      ["list_deployments", "get_service_health"],
    ],
  },
];
