import { storeLangfuseProcessor } from "@/lib/observability/langfuse";

/**
 * Optional Langfuse + AI SDK telemetry. Local demo works with no keys —
 * we skip OTel export entirely when LANGFUSE_* is unset.
 */
export async function register() {
  const pub = process.env.LANGFUSE_PUBLIC_KEY;
  const secret = process.env.LANGFUSE_SECRET_KEY;
  if (!pub || !secret) {
    console.info("[otel] Langfuse keys missing — AI telemetry export disabled");
    return;
  }

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { LangfuseSpanProcessor } = await import("@langfuse/otel");
  const { registerTelemetry } = await import("ai");
  const { LangfuseVercelAiSdkIntegration } =
    await import("@langfuse/vercel-ai-sdk");

  const langfuseSpanProcessor = new LangfuseSpanProcessor({
    publicKey: pub,
    secretKey: secret,
    baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
    exportMode: "immediate",
  });

  const sdk = new NodeSDK({
    spanProcessors: [langfuseSpanProcessor],
  });
  sdk.start();
  registerTelemetry(new LangfuseVercelAiSdkIntegration());
  storeLangfuseProcessor(langfuseSpanProcessor);

  console.info("[otel] Langfuse telemetry registered");
}

export { flushTelemetry, currentTraceId } from "@/lib/observability/langfuse";
