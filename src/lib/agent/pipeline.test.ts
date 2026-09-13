import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import "../load-env";
import { sql } from "../db";
import {
  DiagnosisConflictError,
  runDiagnosisPipeline,
} from "../agent/pipeline";
import { getServiceId } from "../sim/faults";
import {
  installLocalRelease,
  uninstallLocalRelease,
} from "../../../evals/local-release";
import type { LocalReleaseProvider } from "../release";

let provider: LocalReleaseProvider;

async function seedIncident(status: string) {
  const serviceId = await getServiceId();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO incidents (
      service_id, title, status, severity, opened_at, updated_at
    )
    VALUES (
      ${serviceId},
      ${`test-${status}-${Date.now()}`},
      ${status},
      'high',
      NOW(),
      NOW()
    )
    RETURNING id::text AS id
  `;
  return row!.id;
}

describe("diagnosis pipeline status guards", () => {
  before(async () => {
    provider = await installLocalRelease();
  });
  after(() => {
    uninstallLocalRelease(provider);
  });

  it("refuses acting and resolved", async () => {
    for (const status of ["acting", "resolved", "verifying"] as const) {
      const id = await seedIncident(status);
      await assert.rejects(
        () => runDiagnosisPipeline(id, { forceOracle: true }),
        (err: unknown) => {
          assert.ok(err instanceof DiagnosisConflictError);
          assert.equal(err.status, status);
          return true;
        },
      );
    }
  });

  it("claims detected and reaches awaiting_review", async () => {
    const id = await seedIncident("detected");
    const result = await runDiagnosisPipeline(id, { forceOracle: true });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.status, "awaiting_review");
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM incidents WHERE id = ${id}::uuid
    `;
    assert.equal(row?.status, "awaiting_review");
    const [review] = await sql<{ decision: string }[]>`
      SELECT decision FROM reviews
      WHERE incident_id = ${id}::uuid
      ORDER BY created_at DESC LIMIT 1
    `;
    assert.equal(review?.decision, "pending");
  });
});

describe("review claim idempotency", () => {
  before(async () => {
    provider = await installLocalRelease();
  });
  after(() => {
    uninstallLocalRelease(provider);
  });

  it("second claim of pending review fails", async () => {
    const id = await seedIncident("detected");
    await runDiagnosisPipeline(id, { forceOracle: true });

    const claim = async () => {
      const [claimed] = await sql<{ id: number }[]>`
        UPDATE reviews
        SET decision = 'approved', decided_at = NOW(), reviewer = 'test'
        WHERE id = (
          SELECT id FROM reviews
          WHERE incident_id = ${id}::uuid AND decision = 'pending'
          ORDER BY created_at DESC
          LIMIT 1
        )
        AND decision = 'pending'
        RETURNING id
      `;
      return claimed;
    };

    const first = await claim();
    assert.ok(first?.id);
    const second = await claim();
    assert.equal(second, undefined);
  });
});
