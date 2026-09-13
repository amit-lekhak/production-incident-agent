export async function chargePayment(input: {
  amountCents: number;
  method: string;
}) {
  await sleep(40);
  if (!input.method) throw new Error("payment method required");
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
  await sleep(40);
  return chargePayment(input);
}

/** Intentionally slow payments dependency (payment_timeout chaos). */
export async function chargePaymentSlow(input: {
  amountCents: number;
  method: string;
}) {
  await sleep(1800);
  return chargePayment(input);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
