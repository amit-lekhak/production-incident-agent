import { z } from "zod";
import { clearFaults, injectFault } from "@/lib/sim/faults";
import { ensureTicker } from "@/lib/sim/ticker";
import { ensureWatcher, runWatcher } from "@/lib/sim/watcher";
import { tickOnce } from "@/lib/sim/ticker";
import { SCENARIO_META, type FaultScenario } from "@/lib/sim/types";

export const dynamic = "force-dynamic";

const injectSchema = z.object({
  action: z.enum(["inject", "clear", "tick", "watch"]),
  scenario: z
    .enum(["n_plus_one", "payment_timeout", "error_spike", "pool_exhaustion"])
    .optional(),
});

export async function GET() {
  ensureTicker();
  ensureWatcher();
  return Response.json({
    scenarios: Object.entries(SCENARIO_META).map(([id, meta]) => ({
      id,
      ...meta,
    })),
  });
}

export async function POST(req: Request) {
  ensureTicker();
  ensureWatcher();
  const json = await req.json();
  const parsed = injectSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { action, scenario } = parsed.data;
  if (action === "inject") {
    if (!scenario) {
      return Response.json({ error: "scenario required" }, { status: 400 });
    }
    const injected = await injectFault(scenario as FaultScenario);
    // accelerate signal so watcher can open soon
    await tickOnce();
    const watch = await runWatcher();
    return Response.json({ injected, watch });
  }
  if (action === "clear") {
    const cleared = await clearFaults();
    return Response.json({ cleared });
  }
  if (action === "tick") {
    const tick = await tickOnce();
    return Response.json({ tick });
  }
  const watch = await runWatcher();
  return Response.json({ watch });
}
