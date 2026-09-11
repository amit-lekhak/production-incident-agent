import "../src/lib/load-env";
import { injectFault } from "../src/lib/sim/faults";
import { tickOnce } from "../src/lib/sim/ticker";
import { runWatcher } from "../src/lib/sim/watcher";
import { sql } from "../src/lib/db";

async function main() {
  const injected = await injectFault("n_plus_one");
  console.log("injected", injected.deploySha);
  const tick = await tickOnce();
  console.log("tick", tick);
  const watch = await runWatcher();
  console.log("watch", JSON.stringify(watch, null, 2));
  await sql.end({ timeout: 1 });
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 1 });
  process.exit(1);
});
