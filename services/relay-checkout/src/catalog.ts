import { pushSpan } from "./spans";

const CATALOG: Record<
  string,
  { id: string; name: string; priceCents: number }
> = {
  sku_mug: { id: "sku_mug", name: "Relay Mug", priceCents: 1800 },
  sku_tee: { id: "sku_tee", name: "Relay Tee", priceCents: 3200 },
  sku_hat: { id: "sku_hat", name: "Relay Hat", priceCents: 2400 },
};

export async function lookupProduct(productId: string) {
  const started = Date.now();
  await sleep(8);
  const product = CATALOG[productId];
  if (!product) throw new Error(`Unknown product ${productId}`);
  pushSpan({
    name: "catalog.lookup",
    durationMs: Date.now() - started,
    status: "ok",
    attrs: { productId, nPlusOne: false },
  });
  return product;
}

/** Slow per-item lookup — do not call in a loop from checkout (N+1). */
export async function lookupProductNPlusOne(productId: string) {
  const started = Date.now();
  await sleep(700);
  const product = await lookupProductBare(productId);
  pushSpan({
    name: "catalog.lookup",
    durationMs: Date.now() - started,
    status: "ok",
    attrs: { productId, nPlusOne: true },
  });
  return product;
}

async function lookupProductBare(productId: string) {
  await sleep(8);
  const product = CATALOG[productId];
  if (!product) throw new Error(`Unknown product ${productId}`);
  return product;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
