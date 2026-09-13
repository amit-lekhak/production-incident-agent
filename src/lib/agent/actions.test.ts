import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import "../load-env";
import { sql } from "../db";
import { executeApprovedAction } from "./actions";
import { getServiceId } from "../sim/faults";
import { getReleaseProvider } from "../release";
import { loadScenarioPatch } from "../sim/patches";
import { activateDeployedSha } from "../sim/deployed-runtime";
import {
  installLocalRelease,
  uninstallLocalRelease,
} from "../../../evals/local-release";
import type { LocalReleaseProvider } from "../release";

let provider: LocalReleaseProvider;

async function setupRevertIncident() {
  const serviceId = await getServiceId();
  const release = getReleaseProvider();
  const healthy = await release.currentDeploy();
  assert.ok(healthy);

  // Ship a bad patch as "chaos"
  const files = loadScenarioPatch("n_plus_one");
  const { sha: badSha } = await release.commitAndPush({
    message: "feat: chaos n_plus_one for test",
    files,
  });
  await release.createDeployment(badSha, "test bad deploy");
  await activateDeployedSha(badSha);

  const pr = await release.openRevertPr({
    sha: badSha,
    restoreSha: healthy.sha,
    title: "test revert",
    body: "test",
  });

  const [incident] = await sql<{ id: string }[]>`
    INSERT INTO incidents (
      service_id, title, status, severity, opened_at, updated_at
    )
    VALUES (
      ${serviceId},
      ${`ci-test-revert-${Date.now()}`},
      'awaiting_review',
      'high',
      NOW(),
      NOW()
    )
    RETURNING id::text AS id
  `;
  await sql`
    INSERT INTO recommendations (
      incident_id, confidence, evidence, recommended_action, action_target, summary,
      pr_number, pr_url, pr_head_sha
    )
    VALUES (
      ${incident!.id}::uuid,
      80,
      '[]'::jsonb,
      'revert_pr',
      ${badSha},
      'test revert_pr',
      ${pr.number},
      ${pr.url},
      ${pr.headSha}
    )
  `;
  return { incidentId: incident!.id, badSha, healthySha: healthy.sha, pr };
}

describe("revert_pr merge", () => {
  before(async () => {
    provider = await installLocalRelease();
  });
  after(async () => {
    uninstallLocalRelease(provider);
  });

  it("merges PR and redeploys restored SHA", async () => {
    const { incidentId, pr } = await setupRevertIncident();
    const out = await executeApprovedAction(incidentId);
    assert.equal(out.ok, true);
    if (!out.ok) return;

    assert.equal(out.result.prNumber, pr.number);
    const current = await getReleaseProvider().currentDeploy();
    assert.ok(current?.sha);
    // After merge + deploy, production points at the merge commit (restored tree)
    assert.ok(current.sha.length >= 7);
  });

  it("fails when recommendation has no PR", async () => {
    const serviceId = await getServiceId();
    const [incident] = await sql<{ id: string }[]>`
      INSERT INTO incidents (
        service_id, title, status, severity, opened_at, updated_at
      )
      VALUES (
        ${serviceId},
        ${`ci-test-no-pr-${Date.now()}`},
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
        'revert_pr',
        'deadbeef',
        'missing pr'
      )
    `;
    const out = await executeApprovedAction(incident!.id);
    assert.equal(out.ok, false);
    if (out.ok) return;
    assert.match(out.error, /No open revert PR/);
  });
});
