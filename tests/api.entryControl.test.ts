import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// Entry Control is a company setting: what a source module shows and what it insists on. Saved per company, defaults when nothing is saved,
// and a feature set Mandatory is enforced by the server (a hidden one is never mandatory).
describe.skipIf(!DB_READY)("Entry Control (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, from = "", glA = 0, glB = 0;
  const tag = uniq();

  const put = (controls: unknown) => call("PUT", "/api/entry-control", { companyId, controls });
  const journal = (remarks: string, narration = "n") => call("POST", "/api/journal-vouchers", { companyId, branchId, voucherDate: from, remarks, lines: [
    { generalLedgerId: glA, debit: "10.00", credit: "", narration }, { generalLedgerId: glB, debit: "", credit: "10.00", narration }] });

  // The test has a company of its own: Entry Control is a company setting, so changing the seeded company's would trip the other test files.
  beforeAll(async () => {
    ({ call, close } = await startApi());
    const { db } = await import("../server/db");
    const one = async (q: any) => ((await db.execute(q)) as any[])[0].id as number;
    const code = (x: string) => `${x}${tag}`.slice(0, 10);
    companyId = await one(sql`insert into "Company" (code, name, "updatedAt") values (${code("EC")}, ${`Entry control ${tag}`}, now()) returning id`);
    branchId = await one(sql`insert into "Branch" ("companyId", code, name, "updatedAt") values (${companyId}, ${code("BR")}, 'Branch', now()) returning id`);
    from = "2025-07-17";
    await db.execute(sql`insert into "FiscalYear" ("companyId", code, "startDate", "endDate", "isCurrent", "updatedAt") values (${companyId}, '2082/83', '2025-07-17', '2026-07-16', true, now())`);
    const grp = await one(sql`insert into "AccountGroup" ("companyId", code, description, type, "updatedAt") values (${companyId}, ${code("AG")}, 'Assets', 'ASSET', now()) returning id`);
    const sub = await one(sql`insert into "AccountSubGroup" (code, description, "accountGroupId", "updatedAt") values (${code("SG")}, 'Assets', ${grp}, now()) returning id`);
    const mk = async (s: string) => {
      const r = await call("POST", `/api/masters/general-ledger?companyId=${companyId}`, { code: `EC${s}${tag}`, name: `Entry control ${s}`, accountGroupId: grp, accountSubGroupId: sub, normalBalance: "DEBIT", glType: "OTHER", isActive: true, isCashOrBank: false, postsToCashBook: false, requiresSubLedger: false, allowDocAdjust: false });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as number;
    };
    glA = await mk("A"); glB = await mk("B");
  });
  afterAll(async () => {
    try { // the company is the test's own: take its rows away again (best effort, children first)
      const { db } = await import("../server/db");
      const run = (q: any) => db.execute(q);
      await run(sql`delete from "JournalVoucherLine" where "journalVoucherId" in (select id from "JournalVoucher" where "companyId" = ${companyId})`);
      await run(sql`delete from "JournalVoucher" where "companyId" = ${companyId}`);
      await run(sql`delete from "CashBankVoucher" where "companyId" = ${companyId}`);
      await run(sql`delete from "GeneralLedgerSetup" where "companyId" = ${companyId}`);
      await run(sql`delete from "EntryControl" where "companyId" = ${companyId}`);
      await run(sql`delete from "GeneralLedger" where "companyId" = ${companyId}`);
      await run(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${companyId})`);
      await run(sql`delete from "AccountGroup" where "companyId" = ${companyId}`);
      await run(sql`delete from "NumberSeries" where "companyId" = ${companyId}`);
      await run(sql`delete from "FiscalYear" where "companyId" = ${companyId}`);
      await run(sql`delete from "Branch" where "companyId" = ${companyId}`);
      await run(sql`delete from "Company" where id = ${companyId}`);
    } catch (e) { console.warn("entry control test cleanup:", (e as Error).message.slice(0, 200)); }
    await close();
  });

  it("lists the modules and answers defaults when nothing is saved", async () => {
    const r = await call("GET", `/api/entry-control?companyId=${companyId}`);
    expect(r.status).toBe(200);
    expect(r.body.modules.map((m: any) => m.key)).toEqual(["CASH_BANK_VOUCHER", "JOURNAL_VOUCHER", "SALES_INVOICE"]);
    expect(r.body.controls.JOURNAL_VOUCHER.remarks).toMatchObject({ show: true, mandatory: false });
  });

  it("refuses a bad value and ignores unknown features", async () => {
    expect((await put({ JOURNAL_VOUCHER: { remarks: { mandatory: "yes" } } })).status).toBe(400);
    expect((await put({ JOURNAL_VOUCHER: { remarks: { rule: "MAYBE" } } })).status).toBe(400);
    expect((await put({ JOURNAL_VOUCHER: { noSuchFeature: { show: false } } })).status).toBe(200);
  });

  it("a mandatory remarks / narration is enforced by the server; a hidden feature is never mandatory", async () => {
    const saved = await put({ JOURNAL_VOUCHER: { remarks: { show: true, mandatory: true }, lineNarration: { show: true, mandatory: true } } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.controls.JOURNAL_VOUCHER.remarks.mandatory).toBe(true);
    const blank = await journal("");
    expect(blank.status).toBe(409);
    expect(blank.body.field).toBe("remarks");
    expect((await journal("ok", "")).status).toBe(409);
    expect((await journal(`ok ${tag}`)).status).toBe(201);
    const hidden = await put({ JOURNAL_VOUCHER: { remarks: { show: false, mandatory: true } } });
    expect(hidden.body.controls.JOURNAL_VOUCHER.remarks).toMatchObject({ show: false, mandatory: false });
  });

  it("applies to a cash / bank voucher too", async () => {
    await put({ CASH_BANK_VOUCHER: { remarks: { show: true, mandatory: true } } });
    const r = await call("POST", "/api/cash-bank-vouchers", { companyId, branchId, voucherDate: from, cashBankLedgerId: glA, remarks: "", lines: [{ generalLedgerId: glB, receipt: "5.00", payment: "", narration: "x" }] });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe("remarks");
    await put({ CASH_BANK_VOUCHER: { remarks: { show: true, mandatory: false } } });
  });

  it("a new cash / bank voucher starts with the GL Setup Cash Book ledger", async () => {
    const g = await call("GET", `/api/gl-setup?companyId=${companyId}`);
    expect(g.status).toBe(200);
    const roles = g.body.roles as any[];
    const before = roles.find((r) => r.role === "CASH_BOOK").generalLedgerId;
    const put = (id: number | null) => call("PUT", "/api/gl-setup", { companyId, userId: 1, roles: roles.map((r) => r.role === "CASH_BOOK" ? { ...r, generalLedgerId: id } : r) });
    try {
      const r = await put(glA);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await call("GET", `/api/cash-bank-vouchers/lookups?companyId=${companyId}`)).body.defaultCashBankLedgerId).toBe(glA);
    } finally { await put(before ?? null); }
  });
});
