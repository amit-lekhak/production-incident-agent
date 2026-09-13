"use client";

import { useState } from "react";

const SCENARIOS = [
  {
    id: "n_plus_one",
    label: "N+1 catalog lookups",
    blurb:
      "Commits a checkout patch that looks up catalog items one-by-one. Expect a latency alert and a revert recommendation.",
  },
  {
    id: "payment_timeout",
    label: "Payments timeout",
    blurb:
      "Turns on the slow payments_v2 path. Expect a payments alert — disable the flag, do not revert.",
  },
  {
    id: "error_spike",
    label: "Null deref errors",
    blurb:
      "Checkout crashes when cart metadata is missing. Expect an error-rate alert and a revert.",
  },
  {
    id: "pool_exhaustion",
    label: "DB pool exhaustion",
    blurb:
      "Shrinks the DB pool to 2 connections. Expect a pool-wait alert and a revert.",
  },
] as const;

type WatchResult = {
  opened?: boolean;
  reason?: string;
  incidentId?: string;
  title?: string;
};

async function readResponseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      `Empty response (${res.status} ${res.statusText || "no status"}). On Vercel this is usually a timeout or a crash before JSON was written.`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 240)}`);
  }
}

function errorFromJson(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const err = (json as { error?: unknown }).error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return null;
}

function summarizeWatch(
  watch: unknown,
  scenario: string,
  tick: { metrics?: Record<string, number> } | null,
): string[] {
  if (!Array.isArray(watch)) {
    return ["Watch: no results (tick/watch may have failed)."];
  }
  const lines: string[] = [];
  const results = watch as WatchResult[];
  const opened = results.filter((r) => r.opened);
  const deduped = results.filter(
    (r) => !r.opened && r.reason === "deduped" && r.incidentId,
  );
  const under = results.filter(
    (r) =>
      !r.opened &&
      r.reason &&
      r.reason !== "deduped" &&
      !r.reason.startsWith("insufficient"),
  );
  const insufficient = results.filter(
    (r) => !r.opened && r.reason?.startsWith("insufficient"),
  );

  for (const r of opened) {
    lines.push(`Opened: ${r.title ?? "incident"} → /incidents/${r.incidentId}`);
  }
  for (const r of deduped) {
    lines.push(
      `Deduped onto existing incident → /incidents/${r.incidentId} (close it first to open a new one)`,
    );
  }
  for (const r of insufficient) {
    lines.push(`No incident yet: ${r.reason}`);
  }
  for (const r of under) {
    lines.push(`Under threshold: ${r.reason}`);
  }

  if (
    scenario === "payment_timeout" &&
    opened.length === 0 &&
    !results.some((r) => r.reason?.toLowerCase().includes("payment"))
  ) {
    const pay = tick?.metrics?.payments_latency_p99;
    if (pay != null && pay < 1500) {
      lines.push(
        `Payments p99=${Math.round(pay)}ms is below the 1500ms alert — check payments_v2 flag / spans.`,
      );
    } else if (pay != null && pay >= 1500) {
      lines.push(
        "Payments p99 is elevated but no payments alert rule fired — run pnpm db:migrate (0005_payments_alert_rule).",
      );
    }
  }

  if (lines.length === 0) lines.push("Watch completed with no openings.");
  return lines;
}

export function ChaosConsole() {
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string>("Ready.");
  const [checkout, setCheckout] = useState<string>("");

  async function inject(scenario: string) {
    setBusy(scenario);
    try {
      const res = await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inject", scenario }),
      });
      const json = await readResponseJson(res);
      const apiError = errorFromJson(json);
      const body = json as {
        injected?: { deploySha?: string };
        tick?: { metrics?: Record<string, number> };
        watch?: unknown;
        tickWatchError?: string;
      };
      if ((!res.ok || apiError) && !body.injected) {
        throw new Error(apiError ?? `Inject failed (${res.status})`);
      }
      const sha =
        typeof body.injected?.deploySha === "string"
          ? body.injected.deploySha.slice(0, 7)
          : null;
      const label = SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario;
      const summary = summarizeWatch(body.watch, scenario, body.tick ?? null);
      if (body.tickWatchError) {
        summary.unshift(`Tick/watch error: ${body.tickWatchError}`);
      }
      setLog(
        [
          sha ? `Injected ${label} · deploy ${sha}` : `Injected ${label}`,
          ...summary,
          "",
          "Checkout is a probe — it does not open incidents. Watcher does.",
          "",
          JSON.stringify(json, null, 2),
        ].join("\n"),
      );
    } catch (err) {
      setLog(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function clearAll() {
    setBusy("clear");
    try {
      const res = await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const json = await readResponseJson(res);
      const apiError = errorFromJson(json);
      if (!res.ok || apiError) {
        throw new Error(apiError ?? `Clear failed (${res.status})`);
      }
      setLog(
        ["Cleared chaos state", "", JSON.stringify(json, null, 2)].join("\n"),
      );
    } catch (err) {
      setLog(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function hitCheckout() {
    setBusy("checkout");
    try {
      const res = await fetch("/sim/checkout", { method: "POST" });
      const json = await readResponseJson(res);
      setCheckout(JSON.stringify(json, null, 2));
    } catch (err) {
      setCheckout(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function tickWatch() {
    setBusy("tick");
    try {
      await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tick" }),
      });
      const res = await fetch("/api/chaos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "watch" }),
      });
      const json = await readResponseJson(res);
      const apiError = errorFromJson(json);
      if (!res.ok || apiError) {
        throw new Error(apiError ?? `Watch failed (${res.status})`);
      }
      const body = json as { watch?: unknown };
      const summary = summarizeWatch(body.watch, "", null);
      setLog(
        [
          "Sampled metrics and evaluated alert rules",
          ...summary,
          "",
          JSON.stringify(json, null, 2),
        ].join("\n"),
      );
    } catch (err) {
      setLog(String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy !== null}
            onClick={() => void inject(s.id)}
            className="panel p-4 text-left hover:border-(--accent) disabled:opacity-50"
          >
            <div className="font-semibold">{s.label}</div>
            <div className="mt-1 text-sm text-(--muted)">{s.blurb}</div>
            <div className="mt-3 text-xs text-(--accent)">
              {busy === s.id ? "Injecting…" : "Inject fault"}
            </div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void hitCheckout()}
          disabled={busy !== null}
          className="rounded-lg bg-(--accent) px-4 py-2 text-sm font-semibold text-[#0b1220] disabled:opacity-50"
        >
          Run one checkout
        </button>
        <button
          type="button"
          onClick={() => void tickWatch()}
          disabled={busy !== null}
          className="rounded-lg border border-(--line) px-4 py-2 text-sm disabled:opacity-50"
        >
          Sample metrics & check alerts
        </button>
        <button
          type="button"
          onClick={() => void clearAll()}
          disabled={busy !== null}
          className="rounded-lg border border-(--danger) px-4 py-2 text-sm text-(--danger) disabled:opacity-50"
        >
          Clear chaos state
        </button>
      </div>
      <p className="text-xs text-(--muted)">
        Checkout probes the fault. Incidents open from metric samples + alert
        rules (Sample metrics & check alerts). Close stale incidents before
        re-injecting or the watcher will dedupe.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <pre className="panel overflow-auto p-3 text-xs text-(--muted)">
          {log}
        </pre>
        <pre className="panel overflow-auto p-3 text-xs text-(--muted)">
          {checkout || "Checkout response will appear here."}
        </pre>
      </div>
    </div>
  );
}
