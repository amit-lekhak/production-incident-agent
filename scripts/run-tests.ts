/**
 * Run the test suite against relay_incident_test — never the workable app DB.
 * Creates / migrates / seeds the test DB when needed, then spawns tsx --test.
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const DEFAULT_TEST_URL = "postgres://localhost:5432/relay_incident_test";
const TEST_FILES = [
  "src/lib/agent/provider-errors.test.ts",
  "src/lib/agent/pipeline.test.ts",
  "src/lib/agent/actions.test.ts",
  "src/lib/sim/watcher.test.ts",
  "src/lib/codegraph/query.test.ts",
  "evals/oracle.test.ts",
];

function dbNameFromUrl(url: string): string {
  return url.split("/").pop()?.split("?")[0] ?? "relay_incident_test";
}

function adminUrl(url: string): string {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

async function ensureDatabase(testUrl: string) {
  const name = dbNameFromUrl(testUrl);
  const admin = postgres(adminUrl(testUrl), { max: 1 });
  try {
    const rows = await admin<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_database WHERE datname = ${name}
      ) AS exists
    `;
    if (!rows[0]?.exists) {
      // CREATE DATABASE cannot use a parameter; name is from our URL only.
      await admin.unsafe(`CREATE DATABASE "${name.replace(/"/g, "")}"`);
      console.log(`[run-tests] created database ${name}`);
    } else {
      console.log(`[run-tests] database ${name} exists`);
    }
  } finally {
    await admin.end({ timeout: 1 });
  }
}

async function needsSeed(testUrl: string): Promise<boolean> {
  const sql = postgres(testUrl, { max: 1 });
  try {
    const tables = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'services'
      ) AS exists
    `;
    if (!tables[0]?.exists) return true;
    const [svc] = await sql<{ id: number }[]>`
      SELECT id FROM services WHERE slug = 'relay-checkout' LIMIT 1
    `;
    return !svc;
  } catch {
    return true;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): number {
  const result = spawnSync(cmd, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });
  return result.status ?? 1;
}

async function main() {
  const testUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_URL;
  const name = dbNameFromUrl(testUrl);
  if (name === "relay_incident") {
    console.error(
      "[run-tests] refusing to use workable DB name relay_incident as TEST_DATABASE_URL",
    );
    process.exit(1);
  }

  console.log(`[run-tests] TEST_DATABASE_URL → ${name}`);
  await ensureDatabase(testUrl);

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: testUrl,
  };

  const migrateStatus = run(
    "pnpm",
    ["exec", "tsx", "scripts/db-migrate.ts"],
    childEnv,
  );
  if (migrateStatus !== 0) process.exit(migrateStatus);

  if (await needsSeed(testUrl)) {
    console.log(`[run-tests] seeding ${name}`);
    const seedStatus = run(
      "pnpm",
      ["exec", "tsx", "scripts/seed.ts"],
      childEnv,
    );
    if (seedStatus !== 0) process.exit(seedStatus);
  } else {
    console.log(`[run-tests] ${name} already seeded`);
  }

  const status = run(
    "pnpm",
    ["exec", "tsx", "--test", ...TEST_FILES],
    childEnv,
  );
  process.exit(status);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
