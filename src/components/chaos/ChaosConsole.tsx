"use client";

import { useState } from "react";

const SCENARIOS = [
  {
    id: "n_plus_one",
    label: "N+1 catalog lookups",
    blurb:
      "Deploy abc123nplus1 — per-item enrichment. Expect latency alert + rollback.",
  },
  {
    id: "payment_timeout",
    label: "Payments timeout",
    blurb:
      "Deploy pay789timeout — payments p99 spikes. Rollback is wrong; disable flag.",
  },
  {
    id: "error_spike",
    label: "Null deref errors",
    blurb:
      "Deploy err321null — TypeError in checkout. Expect error-rate alert.",
  },
  {
    id: "pool_exhaustion",
    label: "DB pool exhaustion",
    blurb: "Deploy pool654cfg — pool size 2. Expect pool wait alert.",
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
      setLog(JSON.stringify(json, null, 2));
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
      setLog(JSON.stringify(await res.json(), null, 2));
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
      setLog(JSON.stringify(await res.json(), null, 2));
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
            className="panel p-4 text-left hover:border-[var(--accent)] disabled:opacity-50"
          >
            <div className="font-semibold">{s.label}</div>
            <div className="mt-1 text-sm text-[var(--muted)]">{s.blurb}</div>
            <div className="mt-3 text-xs text-[var(--accent)]">
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
          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[#0b1220] disabled:opacity-50"
        >
          Hit /sim/checkout
        </button>
        <button
          type="button"
          onClick={() => void tickWatch()}
          disabled={busy !== null}
          className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm disabled:opacity-50"
        >
          Tick + watch now
        </button>
        <button
          type="button"
          onClick={() => void clearAll()}
          disabled={busy !== null}
          className="rounded-lg border border-[var(--danger)] px-4 py-2 text-sm text-[var(--danger)] disabled:opacity-50"
        >
          Clear faults
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <pre className="panel overflow-auto p-3 text-xs text-[var(--muted)]">
          {log}
        </pre>
        <pre className="panel overflow-auto p-3 text-xs text-[var(--muted)]">
          {checkout || "Checkout response will appear here."}
        </pre>
      </div>
    </div>
  );
}
