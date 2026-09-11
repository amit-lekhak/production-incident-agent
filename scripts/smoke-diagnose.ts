import "../src/lib/load-env";
import { injectFault } from "../src/lib/sim/faults";
import { tickOnce } from "../src/lib/sim/ticker";
import { runWatcher } from "../src/lib/sim/watcher";
import { runDiagnosisPipeline } from "../src/lib/agent/pipeline";
import { sql } from "../src/lib/db";

async function main() {
  await injectFault("n_plus_one");
  await tickOnce();
  const watch = await runWatcher();
  const opened = watch.find((w) => w.opened);
  if (!opened || !("incidentId" in opened)) {
    console.error("No incident opened", watch);
    process.exit(1);
  }
  const result = await runDiagnosisPipeline(opened.incidentId, {
    forceOracle: true,
  });
  console.log(JSON.stringify(result, null, 2));
  await sql.end({ timeout: 1 });
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
