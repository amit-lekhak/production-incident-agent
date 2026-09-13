import {
  DiagnosisConflictError,
  runDiagnosisPipeline,
} from "@/lib/agent/pipeline";
import { apiError } from "@/lib/api-error";
import { classifyProviderError } from "@/lib/agent/provider-errors";
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
    return apiError("validation", "Invalid request body", 400);
  }
  try {
    const result = await runDiagnosisPipeline(parsed.data.incidentId, {
      forceOracle: parsed.data.forceOracle,
    });
    return Response.json(result);
  } catch (err) {
    if (err instanceof DiagnosisConflictError) {
      return apiError("conflict", err.message, 409);
    }
    const classified = classifyProviderError(err);
    console.error("[diagnose]", parsed.data.incidentId, err);
    return apiError(
      classified.code,
      classified.userMessage,
      classified.code === "unknown" ? 500 : 502,
    );
  }
}
