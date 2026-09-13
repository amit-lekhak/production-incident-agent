/**
 * BUG: null deref on cart metadata.
 * Chaos scenario: error_spike
 */
import { lookupProduct } from "./catalog";
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
  void DB_POOL_SIZE;
  void req.flags;
  // Intentional bug: assume meta is always present.
  const source = req.meta!.source!;

  const products = await Promise.all(
    req.items.map((i) => lookupProduct(i.productId)),
  );
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
