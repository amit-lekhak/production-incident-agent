const CATALOG: Record<
  string,
  { id: string; name: string; priceCents: number }
> = {
  sku_mug: { id: "sku_mug", name: "Relay Mug", priceCents: 1800 },
  sku_tee: { id: "sku_tee", name: "Relay Tee", priceCents: 3200 },
  sku_hat: { id: "sku_hat", name: "Relay Hat", priceCents: 2400 },
};

export async function lookupProduct(productId: string) {
  // Simulated DB round-trip (~8ms healthy).
  await sleep(8);
  const product = CATALOG[productId];
  if (!product) throw new Error(`Unknown product ${productId}`);
  return product;
}

/** Slow per-item lookup — do not call in a loop from checkout (N+1). */
export async function lookupProductNPlusOne(productId: string) {
  await sleep(700);
  return lookupProduct(productId);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
