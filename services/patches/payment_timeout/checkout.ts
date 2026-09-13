/**
 * BUG: always use slow payments path (payments_v2 misfire).
 * Chaos scenario: payment_timeout
 */
import { lookupProduct } from "./catalog";
import { chargePaymentSlow } from "./payments";
import { DB_POOL_SIZE } from "./pool";

export type CheckoutItem = { productId: string; qty: number };
export type CheckoutRequest = {
  cartId: string;
  items: CheckoutItem[];
  paymentMethod: string;
  meta?: { source?: string } | null;
};

export async function checkout(req: CheckoutRequest) {
  const source = req.meta?.source ?? "web";
  void DB_POOL_SIZE;

  const products = await Promise.all(
    req.items.map((i) => lookupProduct(i.productId)),
  );
  const total = products.reduce(
    (sum, p, idx) => sum + p.priceCents * req.items[idx]!.qty,
    0,
  );
  const payment = await chargePaymentSlow({
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
