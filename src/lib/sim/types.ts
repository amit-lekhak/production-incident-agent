export type FaultScenario =
  "n_plus_one" | "payment_timeout" | "error_spike" | "pool_exhaustion";

export type ActiveFault = {
  scenario: FaultScenario;
  deploySha: string;
  config: Record<string, unknown>;
};

export const SCENARIO_META: Record<
  FaultScenario,
  {
    label: string;
    version: string;
    summary: string;
    commitMessage: string;
    flag?: string;
  }
> = {
  n_plus_one: {
    label: "N+1 catalog lookups",
    version: "v1.5.0-bad",
    summary: "Per-item product enrichment introduces N+1 catalog queries",
    commitMessage: "feat: per-item product enrichment (chaos n_plus_one)",
    flag: "catalog_enrichment",
  },
  payment_timeout: {
    label: "Payments dependency timeout",
    version: "v1.5.1-pay",
    summary: "Payments v2 path spikes p99; checkout waits on dependency",
    commitMessage: "feat: route checkout through slow payments path (chaos)",
    flag: "payments_v2",
  },
  error_spike: {
    label: "Null deref error spike",
    version: "v1.5.2-err",
    summary: "Empty cart metadata causes TypeError in checkout handler",
    commitMessage: "fix: handle empty cart metadata (buggy chaos)",
  },
  pool_exhaustion: {
    label: "DB pool exhaustion",
    version: "v1.5.3-pool",
    summary: "Config shrinks DB pool to 2 connections",
    commitMessage: "chore: shrink db pool to 2 for cost (chaos)",
  },
};
