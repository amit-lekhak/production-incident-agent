import assert from "node:assert/strict";
import { describe, it } from "node:test";
import "../load-env";
import { sql } from "../db";
import { executeApprovedAction } from "./actions";
import { getServiceId } from "../sim/faults";

async function setupRollbackIncident(actionTarget: string) {
  const serviceId = await getServiceId();
  const [incident] = await sql<{ id: string }[]>`
    INSERT INTO incidents (
      service_id, title, status, severity, opened_at, updated_at
    )
    VALUES (
      ${serviceId},
      ${`rollback-test-${Date.now()}`},
      'awaiting_review',
      'high',
      NOW(),
      NOW()
    )
    RETURNING id::text AS id
  `;
  await sql`
    INSERT INTO recommendations (
      incident_id, confidence, evidence, recommended_action, action_target, summary
    )
    VALUES (
      ${incident!.id}::uuid,
      80,
      '[]'::jsonb,
      'rollback',
      ${actionTarget},
      'test rollback'
    )
  `;
  return { incidentId: incident!.id, serviceId };
}

describe("rollback restore", () => {
  it("restores previous SHA, not the rolled-back deploy", async () => {
    const serviceId = await getServiceId();
    const [active] = await sql<{ sha: string }[]>`
      SELECT sha FROM deployments
      WHERE service_id = ${serviceId} AND status = 'active'
      ORDER BY deployed_at DESC LIMIT 1
    `;
    assert.ok(active?.sha);

    const [prev] = await sql<{ sha: string }[]>`
      SELECT sha FROM deployments
      WHERE service_id = ${serviceId} AND sha <> ${active.sha}
      ORDER BY deployed_at DESC LIMIT 1
    `;
    assert.ok(prev?.sha, "seed must include a prior deploy");

    const { incidentId } = await setupRollbackIncident(active.sha);
    const out = await executeApprovedAction(incidentId);
    assert.equal(out.ok, true);
    if (!out.ok) return;

    assert.equal(out.result.previousSha, active.sha);
    assert.equal(out.result.restoredSha, prev.sha);

    const [nowActive] = await sql<{ sha: string; status: string }[]>`
      SELECT sha, status FROM deployments
      WHERE service_id = ${serviceId} AND status = 'active'
      LIMIT 1
    `;
    assert.equal(nowActive?.sha, prev.sha);

    const [rolled] = await sql<{ status: string }[]>`
      SELECT status FROM deployments WHERE sha = ${active.sha}
    `;
    assert.equal(rolled?.status, "rolled_back");

    // re-activate original for other tests
    await sql`
      UPDATE deployments SET status = 'rolled_back', rolled_back_at = NOW()
      WHERE sha = ${prev.sha}
    `;
    await sql`
      UPDATE deployments SET status = 'active', rolled_back_at = NULL, deployed_at = NOW()
      WHERE sha = ${active.sha}
    `;
  });

  it("fails to needs_human when action_target mismatches active SHA", async () => {
    const { incidentId, serviceId } =
      await setupRollbackIncident("deadbeef0000");
    const [before] = await sql<{ sha: string }[]>`
      SELECT sha FROM deployments
      WHERE service_id = ${serviceId} AND status = 'active'
      LIMIT 1
    `;
    const out = await executeApprovedAction(incidentId);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.match(out.error, /does not match active deploy/);

    const [after] = await sql<{ sha: string }[]>`
      SELECT sha FROM deployments
      WHERE service_id = ${serviceId} AND status = 'active'
      LIMIT 1
    `;
    assert.equal(after?.sha, before?.sha);

    const [incident] = await sql<{ status: string }[]>`
      SELECT status FROM incidents WHERE id = ${incidentId}::uuid
    `;
    assert.equal(incident?.status, "needs_human");
  });
});
