import { runDiagnosisPipeline } from "@/lib/agent/pipeline";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bodySchema = z.object({
  incidentId: z.string().uuid(),
  forceOracle: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const result = await runDiagnosisPipeline(parsed.data.incidentId, {
      forceOracle: parsed.data.forceOracle,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
