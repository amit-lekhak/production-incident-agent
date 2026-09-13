import { z } from "zod";
import { apiError } from "@/lib/api-error";
import { clearFaults, injectFault } from "@/lib/sim/faults";
import { ensureTicker, tickOnce } from "@/lib/sim/ticker";
import { ensureWatcher, runWatcher } from "@/lib/sim/watcher";
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

async function tickAndWatch() {
  const minSamples = Math.max(2, Number(process.env.WATCHER_MIN_SAMPLES ?? 2));
  const ticks: unknown[] = [];
  for (let i = 0; i < minSamples; i++) {
    ticks.push(await tickOnce());
  }
  const watch = await runWatcher();
  return { ticks, tick: ticks[ticks.length - 1] ?? null, watch };
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
      try {
        const sampled = await tickAndWatch();
        return Response.json({ injected, ...sampled });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[chaos] post-inject tick/watch", err);
        return Response.json(
          {
            injected,
            tick: null,
            watch: null,
            tickWatchError: message,
          },
          { status: 500 },
        );
      }
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
