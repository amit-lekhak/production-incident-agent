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
      const json = await res.json();
      const sha =
        typeof json?.injected?.deploySha === "string"
          ? json.injected.deploySha.slice(0, 7)
          : null;
      const label = SCENARIOS.find((s) => s.id === scenario)?.label ?? scenario;
      setLog(
        [
          sha ? `Injected ${label} · deploy ${sha}` : `Injected ${label}`,
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
      const json = await res.json();
      setLog(
        ["Cleared chaos state", "", JSON.stringify(json, null, 2)].join("\n"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function hitCheckout() {
    setBusy("checkout");
    try {
      const res = await fetch("/sim/checkout", { method: "POST" });
      const json = await res.json();
      setCheckout(JSON.stringify(json, null, 2));
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
      const json = await res.json();
      setLog(
        [
          "Sampled metrics and evaluated alert rules",
          "",
          JSON.stringify(json, null, 2),
        ].join("\n"),
      );
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
        Background timers already sample every few seconds. Use these buttons to
        force one checkout or one metrics+alert pass without waiting.
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
