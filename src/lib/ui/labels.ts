/** Human-readable labels for incident UI (enums stay snake_case in the DB). */

const ACTION_LABELS: Record<string, string> = {
  revert_pr: "Revert bad deploy",
  disable_flag: "Disable feature flag",
  restart: "Restart service",
  watch: "Keep watching",
  page_human: "Page on-call",
  rollback: "Rollback deploy",
};

const CAUSE_LABELS: Record<string, string> = {
  n_plus_one: "N+1 catalog lookups",
  payment_timeout: "Payments timeout",
  error_spike: "Error spike",
  pool_exhaustion: "DB pool exhaustion",
  unknown: "Unknown cause",
};

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "No action";
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ");
}

export function causeLabel(cause: string | null | undefined): string {
  if (!cause) return "Unknown";
  return CAUSE_LABELS[cause] ?? cause.replaceAll("_", " ");
}

/** Short SHA for badges (7 chars). */
export function shortSha(sha: string | null | undefined): string {
  if (!sha || sha === "unknown") return "—";
  return sha.slice(0, 7);
}

/** Format a metric sample for titles (rates as %, latency as seconds or ms). */
export function formatMetricValue(metric: string, value: number): string {
  if (metric.includes("rate")) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (metric.includes("latency") || metric.includes("wait")) {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
    return `${Math.round(value)}ms`;
  }
  return `${Math.round(value * 1000) / 1000}`;
}

/** Human incident title from an alert rule firing. */
export function incidentTitleFromAlert(input: {
  ruleName: string;
  metric: string;
  value: number;
  windowSeconds: number;
  aggLabel: string;
}): string {
  const pretty = formatMetricValue(input.metric, input.value);
  const base = input.ruleName.replace(/\s+p95$/i, "").trim() || input.ruleName;
  return `${base} elevated (${input.aggLabel} ${pretty} over ${input.windowSeconds}s)`;
}
