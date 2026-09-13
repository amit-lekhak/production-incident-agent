import { sql } from "@/lib/db";
import { clearFaults } from "@/lib/sim/faults";
import { activateDeployedSha } from "@/lib/sim/deployed-runtime";
import { getReleaseProvider } from "@/lib/release";
import {
  appendIncidentEvent,
  setIncidentStatus,
} from "@/lib/observability/incident-events";
import { pageHuman } from "./page-human";

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
      summary: string;
    }[]
  >`
    SELECT id, recommended_action, action_target, pr_number, pr_url, summary
    FROM recommendations
    WHERE incident_id = ${incidentId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;
  if (!rec) throw new Error("No recommendation to execute");

  const [incident] = await sql<{ service_id: number; title: string }[]>`
    SELECT service_id, title FROM incidents WHERE id = ${incidentId}::uuid
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
      // Flag is read by the live checkout path — no redeploy required.
      result = { flag: rec.action_target, enabled: false };
    } else if (rec.recommended_action === "restart") {
      await clearFaults();
      const current = await provider.currentDeploy();
      if (current) await activateDeployedSha(current.sha);
      result = { restarted: true, sha: current?.sha ?? null };
    } else if (rec.recommended_action === "page_human") {
      const page = await pageHuman({
        incidentId,
        title: incident.title,
        summary: rec.summary,
        actionTarget: rec.action_target,
      });
      result = { noted: "page_human", ...page };
      if (!page.ok) {
        throw new Error(`page_human webhook failed: ${page.detail}`);
      }
    } else if (rec.recommended_action === "watch") {
      result = { noted: "watch" };
    } else if (rec.recommended_action === "rollback") {
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
  if (!rec?.pr_number) return;
  try {
    await getReleaseProvider().closePr(rec.pr_number);
  } catch (err: unknown) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status: number }).status)
        : null;
    // Already closed / missing — still fine; incident close is what matters.
    if (status === 404 || status === 422) return;
    throw err;
  }
}
