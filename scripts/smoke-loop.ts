import "../src/lib/load-env";
import { injectFault, clearFaults } from "../src/lib/sim/faults";
import { tickOnce } from "../src/lib/sim/ticker";
import { runWatcher } from "../src/lib/sim/watcher";
import { runDiagnosisPipeline } from "../src/lib/agent/pipeline";
import { executeApprovedAction } from "../src/lib/agent/actions";
import { verifyRecovery } from "../src/lib/agent/verifier";
import { writePostmortem } from "../src/lib/agent/postmortem";
import { sql } from "../src/lib/db";

async function main() {
  await clearFaults();
  // Close leftover open incidents so watcher can open a fresh one
  await sql`
    UPDATE incidents
    SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
    WHERE status NOT IN ('resolved', 'closed_rejected')
  `;

  await injectFault("n_plus_one");
  // Fill the alert window with elevated samples
  await tickOnce();
  await tickOnce();
  const watch = await runWatcher();
  const opened = watch.find((w) => w.opened);
  if (!opened || !("incidentId" in opened)) {
    throw new Error(`no incident: ${JSON.stringify(watch)}`);
  }
  const id = opened.incidentId;
  await runDiagnosisPipeline(id, { forceOracle: true });
  const [claimed] = await sql<{ id: number }[]>`
    UPDATE reviews
    SET decision = 'approved', decided_at = NOW(), reviewer = 'smoke'
    WHERE id = (
      SELECT id FROM reviews
      WHERE incident_id = ${id}::uuid AND decision = 'pending'
      ORDER BY created_at DESC LIMIT 1
    )
    AND decision = 'pending'
    RETURNING id
  `;
  if (!claimed) throw new Error("failed to claim pending review");

  // Mark awaiting_review -> acting path via execute (status must stay awaiting_review until action)
  // Review route would set decision; we already claimed. Status is still awaiting_review.
  const action = await executeApprovedAction(id);
  console.log("action", action);
  if (!action.ok) throw new Error(`action failed: ${action.error}`);
  process.env.VERIFY_SAMPLES = process.env.VERIFY_SAMPLES ?? "2";
  process.env.VERIFY_INTERVAL_MS = process.env.VERIFY_INTERVAL_MS ?? "0";
  const verify = await verifyRecovery(id);
  console.log("verify", verify);
  if (!verify.ok) throw new Error("verify failed");
  const pm = await writePostmortem(id);
  console.log("postmortem", pm.title);
  await sql.end({ timeout: 1 });
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
