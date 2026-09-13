"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewActions({
  incidentId,
  hasPr = false,
}: {
  incidentId: string;
  hasPr?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function decide(decision: "approved" | "rejected" | "more_evidence") {
    setBusy(decision);
    setMsg(null);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, decision, note }),
      });
      const json = await res.json();
      if (!res.ok) {
        const err =
          typeof json.error === "object"
            ? (json.error?.message ?? JSON.stringify(json.error))
            : json.error;
        throw new Error(err ?? "review failed");
      }
      setMsg(JSON.stringify(json));
      router.refresh();
      if (json.postmortemId) {
        router.push(`/postmortems/${json.postmortemId}`);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note"
        className="w-full rounded-lg border border-(--line) bg-background p-2 text-sm"
        rows={2}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("approved")}
          className="rounded-lg bg-(--ok) px-3 py-2 text-sm font-semibold text-[#052e1c] disabled:opacity-50"
        >
          {busy === "approved" ? "Working…" : hasPr ? "Merge PR" : "Approve"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("more_evidence")}
          className="rounded-lg border border-(--line) px-3 py-2 text-sm disabled:opacity-50"
        >
          More evidence
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void decide("rejected")}
          className="rounded-lg border border-(--danger) px-3 py-2 text-sm text-(--danger) disabled:opacity-50"
        >
          {hasPr ? "Close PR" : "Reject"}
        </button>
      </div>
      {msg ? (
        <pre className="overflow-auto text-xs text-(--muted)">{msg}</pre>
      ) : null}
    </div>
  );
}
