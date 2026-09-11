import { sql } from "@/lib/db";
import { clearFaults } from "@/lib/sim/faults";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export async function executeApprovedAction(incidentId: string) {
  const [rec] = await sql<
    { recommended_action: string; action_target: string; id: number }[]
  >`
    SELECT id, recommended_action, action_target
    FROM recommendations
    WHERE incident_id = ${incidentId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;
  if (!rec) throw new Error("No recommendation to execute");

  const [incident] = await sql<{ service_id: number }[]>`
    SELECT service_id FROM incidents WHERE id = ${incidentId}::uuid
  `;
  if (!incident) throw new Error("Incident missing");

  await setIncidentStatus(incidentId, "acting");
  await appendIncidentEvent({
    incidentId,
    kind: "acting",
    message: `Executing ${rec.recommended_action} → ${rec.action_target}`,
  });

  const [actionRow] = await sql<{ id: number }[]>`
    INSERT INTO actions (incident_id, kind, target, status)
    VALUES (${incidentId}::uuid, ${rec.recommended_action}, ${rec.action_target}, 'pending')
    RETURNING id
  `;

  try {
    let result: Record<string, unknown> = {};

    if (rec.recommended_action === "rollback") {
      const [current] = await sql<{ sha: string }[]>`
        SELECT sha FROM deployments
        WHERE service_id = ${incident.service_id} AND status = 'active'
        ORDER BY deployed_at DESC LIMIT 1
      `;
      await sql`
        UPDATE deployments
        SET status = 'rolled_back', rolled_back_at = NOW()
        WHERE service_id = ${incident.service_id} AND status = 'active'
      `;
      // restore previous stable deploy if present
      const [prev] = await sql<{ sha: string }[]>`
        SELECT sha FROM deployments
        WHERE service_id = ${incident.service_id}
          AND sha <> ${rec.action_target}
        ORDER BY deployed_at DESC
        LIMIT 1
      `;
      const restoreSha = prev?.sha ?? "aaa111stable";
      await sql`
        UPDATE deployments
        SET status = 'active', rolled_back_at = NULL, deployed_at = NOW()
        WHERE service_id = ${incident.service_id} AND sha = ${restoreSha}
      `;
      // if restore row missing, insert
      const [active] = await sql<{ sha: string }[]>`
        SELECT sha FROM deployments
        WHERE service_id = ${incident.service_id} AND status = 'active'
        LIMIT 1
      `;
      if (!active) {
        await sql`
          INSERT INTO deployments (service_id, sha, version, status, summary, deployed_at)
          VALUES (
            ${incident.service_id}, 'aaa111stable', 'v1.4.2', 'active',
            'Restored after rollback', NOW()
          )
          ON CONFLICT (sha) DO UPDATE SET status = 'active', deployed_at = NOW()
        `;
      }
      await clearFaults();
      result = { previousSha: current?.sha, restoredSha: restoreSha };
    } else if (rec.recommended_action === "disable_flag") {
      await sql`
        UPDATE feature_flags
        SET enabled = false
        WHERE service_id = ${incident.service_id} AND key = ${rec.action_target}
      `;
      // clear payment_timeout fault behavior by clearing faults if matching
      await clearFaults();
      result = { flag: rec.action_target, enabled: false };
    } else if (rec.recommended_action === "restart") {
      await clearFaults();
      result = { restarted: true };
    } else if (
      rec.recommended_action === "watch" ||
      rec.recommended_action === "page_human"
    ) {
      result = { noted: rec.recommended_action };
    } else {
      throw new Error(`Unknown action ${rec.recommended_action}`);
    }

    await sql`
      UPDATE actions
      SET status = 'succeeded', result = ${jsonb(result)}, executed_at = NOW()
      WHERE id = ${actionRow!.id}
    `;
    await appendIncidentEvent({
      incidentId,
      kind: "action_succeeded",
      message: `${rec.recommended_action} succeeded`,
      meta: result,
    });
    return { ok: true as const, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE actions
      SET status = 'failed', error = ${message}, executed_at = NOW()
      WHERE id = ${actionRow!.id}
    `;
    await setIncidentStatus(incidentId, "needs_human", {
      needsHumanReason: `action_failed: ${message}`,
    });
    await appendIncidentEvent({
      incidentId,
      kind: "action_failed",
      message,
    });
    return { ok: false as const, error: message };
  }
}
