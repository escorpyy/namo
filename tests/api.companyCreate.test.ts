import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// POST /api/companies: a new company is created in ONE transaction, either with the default data (chart of accounts + GL Setup) or blank.
// The companies made here are real rows, so they are removed again at the end (their code starts with "ZC").
describe.skipIf(!DB_READY)("Create company: default data or blank (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  let userId = 0;
  const tag = uniq();
  const made: number[] = [];
  const body = (over: Record<string, unknown> = {}) => ({
    code: `ZC${tag}`, name: `ZZ Create Test ${tag}`, businessType: "PRIVATE_LIMITED", fiscalYearCode: "2083/084",
    startDate: "2026-07-17", endDate: "2027-07-16", setup: "DEFAULT", ...over,
  });
  const rows = async (q: any) => (await db.execute(q)) as any[];
  const count = async (table: string, companyId: number) => Number((await rows(sql`select count(*)::int n from ${sql.identifier(table)} where "companyId" = ${companyId}`))[0].n);

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    userId = Number((await rows(sql`select id from "User" order by id limit 1`))[0].id);
  });
  afterAll(async () => {
    for (const id of made) {
      for (const t of ["GeneralLedgerSetup", "GeneralLedger", "AccountSubGroup"]) {
        if (t === "AccountSubGroup") await db.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${id})`);
        else await db.execute(sql`delete from ${sql.identifier(t)} where "companyId" = ${id}`);
      }
      for (const t of ["AccountGroup", "UserCompanyAccess", "FiscalYear", "Branch", "Company"]) {
        await db.execute(sql`delete from ${sql.identifier(t)} where ${t === "Company" ? sql`id` : sql`"companyId"`} = ${id}`);
      }
    }
    await close();
  });

  it("with default data: company, Head Office, current fiscal year, Admin access, chart of accounts and every GL Setup role", async () => {
    const r = await call("POST", "/api/companies", body({ userId }));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ code: `ZC${tag}`, setup: "DEFAULT" });
    const id = r.body.id as number;
    made.push(id);

    const branches = await rows(sql`select code, "isHeadOffice" from "Branch" where "companyId" = ${id}`);
    expect(branches).toEqual([{ code: "HO", isHeadOffice: true }]);
    expect((await rows(sql`select code, "isCurrent" from "FiscalYear" where "companyId" = ${id}`))).toEqual([{ code: "2083/084", isCurrent: true }]);
    expect((await rows(sql`select role, "branchId" from "UserCompanyAccess" where "companyId" = ${id} and "userId" = ${userId}`))).toEqual([{ role: "ADMIN", branchId: null }]);

    expect(await count("AccountGroup", id)).toBe(13);
    expect(await count("GeneralLedger", id)).toBeGreaterThan(40);
    const setup = await rows(sql`select s.role, l.code from "GeneralLedgerSetup" s join "GeneralLedger" l on l.id = s."generalLedgerId" where s."companyId" = ${id}`);
    expect(setup).toHaveLength(12);
    expect(Object.fromEntries(setup.map((s) => [s.role, s.code]))).toMatchObject({ CASH_BOOK: "GL001", PROFIT_AND_LOSS: "GL019", SALES_ACCOUNT: "GL020", INPUT_VAT: "GL070" });
    // Year-end close needs the Profit and Loss ledger to be an Equity ledger.
    const pl = await rows(sql`select g.type from "GeneralLedger" l join "AccountGroup" g on g.id = l."accountGroupId" where l."companyId" = ${id} and l.code = 'GL019'`);
    expect(pl[0].type).toBe("EQUITY");
  });

  it("blank: only the company, Head Office, fiscal year and access; no accounts and no GL Setup", async () => {
    const r = await call("POST", "/api/companies", body({ code: `ZB${tag}`, setup: "BLANK", userId }));
    expect(r.status).toBe(201);
    const id = r.body.id as number;
    made.push(id);
    expect(await count("Branch", id)).toBe(1);
    expect(await count("FiscalYear", id)).toBe(1);
    expect(await count("UserCompanyAccess", id)).toBe(1);
    expect(await count("AccountGroup", id)).toBe(0);
    expect(await count("GeneralLedger", id)).toBe(0);
    expect(await count("GeneralLedgerSetup", id)).toBe(0);
  });

  it("refuses to guess: a request that does not choose default or blank creates nothing", async () => {
    const { setup, ...noSetup } = body({ code: `ZN${tag}` });
    const r = await call("POST", "/api/companies", noSetup);
    expect(r.status).toBe(400);
    expect(r.body.field).toBe("setup");
    expect(await rows(sql`select 1 from "Company" where code = ${`ZN${tag}`}`)).toHaveLength(0);
  });

  it("rejects a duplicate code (409), a bad code and an end date that is not after the start (400); nothing is left behind", async () => {
    const dup = await call("POST", "/api/companies", body({ setup: "BLANK" }));
    expect(dup.status).toBe(409);
    expect(dup.body.field).toBe("code");
    expect((await call("POST", "/api/companies", body({ code: "has space" }))).status).toBe(400);
    const range = await call("POST", "/api/companies", body({ code: `ZR${tag}`, startDate: "2027-07-17", endDate: "2026-07-16" }));
    expect(range.status).toBe(400);
    expect(range.body.field).toBe("endDate");
    expect(await rows(sql`select 1 from "Company" where code in (${`ZR${tag}`}, 'HAS SPACE')`)).toHaveLength(0);
  });

  it("running the defaults again fills what is missing but never overwrites a role the user changed", async () => {
    const { seedCompanyDefaults } = await import("../server/services/companyDefaults");
    const id = made[0];
    const [gl2] = await rows(sql`select id from "GeneralLedger" where "companyId" = ${id} and code = 'GL002'`);
    await db.execute(sql`update "GeneralLedgerSetup" set "generalLedgerId" = ${gl2.id} where "companyId" = ${id} and role = 'CASH_BOOK'`);
    await db.execute(sql`delete from "GeneralLedgerSetup" where "companyId" = ${id} and role = 'OUTPUT_VAT'`);
    const ledgersBefore = await count("GeneralLedger", id);

    await db.transaction((tx: any) => seedCompanyDefaults(tx, id));

    const after = Object.fromEntries((await rows(sql`select s.role, l.code from "GeneralLedgerSetup" s join "GeneralLedger" l on l.id = s."generalLedgerId" where s."companyId" = ${id}`)).map((s) => [s.role, s.code]));
    expect(after.CASH_BOOK).toBe("GL002"); // the user's choice is kept
    expect(after.OUTPUT_VAT).toBe("GL071"); // the missing role is filled in again
    expect(Object.keys(after)).toHaveLength(12);
    expect(await count("GeneralLedger", id)).toBe(ledgersBefore);
  });
});
