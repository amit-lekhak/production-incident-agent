import { z } from "zod";
import { sql } from "@/lib/db";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { closeRemediationPr, executeApprovedAction } from "@/lib/agent/actions";
import {
  DiagnosisConflictError,
  runDiagnosisPipeline,
} from "@/lib/agent/pipeline";
import { verifyRecovery } from "@/lib/agent/verifier";
import { writePostmortem } from "@/lib/agent/postmortem";
import { flushTelemetry } from "@/lib/observability/langfuse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NOOP_ACTIONS = new Set(["watch", "page_human"]);

const schema = z.object({
  incidentId: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "more_evidence"]),
  note: z.string().optional(),
  reviewer: z.string().optional(),
});

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { incidentId, decision, note, reviewer } = parsed.data;

  const [incident] = await sql<{ status: string }[]>`
    SELECT status FROM incidents WHERE id = ${incidentId}::uuid
  `;
  if (!incident) {
    return Response.json(
      {
        ok: false,
        error: { code: "not_found", message: "Incident not found" },
      },
      { status: 404 },
    );
  }
  if (incident.status !== "awaiting_review") {
    return Response.json(
      {
        ok: false,
        error: {
          code: "conflict",
          message: `Incident is "${incident.status}", expected awaiting_review`,
        },
      },
      { status: 409 },
    );
  }

  const [claimed] = await sql<{ id: number }[]>`
    UPDATE reviews
    SET decision = ${decision},
        note = ${note ?? null},
        reviewer = ${reviewer ?? "oncall"},
        decided_at = NOW()
    WHERE id = (
      SELECT id FROM reviews
      WHERE incident_id = ${incidentId}::uuid AND decision = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    )
    AND decision = 'pending'
    RETURNING id
  `;

  // Reject must always close the incident even when the review row is gone
  // (PR already closed on GitHub, double-click, race). Otherwise watcher
  // keeps appending alert_repeat onto awaiting_review forever.
  if (!claimed) {
    if (decision === "rejected") {
      await closeRemediationPr(incidentId).catch(() => undefined);
      await setIncidentStatus(incidentId, "closed_rejected");
      await appendIncidentEvent({
        incidentId,
        kind: "review_rejected",
        message: note
          ? `Review rejected (no pending row): ${note}`
          : "Review rejected — closed without a pending review row",
      });
      return Response.json({
        ok: true,
        status: "closed_rejected",
        forced: true,
      });
    }
    return Response.json(
      {
        ok: false,
        error: {
          code: "conflict",
          message: "No pending review to claim (already decided?)",
        },
      },
      { status: 409 },
    );
  }

  await appendIncidentEvent({
    incidentId,
    kind: `review_${decision}`,
    message: note ? `Review ${decision}: ${note}` : `Review ${decision}`,
  });

  try {
    if (decision === "rejected") {
      await closeRemediationPr(incidentId).catch(() => undefined);
      await setIncidentStatus(incidentId, "closed_rejected");
      return Response.json({ ok: true, status: "closed_rejected" });
    }

    if (decision === "more_evidence") {
      const result = await runDiagnosisPipeline(incidentId);
      return Response.json({
        ok: true,
        status: result.status,
        diagnosis: result,
      });
    }

    const [rec] = await sql<{ recommended_action: string }[]>`
      SELECT recommended_action FROM recommendations
      WHERE incident_id = ${incidentId}::uuid
      ORDER BY created_at DESC LIMIT 1
    `;

    const action = await executeApprovedAction(incidentId);
    if (!action.ok) {
      return Response.json({ ok: false, status: "needs_human", action });
    }

    // No-op actions do not change prod — skip verify and resolve.
    if (rec && NOOP_ACTIONS.has(rec.recommended_action)) {
      await setIncidentStatus(incidentId, "resolved");
      await appendIncidentEvent({
        incidentId,
        kind: "resolved",
        message: `Approved ${rec.recommended_action} — no verify required`,
      });
      try {
        await writePostmortem(incidentId);
      } catch (pmErr) {
        console.error("[postmortem]", incidentId, pmErr);
        await appendIncidentEvent({
          incidentId,
          kind: "postmortem_failed",
          message: pmErr instanceof Error ? pmErr.message : String(pmErr),
        });
      }
      return Response.json({
        ok: true,
        status: "resolved",
        skippedVerify: true,
      });
    }

    const verify = await verifyRecovery(incidentId);
    if (!verify.ok) {
      return Response.json({
        ok: false,
        status: "needs_human",
        error: {
          code: "verify_failed",
          message: "Metrics did not recover after the approved action",
        },
        verify,
      });
    }

    // Metrics recovered — resolve even if postmortem fails.
    await setIncidentStatus(incidentId, "resolved");
    let postmortemId: string | undefined;
    try {
      const postmortem = await writePostmortem(incidentId);
      const [pm] = await sql<{ id: string }[]>`
        SELECT id::text AS id FROM postmortems WHERE incident_id = ${incidentId}::uuid
      `;
      postmortemId = pm?.id;
      return Response.json({
        ok: true,
        status: "resolved",
        postmortemId,
        postmortem,
      });
    } catch (pmErr) {
      const message = pmErr instanceof Error ? pmErr.message : String(pmErr);
      console.error("[postmortem]", incidentId, pmErr);
      await appendIncidentEvent({
        incidentId,
        kind: "postmortem_failed",
        message,
      });
      return Response.json({
        ok: true,
        status: "resolved",
        postmortemError: message,
      });
    }
  } catch (err) {
    if (err instanceof DiagnosisConflictError) {
      return Response.json(
        {
          ok: false,
          error: {
            code: "conflict",
            message: err.message,
          },
        },
        { status: 409 },
      );
    }
    console.error("[reviews]", incidentId, decision, err);
    await appendIncidentEvent({
      incidentId,
      kind: "review_error",
      message: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    return Response.json(
      {
        ok: false,
        error: {
          code: "internal",
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  } finally {
    await flushTelemetry().catch(() => undefined);
  }
}
