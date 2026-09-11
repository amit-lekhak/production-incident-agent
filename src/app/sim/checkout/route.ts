import { ensureTicker } from "@/lib/sim/ticker";
import { ensureWatcher } from "@/lib/sim/watcher";
import { runCheckout, type CheckoutBody } from "@/lib/sim/checkout";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureTicker();
  ensureWatcher();
  const result = await runCheckout();
  return Response.json(result.body, { status: result.status });
}

export async function POST(req: Request) {
  ensureTicker();
  ensureWatcher();
  let body: CheckoutBody = {};
  try {
    body = (await req.json()) as CheckoutBody;
  } catch {
    body = {};
  }
  const result = await runCheckout(body);
  return Response.json(result.body, { status: result.status });
}
