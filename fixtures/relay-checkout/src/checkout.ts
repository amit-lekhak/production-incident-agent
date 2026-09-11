/**
 * Relay Checkout fixture — the "production" TypeScript service agents inspect.
 * Healthy baseline. Fault injection overlays N+1 / payment / error behavior at runtime;
 * this source is what Graphify indexes for code_query tools.
 */
import { lookupProduct } from "./catalog";
import { chargePayment } from "./payments";

export type CheckoutItem = { productId: string; qty: number };
export type CheckoutRequest = {
  cartId: string;
  items: CheckoutItem[];
  paymentMethod: string;
};

export async function checkout(req: CheckoutRequest) {
  // Healthy path: one catalog batch lookup, then payment.
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
  };
}
