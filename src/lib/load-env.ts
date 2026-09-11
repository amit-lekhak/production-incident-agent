import { resolve } from "node:path";
import { config } from "dotenv";

// CLI scripts (tsx / drizzle-kit) do not load .env.local the way Next.js does.
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
config({ path: resolve(process.cwd(), ".env"), quiet: true });
