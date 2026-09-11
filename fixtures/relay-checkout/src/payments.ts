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

/** Slow payments dependency used by payment_timeout scenario. */
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
