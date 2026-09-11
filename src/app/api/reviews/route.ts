import { z } from "zod";
import { sql } from "@/lib/db";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { executeApprovedAction } from "@/lib/agent/actions";
import { verifyRecovery } from "@/lib/agent/verifier";
import { writePostmortem } from "@/lib/agent/postmortem";
import { runDiagnosisPipeline } from "@/lib/agent/pipeline";
import { captureAppException } from "@/lib/observability/sentry";

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

  const [review] = await sql<{ id: number }[]>`
    SELECT id FROM reviews
    WHERE incident_id = ${incidentId}::uuid AND decision = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `;

  if (review) {
    await sql`
      UPDATE reviews
      SET decision = ${decision},
          note = ${note ?? null},
          reviewer = ${reviewer ?? "oncall"},
          decided_at = NOW()
      WHERE id = ${review.id}
    `;
  } else {
    await sql`
      INSERT INTO reviews (incident_id, decision, note, reviewer, decided_at)
      VALUES (
        ${incidentId}::uuid, ${decision}, ${note ?? null},
        ${reviewer ?? "oncall"}, NOW()
      )
    `;
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
      return Response.json({ ok: false, status: "needs_human", verify });
    }

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
  } catch (err) {
    await captureAppException(err, { incidentId, decision });
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
