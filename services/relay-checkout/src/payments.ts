import { pushSpan } from "./spans";

export async function chargePayment(input: {
  amountCents: number;
  method: string;
}) {
  const started = Date.now();
  await sleep(40);
  if (!input.method) throw new Error("payment method required");
  const result = {
    id: `pay_${Date.now()}`,
    status: "captured" as const,
    amountCents: input.amountCents,
  };
  pushSpan({
    name: "payments.charge",
    durationMs: Date.now() - started,
    status: "ok",
    attrs: { slow: false, path: "v1" },
  });
  return result;
}

/**
 * Payments v2 — gated by the payments_v2 feature flag at runtime.
 * Healthy default is still fast; chaos may replace this with a slow path.
 */
export async function chargePaymentV2(input: {
  amountCents: number;
  method: string;
}) {
  const started = Date.now();
  await sleep(40);
  if (!input.method) throw new Error("payment method required");
  const result = {
    id: `pay_${Date.now()}`,
    status: "captured" as const,
    amountCents: input.amountCents,
  };
  pushSpan({
    name: "payments.charge",
    durationMs: Date.now() - started,
    status: "ok",
    attrs: { slow: false, path: "v2" },
  });
  return result;
}

/** Intentionally slow payments dependency (payment_timeout chaos). */
export async function chargePaymentSlow(input: {
  amountCents: number;
  method: string;
}) {
  const started = Date.now();
  await sleep(1800);
  if (!input.method) throw new Error("payment method required");
  const result = {
    id: `pay_${Date.now()}`,
    status: "captured" as const,
    amountCents: input.amountCents,
  };
  pushSpan({
    name: "payments.charge",
    durationMs: Date.now() - started,
    status: "ok",
    attrs: { slow: true, path: "v2" },
  });
  return result;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
