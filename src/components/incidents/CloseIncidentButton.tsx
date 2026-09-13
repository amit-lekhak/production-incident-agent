"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Close an awaiting_review incident even if the GitHub PR is already gone. */
export function CloseIncidentButton({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function closeIncident() {
    setBusy(true);
    setMsg(null);
    setError(false);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incidentId,
          decision: "rejected",
          note: "Closed from incident page",
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        status?: string;
        error?: { message?: string } | string;
      };
      if (!res.ok && !json.ok) {
        const err =
          typeof json.error === "object"
            ? (json.error?.message ?? JSON.stringify(json.error))
            : json.error;
        throw new Error(err ?? "close failed");
      }
      setMsg("Incident closed.");
      router.refresh();
    } catch (err) {
      setError(true);
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={() => void closeIncident()}
        className="rounded-lg border border-(--danger) px-3 py-2 text-sm text-(--danger) disabled:opacity-50"
      >
        {busy ? "Closing…" : "Close incident"}
      </button>
      {msg ? (
        <p
          className={
            error ? "text-xs text-(--danger)" : "text-xs text-(--muted)"
          }
        >
          {msg}
        </p>
      ) : null}
    </div>
  );
}
