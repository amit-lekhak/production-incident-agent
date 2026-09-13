import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { clearFaults, injectFault } from "@/lib/sim/faults";
import { ensureTicker } from "@/lib/sim/ticker";
import { ensureWatcher, runWatcher } from "@/lib/sim/watcher";
import { tickOnce } from "@/lib/sim/ticker";
import { SCENARIO_META, type FaultScenario } from "@/lib/sim/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
  try {
    const json = await req.json();
    const parsed = injectSchema.safeParse(json);
    if (!parsed.success) {
      return apiError("validation", "Invalid chaos request", 400);
    }

    const { action, scenario } = parsed.data;
    if (action === "inject") {
      if (!scenario) {
        return apiError("validation", "scenario required", 400);
      }
      const injected = await injectFault(scenario as FaultScenario);
      let tick: unknown = null;
      let watch: unknown = null;
      try {
        tick = await tickOnce();
        watch = await runWatcher();
      } catch (err) {
        console.error("[chaos] post-inject tick/watch", err);
      }
      return Response.json({ injected, tick, watch });
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[chaos]", message, err);
    return apiError("chaos_failed", message, 500);
  }
}
