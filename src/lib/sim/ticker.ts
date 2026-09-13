import { sql } from "@/lib/db";
import { runCheckout } from "./checkout";
import { getActiveFault, getServiceId } from "./faults";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** Sample live checkout behavior into metric_samples. */
export async function tickOnce() {
  const serviceId = await getServiceId();
  const fault = await getActiveFault(serviceId);

  const samples: number[] = [];
  let errors = 0;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const result = await runCheckout();
    samples.push(result.durationMs);
    if (!result.ok) errors += 1;
  }

  samples.sort((a, b) => a - b);
  const p95 =
    samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ??
    0;
  const errorRate = errors / n;

  let poolWait = 5 + Math.random() * 10;
  let paymentsP99 = 50 + Math.random() * 30;
  if (fault?.scenario === "pool_exhaustion")
    poolWait = 700 + Math.random() * 200;
  if (fault?.scenario === "payment_timeout")
    paymentsP99 = 1800 + Math.random() * 400;

  const at = new Date().toISOString();
  await sql`
    INSERT INTO metric_samples (service_id, name, value, labels, sampled_at)
    VALUES
      (${serviceId}, 'checkout_latency_p95', ${p95}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
      (${serviceId}, 'checkout_error_rate', ${errorRate}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
      (${serviceId}, 'db_pool_wait_ms', ${poolWait}, ${jsonb({ service: "relay-checkout" })}, ${at}::timestamptz),
      (${serviceId}, 'payments_latency_p99', ${paymentsP99}, ${jsonb({ dependency: "payments" })}, ${at}::timestamptz)
  `;

  return {
    p95,
    errorRate,
    poolWait,
    paymentsP99,
    fault: fault?.scenario ?? null,
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
  // fire once soon
  void tickOnce().catch(() => undefined);
}

export function tickerRunning(): boolean {
  return Boolean(globalTick.__relayTicker?.timer);
}
