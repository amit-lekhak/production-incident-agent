/**
 * Force evals onto the isolated test DB — never the workable app DB.
 * Must load before any module that reads DATABASE_URL / opens a pool.
 */
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });

const DEFAULT_TEST_URL = "postgres://localhost:5432/relay_incident_test";
const testUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_URL;
const name = testUrl.split("/").pop()?.split("?")[0] ?? "relay_incident_test";

if (name === "relay_incident") {
  throw new Error(
    "[evals] refusing to use workable DB name relay_incident as TEST_DATABASE_URL",
  );
}

process.env.DATABASE_URL = testUrl;
console.log(`[evals] DATABASE_URL → ${name}`);
