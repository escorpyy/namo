// Applies the committed SQL migrations in ./drizzle (all pending ones, in ONE transaction: all or nothing).
//   pnpm db:migrate
// Uses DATABASE_URL_DIRECT if set (cloud: use the direct/session connection, not the transaction pooler), else DATABASE_URL.
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL set nahi hai. .env.example ko .env me copy karke bharo.");
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const client = postgres(url, { max: 1, onnotice: () => {}, ssl: isLocal ? false : "require" });

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} catch (e) {
  const cause = (e as { cause?: { message?: string } }).cause?.message; // the real Postgres message, not the echoed SQL
  console.error("Migration failed (nothing was changed):", cause ?? (e as Error).message);
  process.exitCode = 1;
} finally {
  await client.end();
}
