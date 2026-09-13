import { sql } from "@/lib/db";
import { getServiceId } from "./faults";
import {
  getDeployedRuntime,
  syncRuntimeFromCurrentDeploy,
} from "./deployed-runtime";
import type { FaultScenario } from "./types";

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
  meta?: { source?: string } | null;
};

export type CheckoutResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  durationMs: number;
  requestId: string;
};

const PRODUCTS = ["sku_mug", "sku_tee", "sku_hat"] as const;

export async function runCheckout(
  input: CheckoutBody = {},
): Promise<CheckoutResult> {
  const serviceId = await getServiceId();
  let rt = getDeployedRuntime();
  if (!rt) {
    rt = await syncRuntimeFromCurrentDeploy();
  }
  const scenario: FaultScenario | null = rt?.scenario ?? null;
  const deploySha = rt?.sha && rt.sha !== "local-workspace" ? rt.sha : null;
  const poolSize = rt?.poolSize ?? 10;

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
  // error_spike: omit meta so buggy `req.meta!.source` throws
  const meta =
    input.meta !== undefined
      ? input.meta
      : scenario === "error_spike"
        ? null
        : { source: "web" };

  const spans: Array<{
    name: string;
    durationMs: number;
    status: string;
    attrs?: Record<string, unknown>;
  }> = [];

  try {
    if (scenario === "pool_exhaustion" || poolSize <= 2) {
      const wait = 600 + Math.random() * 400;
      await sleep(wait);
      spans.push({
        name: "db.pool.wait",
        durationMs: Math.round(wait),
        status: "ok",
        attrs: { poolSize },
      });
      await sql`
        INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
        VALUES (${serviceId}, 'pool.wait', ${Math.round(wait)}, 0, NOW())
      `;
    }

    // Prefer executing the deployed module (real source at SHA).
    if (rt?.module?.checkout) {
      const before = Date.now();
      const result = await rt.module.checkout({
        cartId,
        items,
        paymentMethod,
        meta,
      });
      const durationMs = Date.now() - before;

      // Derive spans from scenario for observability tools
      if (scenario === "n_plus_one") {
        for (const item of items) {
          const ms = Math.round(durationMs / items.length);
          spans.push({
            name: "catalog.lookup",
            durationMs: ms,
            status: "ok",
            attrs: { productId: item.productId, nPlusOne: true },
          });
          await sql`
            INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
            VALUES (${serviceId}, 'catalog.lookup', ${ms}, 1, NOW())
          `;
        }
      } else {
        const per = Math.max(8, Math.round(40 / Math.max(items.length, 1)));
        for (const item of items) {
          spans.push({
            name: "catalog.lookup",
            durationMs: per,
            status: "ok",
            attrs: { productId: item.productId, nPlusOne: false },
          });
          await sql`
            INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
            VALUES (${serviceId}, 'catalog.lookup', ${per}, 1, NOW())
          `;
        }
      }
      const payMs =
        scenario === "payment_timeout"
          ? Math.max(1600, durationMs - 50)
          : Math.min(80, Math.max(30, durationMs));
      spans.push({
        name: "payments.charge",
        durationMs: payMs,
        status: "ok",
        attrs: { slow: scenario === "payment_timeout" },
      });

      const totalDuration = Date.now() - started;
      await persistTrace(serviceId, requestId, totalDuration, "ok", spans);
      await sql`
        INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
        VALUES (
          ${serviceId},
          'info',
          ${`checkout ok cart=${cartId} duration_ms=${totalDuration} sha=${rt.sha.slice(0, 12)}`},
          ${jsonb({ requestId, cartId, sha: rt.sha, scenario })},
          NOW()
        )
      `;
      return {
        ok: true,
        status: 200,
        durationMs: totalDuration,
        requestId,
        body: {
          ...result,
          durationMs: totalDuration,
          requestId,
          deploySha,
          scenario,
        },
      };
    }

    // Fallback inferred timings when jiti cannot load the module
    if (scenario === "error_spike" && Math.random() < 0.7) {
      throw new Error(
        "TypeError: Cannot read properties of null (reading 'meta')",
      );
    }

    const nPlusOne = scenario === "n_plus_one";
    for (const item of items) {
      const ms = nPlusOne ? 700 + Math.random() * 100 : 8 + Math.random() * 4;
      await sleep(ms);
      spans.push({
        name: "catalog.lookup",
        durationMs: Math.round(ms),
        status: "ok",
        attrs: { productId: item.productId, nPlusOne },
      });
      await sql`
        INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
        VALUES (${serviceId}, 'catalog.lookup', ${Math.round(ms)}, 1, NOW())
      `;
    }

    const slowPay = scenario === "payment_timeout";
    const payMs = slowPay
      ? 1600 + Math.random() * 400
      : 40 + Math.random() * 20;
    await sleep(payMs);
    spans.push({
      name: "payments.charge",
      durationMs: Math.round(payMs),
      status: "ok",
      attrs: { slow: slowPay },
    });

    const durationMs = Date.now() - started;
    const totalCents = items.reduce((s, i) => s + 2000 * i.qty, 0);
    await persistTrace(serviceId, requestId, durationMs, "ok", spans);
    await sql`
      INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
      VALUES (
        ${serviceId},
        'info',
        ${`checkout ok cart=${cartId} duration_ms=${durationMs}`},
        ${jsonb({ requestId, cartId, scenario, deploySha })},
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
        paymentId: `pay_${Date.now()}`,
        durationMs,
        requestId,
        deploySha,
        scenario,
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
    await persistTrace(serviceId, requestId, durationMs, "error", spans);
    await sql`
      INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
      VALUES (
        ${serviceId},
        'error',
        ${message},
        ${jsonb({ requestId, scenario, deploySha })},
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
            deploy_sha = ${deploySha}
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
          ${deploySha}
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
        scenario,
        deploySha,
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
}
