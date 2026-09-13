"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DiagnoseButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(forceOracle = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/incidents/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, forceOracle }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err =
          typeof json.error === "object"
            ? (json.error?.message ?? JSON.stringify(json.error))
            : json.error;
        throw new Error(err ?? "diagnose failed");
      }
      if (json.ok === false) {
        router.refresh();
        const classified = json.classified as
          { userMessage?: string } | undefined;
        const fallback =
          typeof json.error === "string" ? json.error : "diagnose failed";
        throw new Error(classified?.userMessage ?? fallback);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(false)}
          className="rounded-lg bg-(--accent) px-3 py-2 text-sm font-semibold text-[#0b1220] disabled:opacity-50"
        >
          {busy ? "Diagnosing…" : "Run diagnose"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(true)}
          className="rounded-lg border border-(--line) px-3 py-2 text-sm disabled:opacity-50"
        >
          Oracle
        </button>
      </div>
      {error ? <div className="text-xs text-(--danger)">{error}</div> : null}
    </div>
  );
}
