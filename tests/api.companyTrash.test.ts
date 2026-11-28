import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// Company delete = Trash (restorable for 30 days), then permanent delete of everything belonging to it.
describe.skipIf(!DB_READY)("Company Trash: delete, restore, permanent delete (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  const tag = uniq();
  const rows = async (q: any) => (await db.execute(q)) as any[];
  const make = async (prefix: string) => {
    const r = await call("POST", "/api/companies", {
      code: `${prefix}${tag}`, name: `ZZ Trash ${prefix}${tag}`, businessType: "OTHER", fiscalYearCode: "2083/084",
      startDate: "2026-07-17", endDate: "2027-07-16", setup: "DEFAULT",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as number;
  };
  const inContext = async (id: number) => ((await call("GET", "/api/context")).body.companies as any[]).some((c) => c.id === id);
  const left = async (id: number) => Number((await rows(sql`
    select (select count(*) from "Company" where id = ${id}) + (select count(*) from "Branch" where "companyId" = ${id})
      + (select count(*) from "AccountGroup" where "companyId" = ${id}) + (select count(*) from "GeneralLedger" where "companyId" = ${id})
      + (select count(*) from "GeneralLedgerSetup" where "companyId" = ${id}) + (select count(*) from "FiscalYear" where "companyId" = ${id})
      + (select count(*) from "AuditLog" where "companyId" = ${id}) as n`))[0].n);
  const del = (id: number) => call("DELETE", `/api/masters/companies/${id}`);
  const purge = (id: number, confirmCode: string) => call("DELETE", `/api/companies/${id}/permanent`, { confirmCode });

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
  });
  afterAll(async () => { await close(); });

  it("delete only hides the company; restore brings it back with its data", async () => {
    const id = await make("ZT");
    const before = await left(id);
    expect((await del(id)).status).toBe(200); // linked branches and ledgers no longer block it
    expect(await inContext(id)).toBe(false);
    expect(await left(id)).toBe(before);
    expect((await call("GET", `/api/masters/general-ledgers?companyId=${id}`)).status).toBe(409);
    expect(((await call("GET", "/api/masters/companies")).body as any[]).some((c) => c.id === id)).toBe(false);
    const entry = ((await call("GET", "/api/companies/trash")).body as any[]).find((c) => c.id === id);
    expect(entry.daysLeft).toBe(30);

    expect((await call("POST", `/api/companies/${id}/restore`)).status).toBe(200);
    expect(await inContext(id)).toBe(true);
    await del(id);
    expect((await purge(id, `ZT${tag}`)).status).toBe(200);
  });

  it("permanent delete needs the Trash and the typed code, then leaves nothing behind", async () => {
    const id = await make("ZP");
    expect((await purge(id, `ZP${tag}`)).status).toBe(409); // not in the Trash
    await del(id);
    expect((await purge(id, "WRONG")).status).toBe(400);
    expect(await left(id)).toBeGreaterThan(0);
    const r = await purge(id, `ZP${tag}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await left(id)).toBe(0);
    // the guards switched off during the purge are on again
    expect(await rows(sql`select 1 from pg_trigger where not tgisinternal and tgenabled = 'D'`)).toEqual([]);
  });

  it("after 30 days it cannot be restored and is erased automatically; younger ones are kept", async () => {
    const old = await make("ZO");
    const fresh = await make("ZF");
    await del(old);
    await del(fresh);
    await db.execute(sql`update "Company" set "deletedAt" = now() - interval '31 days' where id = ${old}`);
    expect((await call("POST", `/api/companies/${old}/restore`)).status).toBe(409);
    const { purgeExpiredCompanies } = await import("../server/services/companyTrash");
    expect(await purgeExpiredCompanies()).toEqual([`ZO${tag}`]);
    expect(await left(old)).toBe(0);
    expect(await left(fresh)).toBeGreaterThan(0);
    await purge(fresh, `ZF${tag}`);
  });
});
