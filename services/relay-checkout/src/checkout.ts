/**
 * Relay Checkout — the production TypeScript service under incident response.
 * Live at the GitHub-deployed SHA. Edit here to introduce bugs and real history.
 */
import { lookupProduct } from "./catalog";
import { chargePayment, chargePaymentV2 } from "./payments";
import { DB_POOL_SIZE } from "./pool";

export type CheckoutItem = { productId: string; qty: number };
export type CheckoutRequest = {
  cartId: string;
  items: CheckoutItem[];
  paymentMethod: string;
  meta?: { source?: string } | null;
  /** Runtime feature flags injected by the host (not stored in git). */
  flags?: { payments_v2?: boolean };
};

export async function checkout(req: CheckoutRequest) {
  // Guard empty cart metadata (historical null-deref fix).
  const source = req.meta?.source ?? "web";

  // Healthy path: parallel catalog lookups, then payment.
  // Pool size is config-only here; runtime sim uses this constant for wait modeling.
  void DB_POOL_SIZE;

  const products = await Promise.all(
    req.items.map((i) => lookupProduct(i.productId)),
  );
  const total = products.reduce(
    (sum, p, idx) => sum + p.priceCents * req.items[idx]!.qty,
    0,
  );
  const useV2 = req.flags?.payments_v2 === true;
  const payment = useV2
    ? await chargePaymentV2({
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
