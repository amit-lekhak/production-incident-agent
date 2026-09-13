import { pushSpan } from "./spans";

export async function chargePayment(input: {
  amountCents: number;
  method: string;
}) {
  const started = Date.now();
  await sleep(40);
  if (!input.method) throw new Error("payment method required");
  pushSpan({
    name: "payments.charge",
    durationMs: Date.now() - started,
    status: "ok",
    attrs: { slow: false },
  });
  return {
    id: `pay_${Date.now()}`,
    status: "captured" as const,
    amountCents: input.amountCents,
  };
}

/**
 * Payments v2 slow path — gated by the payments_v2 feature flag at runtime.
 * Healthy default still uses chargePayment.
 */
export async function chargePaymentV2(input: {
  amountCents: number;
  method: string;
}) {
  return chargePayment(input);
}

/** Intentionally slow payments dependency (payment_timeout chaos). */
export async function chargePaymentSlow(input: {
  amountCents: number;
  method: string;
}) {
  const started = Date.now();
  await sleep(1800);
  if (!input.method) throw new Error("payment method required");
  pushSpan({
    name: "payments.charge",
    durationMs: Date.now() - started,
    status: "ok",
    attrs: { slow: true },
  });
  return {
    id: `pay_${Date.now()}`,
    status: "captured" as const,
    amountCents: input.amountCents,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
