import "../src/lib/load-env";
import { injectFault } from "../src/lib/sim/faults";
import { tickOnce } from "../src/lib/sim/ticker";
import { runWatcher } from "../src/lib/sim/watcher";
import { runDiagnosisPipeline } from "../src/lib/agent/pipeline";
import { executeApprovedAction } from "../src/lib/agent/actions";
import { verifyRecovery } from "../src/lib/agent/verifier";
import { writePostmortem } from "../src/lib/agent/postmortem";
import { sql } from "../src/lib/db";

async function main() {
  await injectFault("n_plus_one");
  await tickOnce();
  const watch = await runWatcher();
  const opened = watch.find((w) => w.opened);
  if (!opened || !("incidentId" in opened)) throw new Error("no incident");
  const id = opened.incidentId;
  await runDiagnosisPipeline(id, { forceOracle: true });
  await sql`
    UPDATE reviews SET decision = 'approved', decided_at = NOW()
    WHERE incident_id = ${id}::uuid AND decision = 'pending'
  `;
  const action = await executeApprovedAction(id);
  console.log("action", action);
  const verify = await verifyRecovery(id, 2);
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
