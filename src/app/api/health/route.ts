import { sql } from "@/lib/db";
import { getEnv, hasGeminiKey, hasLangfuse } from "@/lib/env";
import { tickerRunning } from "@/lib/sim/ticker";
import { watcherRunning } from "@/lib/sim/watcher";

export const dynamic = "force-dynamic";

export async function GET() {
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await sql`SELECT 1`;
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const env = getEnv();
  const body = {
    ok: dbOk,
    db: dbOk ? "up" : "down",
    dbError,
    ticker: tickerRunning() ? "running" : "stopped",
    watcher: watcherRunning() ? "running" : "stopped",
    gemini: hasGeminiKey(env) ? "configured" : "missing",
    langfuse: hasLangfuse(env) ? "configured" : "missing",
  };

  return Response.json(body, { status: dbOk ? 200 : 503 });
}
