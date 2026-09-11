import { sql } from "@/lib/db";
import { getActiveFault, getServiceId } from "./faults";
import type { ActiveFault } from "./types";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export type CheckoutBody = {
  cartId?: string;
  items?: Array<{ productId: string; qty: number }>;
  paymentMethod?: string;
};

export type CheckoutResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  durationMs: number;
  requestId: string;
};

const PRODUCTS = ["sku_mug", "sku_tee", "sku_hat"] as const;

async function catalogLookup(productId: string, nPlusOne: boolean) {
  // Healthy ~8ms; N+1 ~700ms so a 3-item cart clears the 2s p95 alert.
  const ms = nPlusOne ? 700 + Math.random() * 100 : 8 + Math.random() * 4;
  await sleep(ms);
  return { productId, priceCents: 2000, durationMs: Math.round(ms) };
}

async function charge(amountCents: number, slow: boolean) {
  const ms = slow ? 1600 + Math.random() * 400 : 40 + Math.random() * 20;
  await sleep(ms);
  return { id: `pay_${Date.now()}`, amountCents, durationMs: Math.round(ms) };
}

export async function runCheckout(
  input: CheckoutBody = {},
): Promise<CheckoutResult> {
  const serviceId = await getServiceId();
  const fault = await getActiveFault(serviceId);
  const started = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const items =
    input.items && input.items.length > 0
      ? input.items
      : [
          { productId: PRODUCTS[0], qty: 1 },
          { productId: PRODUCTS[1], qty: 2 },
          { productId: PRODUCTS[2], qty: 1 },
        ];
  const cartId = input.cartId ?? `cart_${Math.floor(Math.random() * 10000)}`;
  const paymentMethod = input.paymentMethod ?? "card";

  const spans: Array<{
    name: string;
    durationMs: number;
    status: string;
    attrs?: Record<string, unknown>;
  }> = [];

  try {
    if (fault?.scenario === "error_spike" && Math.random() < 0.7) {
      await sleep(30);
      throw new Error(
        "TypeError: Cannot read properties of null (reading 'meta')",
      );
    }

    if (fault?.scenario === "pool_exhaustion") {
      const wait = 600 + Math.random() * 400;
      await sleep(wait);
      spans.push({
        name: "db.pool.wait",
        durationMs: Math.round(wait),
        status: "ok",
        attrs: { poolSize: 2 },
      });
      await sql`
        INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
        VALUES (${serviceId}, 'pool.wait', ${Math.round(wait)}, 0, NOW())
      `;
    }

    const nPlusOne = fault?.scenario === "n_plus_one";
    let catalogTotal = 0;
    for (const item of items) {
      const look = await catalogLookup(item.productId, nPlusOne);
      catalogTotal += look.durationMs;
      spans.push({
        name: "catalog.lookup",
        durationMs: look.durationMs,
        status: "ok",
        attrs: { productId: item.productId, nPlusOne },
      });
      await sql`
        INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
        VALUES (${serviceId}, 'catalog.lookup', ${look.durationMs}, 1, NOW())
      `;
    }

    const slowPay = fault?.scenario === "payment_timeout";
    const totalCents = items.reduce((s, i) => s + 2000 * i.qty, 0);
    const payment = await charge(totalCents, slowPay);
    spans.push({
      name: "payments.charge",
      durationMs: payment.durationMs,
      status: "ok",
      attrs: { slow: slowPay },
    });

    const durationMs = Date.now() - started;
    await persistTrace(serviceId, requestId, durationMs, "ok", spans, fault);
    await sql`
      INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
      VALUES (
        ${serviceId},
        'info',
        ${`checkout ok cart=${cartId} duration_ms=${durationMs}`},
        ${jsonb({ requestId, cartId, catalogTotal, fault: fault?.scenario ?? null })},
        NOW()
      )
    `;

    return {
      ok: true,
      status: 200,
      durationMs,
      requestId,
      body: {
        orderId: `ord_${cartId}`,
        totalCents,
        paymentId: payment.id,
        durationMs,
        requestId,
        fault: fault?.scenario ?? null,
      },
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    spans.push({
      name: "checkout.error",
      durationMs: 1,
      status: "error",
      attrs: { message },
    });
    await persistTrace(serviceId, requestId, durationMs, "error", spans, fault);
    await sql`
      INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
      VALUES (
        ${serviceId},
        'error',
        ${message},
        ${jsonb({ requestId, fault: fault?.scenario ?? null })},
        NOW()
      )
    `;
    const [existingErr] = await sql<{ id: number }[]>`
      SELECT id FROM error_events
      WHERE service_id = ${serviceId} AND fingerprint = 'checkout.null_meta'
      ORDER BY last_seen_at DESC LIMIT 1
    `;
    if (existingErr) {
      await sql`
        UPDATE error_events
        SET count = count + 1, last_seen_at = NOW(), message = ${message},
            deploy_sha = ${fault?.deploySha ?? null}
        WHERE id = ${existingErr.id}
      `;
    } else {
      await sql`
        INSERT INTO error_events (service_id, fingerprint, title, message, count, last_seen_at, deploy_sha)
        VALUES (
          ${serviceId},
          'checkout.null_meta',
          'TypeError in checkout handler',
          ${message},
          1,
          NOW(),
          ${fault?.deploySha ?? null}
        )
      `;
    }

    return {
      ok: false,
      status: 500,
      durationMs,
      requestId,
      body: {
        error: message,
        requestId,
        durationMs,
        fault: fault?.scenario ?? null,
      },
    };
  }
}

async function persistTrace(
  serviceId: number,
  requestId: string,
  durationMs: number,
  status: string,
  spans: Array<{
    name: string;
    durationMs: number;
    status: string;
    attrs?: Record<string, unknown>;
  }>,
  fault: ActiveFault | null,
) {
  await sql`
    INSERT INTO traces (service_id, request_id, root_span, duration_ms, status, spans, traced_at)
    VALUES (
      ${serviceId},
      ${requestId},
      'checkout',
      ${durationMs},
      ${status},
      ${jsonb(spans)},
      NOW()
    )
  `;
  void fault;
}
