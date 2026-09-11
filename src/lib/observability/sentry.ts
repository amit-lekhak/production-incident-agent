/**
 * Optional Sentry for THIS Next.js app crashing — not the simulated Relay error inbox.
 * No-op when SENTRY_DSN is unset. skipOpenTelemetrySetup avoids fighting Langfuse OTel.
 */
export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  // Dynamic require pattern kept lazy so builds without DSN stay light.
  return {
    dsn,
    skipOpenTelemetrySetup: true as const,
  };
}

export async function captureAppException(
  err: unknown,
  context?: Record<string, unknown>,
) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.error("[sentry:noop]", err, context ?? {});
    return;
  }
  try {
    const Sentry = await import("@sentry/nextjs");
    if (
      !(globalThis as unknown as { __sentryInited?: boolean }).__sentryInited
    ) {
      Sentry.init({
        dsn,
        skipOpenTelemetrySetup: true,
        tracesSampleRate: 0.1,
      });
      (globalThis as unknown as { __sentryInited?: boolean }).__sentryInited =
        true;
    }
    Sentry.captureException(err, { extra: context });
  } catch (e) {
    console.error("[sentry:failed]", e, err);
  }
}
