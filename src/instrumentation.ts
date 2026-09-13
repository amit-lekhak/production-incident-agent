import { storeLangfuseProcessor } from "@/lib/observability/langfuse";
import { getEnv, hasLangfuse } from "@/lib/env";

/**
 * Optional Langfuse + AI SDK telemetry. Local demo works with no keys —
 * we skip OTel export entirely when LANGFUSE_* is unset.
 * Also starts ticker/watcher so the demo loop is live after boot.
 */
export async function register() {
  // Fail fast on missing DATABASE_URL etc.
  getEnv();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureTicker } = await import("@/lib/sim/ticker");
    const { ensureWatcher } = await import("@/lib/sim/watcher");
    const { syncRuntimeFromCurrentDeploy } =
      await import("@/lib/sim/deployed-runtime");
    ensureTicker();
    ensureWatcher();
    syncRuntimeFromCurrentDeploy()
      .then((rt) => {
        console.info(
          `[boot] deployed runtime sha=${rt?.sha?.slice(0, 12) ?? "none"} scenario=${rt?.scenario ?? "healthy"}`,
        );
      })
      .catch((err) => {
        console.warn("[boot] deploy sync failed", err);
      });
    console.info("[boot] ticker and watcher started");
  }

  if (!hasLangfuse()) {
    console.info("[otel] Langfuse keys missing — AI telemetry export disabled");
    return;
  }

  const env = getEnv();
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { LangfuseSpanProcessor } = await import("@langfuse/otel");
  const { registerTelemetry } = await import("ai");
  const { LangfuseVercelAiSdkIntegration } =
    await import("@langfuse/vercel-ai-sdk");

  const langfuseSpanProcessor = new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_HOST,
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
