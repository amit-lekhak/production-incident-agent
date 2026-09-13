/**
 * Langfuse / OTel helpers used by the app and by instrumentation.register().
 */

export type LangfuseSpanProcessor = {
  forceFlush: () => Promise<void>;
};

export function storeLangfuseProcessor(processor: LangfuseSpanProcessor) {
  (
    globalThis as unknown as {
      __langfuseSpanProcessor?: LangfuseSpanProcessor;
    }
  ).__langfuseSpanProcessor = processor;
}

export async function flushTelemetry() {
  const processor = (
    globalThis as unknown as {
      __langfuseSpanProcessor?: LangfuseSpanProcessor;
    }
  ).__langfuseSpanProcessor;
  if (processor) await processor.forceFlush();
}

/** Best-effort OTel trace id for linking incidents to Langfuse. */
export async function currentTraceId(): Promise<string | null> {
  try {
    const api = await import("@opentelemetry/api");
    const span = api.trace.getActiveSpan();
    const id = span?.spanContext().traceId;
    if (id && id !== "00000000000000000000000000000000") return id;
  } catch {
    // optional
  }
  return null;
}
