import { z } from "zod";
import { sql } from "@/lib/db";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { executeApprovedAction } from "@/lib/agent/actions";
import {
  DiagnosisConflictError,
  runDiagnosisPipeline,
} from "@/lib/agent/pipeline";
import { verifyRecovery } from "@/lib/agent/verifier";
import { writePostmortem } from "@/lib/agent/postmortem";
import { flushTelemetry } from "@/lib/observability/langfuse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  if (!claimed) {
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

    // approved
    const action = await executeApprovedAction(incidentId);
    if (!action.ok) {
      return Response.json({ ok: false, status: "needs_human", action });
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

    try {
      const postmortem = await writePostmortem(incidentId);
      const [pm] = await sql<{ id: string }[]>`
        SELECT id::text AS id FROM postmortems WHERE incident_id = ${incidentId}::uuid
      `;
      return Response.json({
        ok: true,
        status: "resolved",
        postmortemId: pm?.id,
        postmortem,
      });
    } catch (pmErr) {
      const message =
        pmErr instanceof Error ? pmErr.message : String(pmErr);
      console.error("[postmortem]", incidentId, pmErr);
      await setIncidentStatus(incidentId, "needs_human", {
        needsHumanReason: `postmortem_failed: ${message}`,
      });
      await appendIncidentEvent({
        incidentId,
        kind: "postmortem_failed",
        message,
      });
      return Response.json({
        ok: false,
        status: "needs_human",
        error: { code: "postmortem_failed", message },
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
