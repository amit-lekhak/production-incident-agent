import { sql } from "@/lib/db";
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

export async function injectFault(scenario: FaultScenario) {
  const serviceId = await getServiceId();
  const meta = SCENARIO_META[scenario];

  await sql`
    UPDATE active_faults
    SET active = false, cleared_at = NOW()
    WHERE service_id = ${serviceId} AND active = true
  `;

  await sql`
    UPDATE deployments SET status = 'rolled_back', rolled_back_at = NOW()
    WHERE service_id = ${serviceId} AND status = 'active'
  `;

  await sql`
    INSERT INTO deployments (service_id, sha, version, status, summary, deployed_at)
    VALUES (
      ${serviceId},
      ${meta.deploySha},
      ${meta.version},
      'active',
      ${meta.summary},
      NOW()
    )
    ON CONFLICT (sha) DO UPDATE
      SET status = 'active',
          deployed_at = NOW(),
          rolled_back_at = NULL,
          summary = EXCLUDED.summary,
          version = EXCLUDED.version
  `;

  if (meta.flag) {
    await sql`
      UPDATE feature_flags SET enabled = true
      WHERE service_id = ${serviceId} AND key = ${meta.flag}
    `;
  }

  const [fault] = await sql<{ id: number }[]>`
    INSERT INTO active_faults (service_id, scenario, deploy_sha, config, active)
    VALUES (${serviceId}, ${scenario}, ${meta.deploySha}, ${jsonb({})}, true)
    RETURNING id
  `;

  await sql`
    INSERT INTO log_lines (service_id, level, message, attrs, logged_at)
    VALUES (
      ${serviceId},
      'warn',
      ${`Chaos injected scenario=${scenario} deploy=${meta.deploySha}`},
      ${jsonb({ scenario, deploySha: meta.deploySha })},
      NOW()
    )
  `;

  return { serviceId, faultId: fault!.id, ...meta, scenario };
}

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
  return { serviceId };
}
