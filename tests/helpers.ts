// Integration-test helpers. These tests WRITE to the database, so they refuse to run unless the target is clearly a
// local test database (name contains "test"). Set TEST_DATABASE_URL (preferred) or DATABASE_URL.
import "dotenv/config";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
let reason = "";
if (!url) reason = "set TEST_DATABASE_URL (or DATABASE_URL) to a local database whose name contains 'test'";
else {
  try {
    const u = new URL(url);
    const dbName = u.pathname.slice(1);
    if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== "1") reason = `database "${dbName}" is not a test database (its name must contain "test")`;
    else if (!/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && process.env.ALLOW_REMOTE_TEST_DB !== "1") reason = `host "${u.hostname}" is not local`;
  } catch {
    reason = "database URL is not valid";
  }
}

export const DB_READY = reason === "";
if (!DB_READY) {
  // In CI a missing/unsafe DB must FAIL loudly, never silently skip.
  if (process.env.CI) throw new Error(`DB integration tests cannot run in CI: ${reason}`);
  console.warn(`\n[tests] Skipping DB integration tests: ${reason}\n`);
} else process.env.DATABASE_URL = url;

export type Res = { status: number; body: any };

export async function startApi() {
  const { app } = await import("../server/app");
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown): Promise<Res> => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: r.status, body: json };
  };
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { call, close };
}

// The seeded demo company / head-office branch / open fiscal year.
export async function seededContext(call: (m: string, p: string, b?: unknown) => Promise<Res>) {
  const ctx = (await call("GET", "/api/context")).body;
  const company = ctx.companies[0];
  const branch = company.branches.find((b: any) => b.isHeadOffice) ?? company.branches[0];
  const fy = company.fiscalYears.find((f: any) => f.isCurrent) ?? company.fiscalYears[0];
  return { companyId: company.id as number, branchId: branch.id as number, fyId: fy.id as number };
}

export const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();
