import "../src/lib/load-env";
import { getEnv } from "../src/lib/env";
import { sql } from "../src/lib/db";

async function main() {
  const env = getEnv();
  const dbName =
    env.DATABASE_URL.split("/").pop()?.split("?")[0] ?? "relay_incident";
  console.log(`Using database ${dbName}`);
  await sql`SELECT 1`;
  console.log("Database reachable");
  await sql.end({ timeout: 1 });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
