/**
 * BUG: payments_v2 routes through a slow dependency.
 * When the host disables payments_v2, checkout falls back to the fast path
 * without requiring a redeploy.
 */
import { lookupProduct } from "./catalog";
import { chargePayment, chargePaymentSlow } from "./payments";
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

  const products = await Promise.all(
    req.items.map((i) => lookupProduct(i.productId)),
  );
  const total = products.reduce(
    (sum, p, idx) => sum + p.priceCents * req.items[idx]!.qty,
    0,
  );
  // Flag defaults on for this deploy (chaos enables payments_v2).
  const useV2 = req.flags?.payments_v2 !== false;
  const payment = useV2
    ? await chargePaymentSlow({
        amountCents: total,
        method: req.paymentMethod,
      })
    : await chargePayment({
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
