/**
 * Run drizzle migrations, stamping the baseline when the schema already exists
 * from an earlier `db:push` (empty __drizzle_migrations, tables present).
 */
import "../src/lib/load-env";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
import { getEnv } from "../src/lib/env";

type Journal = {
  entries: Array<{ tag: string; when: number; breakpoints: boolean }>;
};

async function tableExists(sql: postgres.Sql, name: string): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${name}
    ) AS exists
  `;
  return Boolean(row?.exists);
}

async function columnExists(
  sql: postgres.Sql,
  table: string,
  column: string,
): Promise<boolean> {
  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
    ) AS exists
  `;
  return Boolean(row?.exists);
}

async function stampIfPushed(sql: postgres.Sql) {
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const applied = await sql<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at::text FROM drizzle.__drizzle_migrations
  `;
  const appliedWhens = new Set(applied.map((r) => Number(r.created_at)));

  const journal = JSON.parse(
    readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
  ) as Journal;

  const hasServices = await tableExists(sql, "services");
  if (!hasServices) {
    // Fresh DB — let drizzle-kit create everything from 0000.
    return;
  }

  const hasCommits = await tableExists(sql, "commits");
  const hasDeployments = await tableExists(sql, "deployments");
  const hasPrCol = await columnExists(sql, "recommendations", "pr_number");

  const alreadyReflected: Record<string, boolean> = {
    "0000_init": true,
    "0001_pr_columns": hasPrCol,
    "0002_drop_git_tables": !hasCommits && !hasDeployments,
  };

  for (const entry of journal.entries) {
    if (appliedWhens.has(entry.when)) continue;
    if (!alreadyReflected[entry.tag]) continue;
    const file = join(process.cwd(), "drizzle", `${entry.tag}.sql`);
    const query = readFileSync(file, "utf8");
    const hash = createHash("sha256").update(query).digest("hex");
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${hash}, ${entry.when})
    `;
    console.log(`Stamped ${entry.tag} (schema already matched from db:push)`);
  }
}

async function main() {
  const env = getEnv();
  const dbName =
    env.DATABASE_URL.split("/").pop()?.split("?")[0] ?? "relay_incident";
  console.log(`Using database ${dbName}`);
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  try {
    await sql`SELECT 1`;
    console.log("Database reachable");
    await stampIfPushed(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }

  const result = spawnSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
