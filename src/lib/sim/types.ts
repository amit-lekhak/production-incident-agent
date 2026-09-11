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
    deploySha: string;
    version: string;
    summary: string;
    flag?: string;
  }
> = {
  n_plus_one: {
    label: "N+1 catalog lookups",
    deploySha: "abc123nplus1",
    version: "v1.5.0-bad",
    summary: "Per-item product enrichment introduces N+1 catalog queries",
    flag: "catalog_enrichment",
  },
  payment_timeout: {
    label: "Payments dependency timeout",
    deploySha: "pay789timeout",
    version: "v1.5.1-pay",
    summary: "Payments v2 path spikes p99; checkout waits on dependency",
    flag: "payments_v2",
  },
  error_spike: {
    label: "Null deref error spike",
    deploySha: "err321null",
    version: "v1.5.2-err",
    summary: "Empty cart metadata causes TypeError in checkout handler",
  },
  pool_exhaustion: {
    label: "DB pool exhaustion",
    deploySha: "pool654cfg",
    version: "v1.5.3-pool",
    summary: "Config shrinks DB pool to 2 connections",
  },
};
