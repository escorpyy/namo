// ONE-TIME helper for a database that was created earlier with `pnpm db:push` (tables exist, no migration history).
// It records the first migration (0000_baseline) as already applied WITHOUT running it, so `pnpm db:migrate`
// then applies only the newer ones. It changes no table data and no table structure.
//   pnpm db:baseline
// Refuses unless: the migration history is empty AND every table in 0000_baseline.sql already exists.
import "dotenv/config";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL set nahi hai.");
const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: isLocal ? false : "require" });
const fail = async (msg: string): Promise<never> => { console.error(msg); await sql.end(); process.exit(1); };

const [first] = readMigrationFiles({ migrationsFolder: "./drizzle" });
if (!first) await fail("No migrations found in ./drizzle.");

const expected = [...first.sql.join("\n").matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]);
const have = new Set((await sql`select table_name from information_schema.tables where table_schema = 'public'`).map((r) => r.table_name as string));
const missing = expected.filter((t) => !have.has(t));
if (have.size === 0) await fail("This database is empty. Just run: pnpm db:migrate");
if (missing.length) await fail(`Cannot baseline: ${missing.length} table(s) from the baseline are missing (${missing.slice(0, 5).join(", ")}...). Run pnpm db:push first, or start from an empty database with pnpm db:migrate.`);

await sql`create schema if not exists drizzle`;
await sql`create table if not exists drizzle."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)`;
const [{ n }] = await sql`select count(*)::int as n from drizzle."__drizzle_migrations"`;
if (n > 0) await fail("Migration history already exists; nothing to baseline. Run: pnpm db:migrate");

await sql`insert into drizzle."__drizzle_migrations" (hash, created_at) values (${first.hash}, ${first.folderMillis})`;
console.log(`Recorded ${expected.length}-table baseline as applied. Now run: pnpm db:migrate`);
await sql.end();
