/**
 * BUG: per-item enrichment — sequential N+1 catalog lookups.
 * Chaos scenario: n_plus_one
 */
import { lookupProductNPlusOne } from "./catalog";
import { chargePayment } from "./payments";
import { DB_POOL_SIZE } from "./pool";

export type CheckoutItem = { productId: string; qty: number };
export type CheckoutRequest = {
  cartId: string;
  items: CheckoutItem[];
  paymentMethod: string;
  meta?: { source?: string } | null;
  flags?: { payments_v2?: boolean };
};

export async function checkout(req: CheckoutRequest) {
  const source = req.meta?.source ?? "web";
  void DB_POOL_SIZE;
  void req.flags;

  // N+1: one slow catalog round-trip per line item (cart size × ~700ms).
  const products = [];
  for (const item of req.items) {
    products.push(await lookupProductNPlusOne(item.productId));
  }
  const total = products.reduce(
    (sum, p, idx) => sum + p.priceCents * req.items[idx]!.qty,
    0,
  );
  const payment = await chargePayment({
    amountCents: total,
    method: req.paymentMethod,
  });
  return {
    orderId: `ord_${req.cartId}`,
    totalCents: total,
    paymentId: payment.id,
    source,
  };
}
