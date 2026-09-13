import { sql } from "@/lib/db";
import { getReleaseProvider } from "@/lib/release";
import {
  activateFromFiles,
  syncRuntimeFromCurrentDeploy,
} from "./deployed-runtime";
import { loadHealthyServiceFilesSafe, loadScenarioPatchSafe } from "./patches";
import { SCENARIO_META, type ActiveFault, type FaultScenario } from "./types";

function jsonb(value: unknown) {
  return sql`${JSON.stringify(value)}::jsonb`;
}

export async function getServiceId(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    SELECT id FROM services WHERE slug = 'relay-checkout' LIMIT 1
  `;
  if (!row)
    throw new Error("Relay Checkout service missing — run pnpm db:seed");
  return row.id;
}

export async function getActiveFault(
  serviceId: number,
): Promise<ActiveFault | null> {
  const [row] = await sql<
    {
      scenario: string;
      deploy_sha: string | null;
      config: Record<string, unknown>;
    }[]
  >`
    SELECT scenario, deploy_sha, config
    FROM active_faults
    WHERE service_id = ${serviceId} AND active = true
    ORDER BY injected_at DESC
    LIMIT 1
  `;
  if (!row) return null;
  return {
    scenario: row.scenario as FaultScenario,
    deploySha: row.deploy_sha ?? "",
    config: row.config ?? {},
  };
}

/**
 * Chaos: apply a real patch under services/relay-checkout, commit+push,
 * create a GitHub production deployment, and activate that SHA locally.
 */
export async function injectFault(scenario: FaultScenario) {
  const serviceId = await getServiceId();
  const meta = SCENARIO_META[scenario];
  const provider = getReleaseProvider();
  // Reset to healthy service files first so scenarios do not stack.
  const healthy = await loadHealthyServiceFilesSafe();
  const patch = await loadScenarioPatchSafe(scenario);
  const byPath = new Map(healthy.map((f) => [f.path, f]));
  for (const f of patch) byPath.set(f.path, f);
  const files = [...byPath.values()];

  const { sha } = await provider.commitAndPush({
    message: meta.commitMessage,
    files,
  });

  const deploy = await provider.createDeployment(sha, meta.summary);
  await activateFromFiles(deploy.sha, files);

  await sql`
    UPDATE active_faults
    SET active = false, cleared_at = NOW()
    WHERE service_id = ${serviceId} AND active = true
  `;

  // Drop recent samples so watcher window reflects the new release quickly
  await sql`
    DELETE FROM metric_samples
    WHERE service_id = ${serviceId}
      AND sampled_at >= NOW() - INTERVAL '5 minutes'
  `;

  if (meta.flag) {
    await sql`
      UPDATE feature_flags SET enabled = true
      WHERE service_id = ${serviceId} AND key = ${meta.flag}
    `;
  }

  const [fault] = await sql<{ id: number }[]>`
    INSERT INTO active_faults (service_id, scenario, deploy_sha, config, active)
    VALUES (${serviceId}, ${scenario}, ${deploy.sha}, ${jsonb({ version: meta.version })}, true)
    RETURNING id
  `;

  await sql`
    INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
    VALUES (
      ${serviceId},
      'warn',
      ${`Deploy marked live sha=${deploy.sha.slice(0, 12)} (${meta.summary})`},
      ${jsonb({ deploySha: deploy.sha, version: meta.version })},
      NOW()
    )
  `;

  return {
    serviceId,
    faultId: fault!.id,
    deploySha: deploy.sha,
    version: meta.version,
    summary: meta.summary,
    scenario,
  };
}

/** Clear chaos bookkeeping and re-sync runtime from current production deploy. */
export async function clearFaults() {
  const serviceId = await getServiceId();
  await sql`
    UPDATE active_faults
    SET active = false, cleared_at = NOW()
    WHERE service_id = ${serviceId} AND active = true
  `;
  await sql`
    INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
    VALUES (${serviceId}, 'info', 'Chaos faults cleared', ${jsonb({})}, NOW())
  `;
  await syncRuntimeFromCurrentDeploy();
  return { serviceId };
}
