import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema/index.ts",
  out: "./drizzle",
  // Cloud pe migrations ke liye direct/session connection (port 5432) better hai
  dbCredentials: { url: (process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL)! },
});
