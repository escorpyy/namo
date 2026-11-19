import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// A sub-ledger statement (one customer, one bank account) must show that sub-ledger's own opening balance, period totals and running balance.
// Built on a fresh ledger with two sub-ledgers so nothing else in the seeded data can leak into the figures:
//   opening  A Dr 40.00   B Dr 7.00
//   vouchers B Dr 250.00 (first), then A Dr 100.00, both on the first day of the fiscal year
describe.skipIf(!DB_READY)("Ledger report — sub-ledger scope (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, fyId = 0, fiscalYear = "", from = "", to = "";
  let gl = 0, subA = 0, subB = 0, counter = 0;
  const tag = uniq();
  const openingIds: number[] = [];

  const report = async (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ companyId: String(companyId), branchId: String(branchId), fiscalYear, from, to, ledgerIds: String(gl), ...extra });
    const r = await call("GET", `/api/ledger-report?${q}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const jv = async (subLedgerId: number, amount: string) => {
    const r = await call("POST", "/api/journal-vouchers", { companyId, branchId, voucherDate: from, remarks: `sub-ledger scope ${tag}`, lines: [
      { generalLedgerId: gl, subLedgerId, debit: amount, credit: "", narration: "dr" }, { generalLedgerId: counter, debit: "", credit: amount, narration: "cr" }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const p = await call("POST", `/api/journal-vouchers/${r.body.result.id}/post?companyId=${companyId}`, {});
    expect(p.status, JSON.stringify(p.body)).toBe(200);
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId, fyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    const fy = ctx.companies.find((c: any) => c.id === companyId).fiscalYears.find((y: any) => y.id === fyId);
    fiscalYear = fy.code; from = fy.startDate; to = fy.endDate;
    const sg = (await call("GET", `/api/masters/account-sub-groups?companyId=${companyId}`)).body.find((s: any) => s.description === "Bank Accounts").id;
    const g = await call("POST", `/api/masters/general-ledger?companyId=${companyId}`, { code: `SLS${tag}`, name: "Sub-ledger scope test", accountSubGroupId: sg, normalBalance: "DEBIT", glType: "OTHER", isActive: true, isCashOrBank: false, postsToCashBook: false, requiresSubLedger: true, allowDocAdjust: false });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    gl = g.body.id;
    const mk = async (suffix: string) => {
      const r = await call("POST", `/api/masters/sub-ledger?companyId=${companyId}`, { generalLedgerId: gl, code: `S${suffix}${tag}`, name: `Scope ${suffix}`, partyId: null, isActive: true });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as number;
    };
    subA = await mk("A"); subB = await mk("B");
    const lk = (await call("GET", `/api/journal-vouchers/lookups?companyId=${companyId}`)).body;
    counter = lk.ledgers.find((l: any) => l.isActive && !l.requiresSubLedger).id;

    const { db } = await import("../server/db");
    const { openingBalance } = await import("../server/db/schema");
    const rows = await db.insert(openingBalance).values([
      { companyId, branchId, fiscalYearId: fyId, generalLedgerId: gl, subLedgerId: subA, debit: "40.00", credit: "0" },
      { companyId, branchId, fiscalYearId: fyId, generalLedgerId: gl, subLedgerId: subB, debit: "7.00", credit: "0" },
    ]).returning({ id: openingBalance.id });
    openingIds.push(...rows.map((r) => r.id));
    await jv(subB, "250.00");
    await jv(subA, "100.00");
  });
  afterAll(async () => {
    // The one-sided opening rows would unbalance the opening-balance tests that run after this file; the vouchers balance on their own and stay.
    if (openingIds.length) {
      const { db } = await import("../server/db");
      const { openingBalance } = await import("../server/db/schema");
      const { inArray } = await import("drizzle-orm");
      await db.delete(openingBalance).where(inArray(openingBalance.id, openingIds));
    }
    await close();
  });

  const num = (v: string) => Number(v);

  it("sub-ledger A: its own opening, totals, lines and running balance", async () => {
    const r = await report({ subLedgerId: String(subA) });
    expect(r.summary).toHaveLength(1);
    expect(num(r.summary[0].opening)).toBe(40);
    expect(num(r.summary[0].debit)).toBe(100);
    expect(num(r.summary[0].credit)).toBe(0);
    expect(num(r.summary[0].closing)).toBe(140);
    expect(r.rows).toHaveLength(1);
    expect(num(r.rows[0].running)).toBe(140);
  });

  it("sub-ledger B: unaffected by A, even though B's voucher came first", async () => {
    const r = await report({ subLedgerId: String(subB) });
    expect([num(r.summary[0].opening), num(r.summary[0].debit), num(r.summary[0].closing)]).toEqual([7, 250, 257]);
    expect(r.rows.map((x: any) => num(x.running))).toEqual([257]);
  });

  it("the whole ledger still adds up both sub-ledgers", async () => {
    const r = await report();
    expect([num(r.summary[0].opening), num(r.summary[0].debit), num(r.summary[0].closing)]).toEqual([47, 350, 397]);
    expect(r.rows.map((x: any) => num(x.running))).toEqual([297, 397]);
  });

  it("a sub-ledger filter with a product or search keeps the running balance of that sub-ledger", async () => {
    const r = await report({ subLedgerId: String(subA), search: "dr" });
    expect(r.rows.map((x: any) => num(x.running))).toEqual([140]);
  });
});
