import { sql } from "@/lib/db";
import { runCheckout } from "./checkout";
import { getServiceId } from "./faults";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * p) - 1),
  );
  return sorted[idx]!;
}

/** Sample live checkout behavior into metric_samples. */
export async function tickOnce() {
  const serviceId = await getServiceId();

  const samples: number[] = [];
  const payMs: number[] = [];
  const poolMs: number[] = [];
  let errors = 0;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const result = await runCheckout();
    samples.push(result.durationMs);
    if (!result.ok) errors += 1;
    for (const span of result.spans) {
      if (span.name === "payments.charge") payMs.push(span.durationMs);
      if (span.name === "db.pool.wait") poolMs.push(span.durationMs);
    }
  }

  samples.sort((a, b) => a - b);
  const p95 = percentile(samples, 0.95);
  const errorRate = errors / n;

  payMs.sort((a, b) => a - b);
  poolMs.sort((a, b) => a - b);
  // Derive dependency metrics from spans observed this tick (not chaos labels).
  const paymentsP99 =
    payMs.length > 0 ? percentile(payMs, 0.99) : 50 + Math.random() * 30;
  const poolWait =
    poolMs.length > 0 ? percentile(poolMs, 0.95) : 5 + Math.random() * 10;

  const at = new Date().toISOString();
  await sql`
    INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
    VALUES
      (${serviceId}, 'checkout_latency_p95', ${p95}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
      (${serviceId}, 'checkout_error_rate', ${errorRate}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
      (${serviceId}, 'db_pool_wait_ms', ${poolWait}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
      (${serviceId}, 'payments_latency_p99', ${paymentsP99}, ${jsonb({ dependency: "payments" })}, ${at}::timestamptz)
  `;

  const retentionHours = Number(process.env.METRIC_RETENTION_HOURS ?? 6);
  if (retentionHours > 0) {
    await sql`
      DELETE FROM metric_samples
      WHERE service_id = ${serviceId}
        AND sampled_at < NOW() - make_interval(hours => ${retentionHours})
    `.catch(() => undefined);
  }

  return {
    p95,
    errorRate,
    poolWait,
    paymentsP99,
    metrics: {
      checkout_latency_p95: p95,
      checkout_error_rate: errorRate,
      db_pool_wait_ms: poolWait,
      payments_latency_p99: paymentsP99,
    } as Record<string, number>,
  };
}

const globalTick = globalThis as unknown as {
  __relayTicker?: {
    timer: ReturnType<typeof setInterval> | null;
    running: boolean;
  };
};

export function ensureTicker() {
  if (!globalTick.__relayTicker) {
    globalTick.__relayTicker = { timer: null, running: false };
  }
  const state = globalTick.__relayTicker;
  if (state.timer) return;
  const interval = Number(process.env.TICKER_INTERVAL_MS ?? 3000);
  state.timer = setInterval(() => {
    if (state.running) return;
    state.running = true;
    tickOnce()
      .catch((err) => console.error("[ticker]", err))
      .finally(() => {
        state.running = false;
      });
  }, interval);
  void tickOnce().catch(() => undefined);
}

export function tickerRunning(): boolean {
  return Boolean(globalTick.__relayTicker?.timer);
}
