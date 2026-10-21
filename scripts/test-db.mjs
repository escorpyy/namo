// One command to run the whole test suite against a throw-away local test database:  pnpm test:db
// It (re)creates the schema from the committed migrations, seeds demo data, then runs vitest. Works on Windows/macOS/Linux.
// SAFETY: refuses anything that is not a local database whose name contains "test".
import postgres from "postgres";
import { spawnSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/namoerp_test";
const u = new URL(url);
const name = u.pathname.slice(1);
if (!/test/i.test(name) || !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) {
  console.error(`Refusing to run: "${name}" on "${u.hostname}" is not a local database with "test" in its name.`);
  process.exit(1);
}

const admin = new URL(url);
admin.pathname = "/postgres";
try {
  const a = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  const found = await a`select 1 from pg_database where datname = ${name}`;
  if (!found.length) {
    await a.unsafe(`create database "${name}"`);
    console.log(`Created database ${name}`);
  }
  await a.end();
  const t = postgres(url, { max: 1, onnotice: () => {} });
  // Clean slate (test DB only). "drizzle" holds the migration history and "namo" holds our DB-level integrity helpers:
  // both must be dropped too, otherwise a second run believes the migrations are already applied to an empty database.
  await t.unsafe("drop schema if exists drizzle cascade; drop schema if exists namo cascade; drop schema public cascade; create schema public;");
  await t.end();
} catch (e) {
  console.error(`Could not reach Postgres at ${u.host}. Is it running? (docker compose up -d)\n${e.message}`);
  process.exit(1);
}

// Pin every URL variable so nothing (e.g. DATABASE_URL_DIRECT from .env) can point these steps at another database.
const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_DIRECT: url, TEST_DATABASE_URL: url };
const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("pnpm db:migrate"); // real migrations, so triggers/constraints are exercised exactly as in production
run("pnpm db:seed");
run("pnpm exec vitest run");
