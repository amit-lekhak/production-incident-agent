import { createHash } from "node:crypto";
import { sql } from "@/lib/db";
import { getServiceId } from "./faults";
import {
  getDeployedRuntime,
  syncRuntimeFromCurrentDeploy,
  type CheckoutSpan,
} from "./deployed-runtime";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function fingerprintError(message: string): string {
  const normalized = message
    .replace(/\b[0-9a-f]{8,}\b/gi, "HEX")
    .replace(/\d+/g, "N")
    .slice(0, 160);
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
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
  /** Honest spans from the request — used by ticker; not returned to clients. */
  spans: CheckoutSpan[];
};

const PRODUCTS = ["sku_mug", "sku_tee", "sku_hat"] as const;

async function loadFeatureFlags(
  serviceId: number,
): Promise<{ payments_v2: boolean }> {
  const rows = await sql<{ key: string; enabled: boolean }[]>`
    SELECT key, enabled FROM feature_flags WHERE service_id = ${serviceId}
  `;
  const map = new Map(rows.map((r) => [r.key, r.enabled]));
  return { payments_v2: map.get("payments_v2") ?? false };
}

export async function runCheckout(
  input: CheckoutBody = {},
): Promise<CheckoutResult> {
  const serviceId = await getServiceId();
  let rt = getDeployedRuntime();
  if (!rt) {
    rt = await syncRuntimeFromCurrentDeploy();
  }
  const deploySha = rt?.sha && rt.sha !== "local-workspace" ? rt.sha : null;
  const poolSize = rt?.poolSize ?? 10;
  const flags = await loadFeatureFlags(serviceId);

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
  // Realistic traffic mix: ~25% of requests omit cart meta (hits null-deref bugs).
  const meta =
    input.meta !== undefined
      ? input.meta
      : Math.random() < 0.25
        ? null
        : { source: "web" };

  const spans: CheckoutSpan[] = [];

  try {
    // Pool wait modeled from deployed pool config (not chaos labels).
    if (poolSize <= 2) {
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

    if (rt?.module?.checkout) {
      rt.takeSpans(); // clear any stale spans
      const result = await rt.module.checkout({
        cartId,
        items,
        paymentMethod,
        meta,
        flags,
      });
      const moduleSpans = rt.takeSpans();
      spans.push(...moduleSpans);

      for (const s of moduleSpans) {
        if (s.name === "catalog.lookup") {
          await sql`
            INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
            VALUES (${serviceId}, 'catalog.lookup', ${s.durationMs}, 1, NOW())
          `;
        }
      }

      const totalDuration = Date.now() - started;
      await persistTrace(serviceId, requestId, totalDuration, "ok", spans);
      await sql`
        INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
        VALUES (
          ${serviceId},
          'info',
          ${`checkout ok cart=${cartId} duration_ms=${totalDuration} sha=${(rt.sha ?? "local").slice(0, 12)}`},
          ${jsonb({ requestId, cartId, sha: rt.sha })},
          NOW()
        )
      `;
      return {
        ok: true,
        status: 200,
        durationMs: totalDuration,
        requestId,
        spans,
        body: {
          ...result,
          durationMs: totalDuration,
          requestId,
          deploySha,
        },
      };
    }

    // Fallback when jiti cannot load the module — timings from poolSize + source heuristics.
    let checkoutSrc = "";
    if (rt) {
      try {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        checkoutSrc = readFileSync(join(rt.workDir, "src/checkout.ts"), "utf8");
      } catch {
        checkoutSrc = "";
      }
    }
    const nPlusOne = checkoutSrc.includes("lookupProductNPlusOne");
    const slowPay =
      checkoutSrc.includes("chargePaymentSlow") && flags.payments_v2;
    const nullMetaBug =
      /meta!\.source/.test(checkoutSrc) ||
      checkoutSrc.includes("req.meta!.source");

    if (nullMetaBug && meta == null) {
      throw new Error(
        "TypeError: Cannot read properties of null (reading 'source')",
      );
    }

    for (const item of items) {
      const ms = nPlusOne ? 700 + Math.random() * 100 : 8 + Math.random() * 4;
      await sleep(ms);
      const span: CheckoutSpan = {
        name: "catalog.lookup",
        durationMs: Math.round(ms),
        status: "ok",
        attrs: { productId: item.productId, nPlusOne },
      };
      spans.push(span);
      await sql`
        INSERT INTO db_timings (service_id, query_name, duration_ms, rows, sampled_at)
        VALUES (${serviceId}, 'catalog.lookup', ${Math.round(ms)}, 1, NOW())
      `;
    }

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
        ${jsonb({ requestId, cartId, deploySha })},
        NOW()
      )
    `;
    return {
      ok: true,
      status: 200,
      durationMs,
      requestId,
      spans,
      body: {
        orderId: `ord_${cartId}`,
        totalCents,
        paymentId: `pay_${Date.now()}`,
        durationMs,
        requestId,
        deploySha,
      },
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    if (rt?.module?.checkout) {
      spans.push(...rt.takeSpans());
    }
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
        ${jsonb({ requestId, deploySha })},
        NOW()
      )
    `;
    const fp = fingerprintError(message);
    const title = message.slice(0, 120);
    const [existingErr] = await sql<{ id: number }[]>`
      SELECT id FROM error_events
      WHERE service_id = ${serviceId} AND fingerprint = ${fp}
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
          ${fp},
          ${title},
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
      spans,
      body: {
        error: message,
        requestId,
        durationMs,
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
  spans: CheckoutSpan[],
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
