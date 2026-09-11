import "../src/lib/load-env";
import { sql } from "../src/lib/db";

async function main() {
  const url =
    process.env.DATABASE_URL ?? "postgres://localhost:5432/relay_incident";
  const dbName = url.split("/").pop()?.split("?")[0] ?? "relay_incident";
  console.log(`Using database ${dbName}`);
  await sql`SELECT 1`;
  console.log("Database reachable");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
