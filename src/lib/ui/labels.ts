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

const STATUS_LABELS: Record<string, string> = {
  detected: "Detected",
  investigating: "Investigating",
  awaiting_review: "Awaiting review",
  acting: "Applying fix",
  verifying: "Verifying recovery",
  resolved: "Resolved",
  closed_rejected: "Rejected",
  needs_human: "Needs human",
};

const EVENT_KIND_LABELS: Record<string, string> = {
  detected: "Incident opened",
  investigating: "Diagnosis started",
  oracle: "Used deterministic oracle",
  retry: "Retried a step",
  diagnosis_failed: "Diagnosis failed",
  pr_opened: "Opened revert PR",
  pr_open_failed: "Failed to open PR",
  pr_superseded: "Closed superseded PR",
  awaiting_review: "Waiting for your review",
  review_approved: "Approved",
  review_rejected: "Rejected",
  review_more_evidence: "Requested more evidence",
  acting: "Applying remediation",
  action_succeeded: "Remediation succeeded",
  action_failed: "Remediation failed",
  verifying: "Checking metrics",
  verify_ok: "Metrics recovered",
  verify_failed: "Metrics did not recover",
  postmortem_written: "Postmortem written",
  postmortem_failed: "Postmortem failed",
  resolved: "Incident resolved",
  alert_repeat: "Alert still firing",
  auto_diagnose: "Auto-diagnose started",
  auto_diagnose_failed: "Auto-diagnose failed",
  review_error: "Review error",
};

const DUMP_MARKERS = [
  "catalog.lookup",
  "lookups/req",
  "similar:",
  "→ n/a",
  "avg=",
  "samples=",
  "query_traces",
  "list_deployments",
  "diff_deploys",
  "; Historical:",
  "supporting_tool",
];

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "No action";
  return ACTION_LABELS[action] ?? action.replaceAll("_", " ");
}

export function causeLabel(cause: string | null | undefined): string {
  if (!cause) return "Unknown";
  return CAUSE_LABELS[cause] ?? cause.replaceAll("_", " ");
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

export function eventKindLabel(kind: string | null | undefined): string {
  if (!kind) return "Event";
  if (EVENT_KIND_LABELS[kind]) return EVENT_KIND_LABELS[kind];
  if (kind.startsWith("review_")) {
    return `Review ${kind.slice("review_".length).replaceAll("_", " ")}`;
  }
  return kind.replaceAll("_", " ");
}

/** Short SHA for badges (7 chars). */
export function shortSha(sha: string | null | undefined): string {
  if (!sha || sha === "unknown") return "—";
  return sha.slice(0, 7);
}

export function actionTargetLabel(
  action: string | null | undefined,
  target: string | null | undefined,
): string {
  if (!target) return "";
  if (action === "revert_pr" || action === "rollback") {
    return `deploy ${shortSha(target)}`;
  }
  if (action === "disable_flag") return `flag ${target}`;
  return target;
}

/** True when text looks like a metric/tool dump, not on-call prose. */
export function looksLikeDump(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (text.length > 220) return true;
  return DUMP_MARKERS.some((m) => t.includes(m.toLowerCase()));
}

export function operatorSummary(input: {
  cause?: string | null;
  action?: string | null;
  target?: string | null;
  summary?: string | null;
}): string {
  const stored = input.summary?.trim() ?? "";
  if (stored && !looksLikeDump(stored) && stored.length <= 220) {
    return stored;
  }

  const cause = causeLabel(input.cause);
  const action = actionLabel(input.action);
  const target = actionTargetLabel(input.action, input.target);

  if (input.action === "revert_pr" || input.action === "rollback") {
    return `Likely ${cause}${target && target !== "—" ? ` after ${target}` : ""}. Recommend reverting that deploy.`;
  }
  if (input.action === "disable_flag") {
    return `Likely ${cause}. Recommend disabling ${target || "the feature flag"} instead of reverting.`;
  }
  if (input.action === "page_human") {
    return `Likely ${cause}. Confidence is too low to auto-remediate — page on-call.`;
  }
  if (input.action === "watch") {
    return `Likely ${cause}. Keep watching metrics before changing production.`;
  }
  if (input.action) {
    return `Likely ${cause}. Recommend: ${action}${target ? ` (${target})` : ""}.`;
  }
  return stored || "Investigation incomplete.";
}

/** One-line next step for the operator. */
export function nextStepHint(input: {
  status?: string | null;
  action?: string | null;
  hasPr?: boolean;
}): string {
  const status = input.status ?? "";
  const action = input.action ?? "";

  if (status === "detected") {
    return "Run diagnose (or wait for auto-diagnose) to get a recommendation.";
  }
  if (status === "investigating") {
    return "Diagnosis is running — refresh shortly.";
  }
  if (status === "awaiting_review") {
    if (action === "revert_pr" || input.hasPr) {
      return "Inspect the open PR, then Merge to redeploy (or Close to abandon).";
    }
    if (action === "disable_flag") {
      return "Approve to disable the flag, or reject / request more evidence.";
    }
    if (action === "page_human") {
      return "Approve to page on-call, or request more evidence.";
    }
    return "Approve, reject, or request more evidence.";
  }
  if (status === "acting")
    return "Remediation is applying — wait for verification.";
  if (status === "verifying") return "Checking that metrics recovered.";
  if (status === "needs_human") {
    return "Something failed — read the needs-human reason and decide the next step.";
  }
  if (status === "resolved") return "Incident is resolved.";
  if (status === "closed_rejected") return "Recommendation was rejected.";
  return "Open the incident for details.";
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
