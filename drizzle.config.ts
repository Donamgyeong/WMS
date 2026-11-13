import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
config({ path: ".env.local" });
config({ path: ".env" });
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
});
