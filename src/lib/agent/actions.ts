import { sql } from "@/lib/db";
import { clearFaults } from "@/lib/sim/faults";
import { activateDeployedSha } from "@/lib/sim/deployed-runtime";
import { getReleaseProvider } from "@/lib/release";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export async function executeApprovedAction(incidentId: string) {
  const [rec] = await sql<
    {
      recommended_action: string;
      action_target: string;
      id: number;
      pr_number: number | null;
      pr_url: string | null;
    }[]
  >`
    SELECT id, recommended_action, action_target, pr_number, pr_url
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
    const provider = getReleaseProvider();

    if (rec.recommended_action === "revert_pr") {
      if (!rec.pr_number) {
        throw new Error(
          "No open revert PR on recommendation — re-run diagnose",
        );
      }
      const merged = await provider.mergePr(rec.pr_number);
      if (!merged.merged) {
        throw new Error(`Failed to merge PR #${rec.pr_number}`);
      }
      const deploy = await provider.createDeployment(
        merged.sha,
        `Incident ${incidentId}: merged revert PR #${rec.pr_number}`,
      );
      await activateDeployedSha(deploy.sha);
      await clearFaults();
      result = {
        prNumber: rec.pr_number,
        prUrl: rec.pr_url,
        mergedSha: merged.sha,
        deploySha: deploy.sha,
      };
    } else if (rec.recommended_action === "disable_flag") {
      await sql`
        UPDATE feature_flags
        SET enabled = false
        WHERE service_id = ${incident.service_id} AND key = ${rec.action_target}
      `;
      // Restore healthy checkout source via revert of live deploy when flag alone is enough
      await clearFaults();
      // For payment_timeout chaos the slow path is in the deployed tree — also open/merge
      // is not required; re-deploy previous SHA so timings recover without a full revert PR.
      const deploys = await provider.listDeployments(2);
      const prev = deploys[1];
      if (prev) {
        const deploy = await provider.createDeployment(
          prev.sha,
          `Incident ${incidentId}: disable_flag ${rec.action_target}; restore prior deploy`,
        );
        await activateDeployedSha(deploy.sha);
        result = {
          flag: rec.action_target,
          enabled: false,
          restoredSha: deploy.sha,
        };
      } else {
        result = { flag: rec.action_target, enabled: false };
      }
    } else if (rec.recommended_action === "restart") {
      await clearFaults();
      const current = await provider.currentDeploy();
      if (current) await activateDeployedSha(current.sha);
      result = { restarted: true, sha: current?.sha ?? null };
    } else if (
      rec.recommended_action === "watch" ||
      rec.recommended_action === "page_human"
    ) {
      result = { noted: rec.recommended_action };
    } else if (rec.recommended_action === "rollback") {
      // Legacy alias — treat as revert_pr if PR exists
      if (rec.pr_number) {
        const merged = await provider.mergePr(rec.pr_number);
        const deploy = await provider.createDeployment(
          merged.sha,
          `Incident ${incidentId}: legacy rollback via PR #${rec.pr_number}`,
        );
        await activateDeployedSha(deploy.sha);
        await clearFaults();
        result = { mergedSha: merged.sha, deploySha: deploy.sha };
      } else {
        throw new Error(
          "rollback without PR is no longer supported; use revert_pr",
        );
      }
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

/** Close the remediation PR without merging (review rejected). */
export async function closeRemediationPr(incidentId: string) {
  const [rec] = await sql<{ pr_number: number | null }[]>`
    SELECT pr_number FROM recommendations
    WHERE incident_id = ${incidentId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;
  if (rec?.pr_number) {
    await getReleaseProvider().closePr(rec.pr_number);
  }
}
