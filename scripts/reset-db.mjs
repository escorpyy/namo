// One command to wipe the LOCAL development database and rebuild it from scratch:  pnpm db:reset
// It drops everything, re-creates the schema from the committed migrations, then loads the seed data (company, users, ledgers, products, terms).
// Use it to start testing from a clean slate. Everything you entered by hand is lost, so put anything you want to keep in server/db/seed.ts.
// SAFETY: refuses any database that is not on this computer (localhost / 127.0.0.1), and asks you to type the database name first.
// For scripts, pass the name instead of being asked:  pnpm db:reset --confirm <database name>
import "dotenv/config";
import postgres from "postgres";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const url = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL; // "||": an empty DATABASE_URL_DIRECT= line in .env counts as not set
if (!url) {
  console.error("No DATABASE_URL is set (see .env.example). Nothing was changed.");
  process.exit(1);
}
const u = new URL(url);
const name = decodeURIComponent(u.pathname.slice(1));
if (!name || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) {
  console.error(`Refusing to run: "${name}" on "${u.hostname}" is not a database on this computer. db:reset only works on localhost. Nothing was changed.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const at = args.indexOf("--confirm");
let typed = at >= 0 ? args[at + 1] : undefined;
if (typed === undefined) {
  if (!process.stdin.isTTY) {
    console.error("This is not an interactive terminal. Pass the database name to confirm:  pnpm db:reset --confirm <database name>. Nothing was changed.");
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  typed = (await rl.question(`This ERASES everything in database "${name}" on ${u.host} and rebuilds it from the migrations and the seed.\nType the database name to continue: `)).trim();
  rl.close();
}
if (typed !== name) {
  console.error(`"${typed ?? ""}" is not "${name}". Nothing was changed.`);
  process.exit(1);
}

try {
  const db = postgres(url, { max: 1, onnotice: () => {} });
  // "drizzle" holds the migration history and "namo" holds our DB-level integrity helpers: both must go too, otherwise the next
  // migrate believes everything is already applied to an empty database.
  await db.unsafe("drop schema if exists drizzle cascade; drop schema if exists namo cascade; drop schema public cascade; create schema public;");
  await db.end();
} catch (e) {
  console.error(`Could not reset the database at ${u.host}. Is Postgres running? (docker compose up -d)\n${e.message}`);
  process.exit(1);
}

// Pin both URL variables so the steps below cannot be pointed at another database.
const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_DIRECT: url };
const run = (cmd) => {
  console.log(`\n> ${cmd}`);
  const r = spawnSync(cmd, { stdio: "inherit", shell: true, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run("pnpm db:migrate");
run("pnpm db:seed");
console.log(`\nDatabase "${name}" has been reset and seeded.`);
