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

const METRIC_LABELS: Record<string, string> = {
  checkout_latency_p95: "Checkout latency",
  payments_latency_p99: "Payments latency",
  checkout_error_rate: "Checkout error rate",
  db_pool_wait_ms: "DB pool wait",
};

/** Friendly metric name for operators (never dump raw snake_case as primary copy). */
export function metricLabel(metric: string | null | undefined): string {
  if (!metric) return "Metric";
  if (METRIC_LABELS[metric]) return METRIC_LABELS[metric];
  return metric
    .replace(/_p95$/i, "")
    .replace(/_p99$/i, "")
    .replace(/_ms$/i, "")
    .replaceAll("_", " ");
}

/** Format a metric sample for titles (rates as %, latency as seconds or ms). */
export function formatMetricValue(metric: string, value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (metric.includes("rate")) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (metric.includes("latency") || metric.includes("wait")) {
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
    return `${Math.round(value)}ms`;
  }
  return `${Math.round(value * 1000) / 1000}`;
}

function formatWindow(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const m = seconds / 60;
    return m === 1 ? "1 minute" : `${m} minutes`;
  }
  return `${seconds}s`;
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
  const base =
    input.ruleName.replace(/\s+p95$/i, "").trim() || metricLabel(input.metric);
  return `${base} elevated (${input.aggLabel} ${pretty} over ${formatWindow(input.windowSeconds)})`;
}

/**
 * Rewrite stored titles that look like alert dumps, e.g.
 * `DB pool wait: db_pool_wait_ms > 500 (avg 847.127 over 60s)`.
 */
export function operatorIncidentTitle(
  title: string | null | undefined,
  opts?: { metric?: string | null; value?: number | null },
): string {
  const raw = title?.trim() ?? "";
  if (!raw) return "Untitled incident";

  const dump = raw.match(
    /^(.+?):\s*([a-z0-9_]+)\s*(>=|>)\s*([\d.]+)\s*\((avg|p95|p99)\s+([\d.]+)\s+over\s+(\d+)s\)$/i,
  );
  if (dump) {
    const ruleName = dump[1]!.trim();
    const metric = dump[2]!;
    const aggLabel = dump[5]!.toLowerCase();
    const value = Number(dump[6]);
    const windowSeconds = Number(dump[7]);
    return incidentTitleFromAlert({
      ruleName,
      metric,
      value,
      windowSeconds,
      aggLabel,
    });
  }

  if (opts?.metric && opts.value != null && /[a-z0-9_]+ > [\d.]+/i.test(raw)) {
    return incidentTitleFromAlert({
      ruleName: metricLabel(opts.metric),
      metric: opts.metric,
      value: opts.value,
      windowSeconds: 60,
      aggLabel: opts.metric.includes("rate") ? "avg" : "p95",
    });
  }

  return raw;
}

/** Operator-facing event message; never leave raw metric dumps as the body. */
export function operatorEventMessage(input: {
  kind: string;
  message: string;
  meta?: Record<string, unknown> | null;
}): string {
  const kind = input.kind;
  const message = input.message?.trim() ?? "";
  const meta = input.meta ?? {};

  const metric =
    typeof meta.metric === "string"
      ? meta.metric
      : typeof meta.triggerMetric === "string"
        ? meta.triggerMetric
        : null;
  const value =
    typeof meta.value === "number"
      ? meta.value
      : typeof meta.value === "string"
        ? Number(meta.value)
        : null;
  const label =
    typeof meta.label === "string"
      ? meta.label
      : metric?.includes("rate")
        ? "avg"
        : "p95";
  const windowSeconds =
    typeof meta.windowSeconds === "number" ? meta.windowSeconds : null;

  if (kind === "alert_repeat") {
    if (metric && value != null && Number.isFinite(value)) {
      return `Still elevated — ${metricLabel(metric)} ${label} ${formatMetricValue(metric, value)}${
        windowSeconds ? ` over ${formatWindow(windowSeconds)}` : ""
      }.`;
    }
    const m = message.match(
      /Alert\s+(.+?)\s+still firing\s*\((avg|p95|p99)\s+([\d.]+)\)/i,
    );
    if (m) {
      const name = m[1]!.trim();
      const agg = m[2]!.toLowerCase();
      const n = Number(m[3]);
      const guessMetric = /pool/i.test(name)
        ? "db_pool_wait_ms"
        : /error/i.test(name)
          ? "checkout_error_rate"
          : /payment/i.test(name)
            ? "payments_latency_p99"
            : "checkout_latency_p95";
      return `Still elevated — ${name} ${agg} ${formatMetricValue(guessMetric, n)}.`;
    }
  }

  if (kind === "detected") {
    if (metric && value != null && Number.isFinite(value)) {
      return `Opened after ${metricLabel(metric)} hit ${formatMetricValue(metric, value)}${
        windowSeconds ? ` over ${formatWindow(windowSeconds)}` : ""
      }.`;
    }
    const opened = message.match(/Watcher opened incident for\s+(.+)/i);
    if (opened) return `Alert fired: ${opened[1]!.trim()}.`;
  }

  if (kind === "awaiting_review") {
    const rec = message.match(/Recommendation:\s+(\w+)\s+(\S+)\s+\((\d+)%\)/i);
    if (rec) {
      const action = rec[1]!;
      const target = rec[2]!;
      const confidence = rec[3]!;
      const targetBit = actionTargetLabel(action, target);
      return `Recommended ${actionLabel(action)}${
        targetBit ? ` → ${targetBit}` : ""
      } (${confidence}% confidence).`;
    }
  }

  if (
    kind === "verifying" ||
    kind === "verify_ok" ||
    kind === "verify_failed"
  ) {
    const sample = message.match(
      /^([a-z0-9_]+)=([\d.]+)\s*(recovered)?\s*\(threshold\s+([\d.]+)\)/i,
    );
    if (sample) {
      const m = sample[1]!;
      const v = Number(sample[2]);
      const recovered = Boolean(sample[3]);
      const thr = Number(sample[4]);
      const body = `${metricLabel(m)} is ${formatMetricValue(m, v)} (threshold ${formatMetricValue(m, thr)})`;
      if (kind === "verify_ok" || recovered) return `Recovered — ${body}.`;
      if (kind === "verify_failed") return `Not recovered — ${body}.`;
      return `Checking — ${body}.`;
    }
  }

  if (kind === "acting") {
    const act = message.match(/Executing\s+(\w+)\s*→\s*(\S+)/i);
    if (act) {
      const action = act[1]!;
      const target = act[2]!;
      const targetBit = actionTargetLabel(action, target);
      return `Applying ${actionLabel(action)}${
        targetBit ? ` (${targetBit})` : ""
      }.`;
    }
  }

  if (kind === "auto_diagnose") {
    return "Starting automatic diagnosis.";
  }

  if (looksLikeDump(message)) {
    return eventKindLabel(kind);
  }

  return message || eventKindLabel(kind);
}
