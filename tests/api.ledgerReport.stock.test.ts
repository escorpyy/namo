import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// The automatic stock ledgers (closing stock P&L / B/S, opening stock P&L) show in the Ledger Report as ONE line per ledger for the period,
// in the Lines view (grouped and ungrouped) and in the summary, without any voucher behind them.
describe.skipIf(!DB_READY)("Ledger report — automatic stock lines (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  let companyId = 0, branchId = 0, fyId = 0, fiscalYear = "", from = "", to = "";
  let sdId = 0, oldMap: any = null, sbId = 0, glO = 0, glP = 0, glB = 0;
  const tag = uniq();

  const report = async (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ companyId: String(companyId), branchId: String(branchId), fiscalYear, from, to, ledgerIds: `${glO},${glP},${glB}`, pageSize: "50", ...extra });
    const r = await call("GET", `/api/ledger-report?${q}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    ({ companyId, branchId, fyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    const fy = ctx.companies.find((c: any) => c.id === companyId).fiscalYears.find((y: any) => y.id === fyId);
    fiscalYear = fy.code; from = fy.startDate; to = fy.endDate;
    const subs = (await call("GET", `/api/masters/account-sub-groups?companyId=${companyId}`)).body as any[];
    const mk = async (s: string, nb: string) => {
      const r = await call("POST", `/api/masters/general-ledger?companyId=${companyId}`, { code: `ST${s}${tag}`, name: `Stock ${s}`, accountGroupId: subs[0].accountGroupId, accountSubGroupId: subs[0].id, normalBalance: nb, glType: "OTHER", isActive: true, isCashOrBank: false, postsToCashBook: false, requiresSubLedger: false, allowDocAdjust: false });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as number;
    };
    glO = await mk("O", "DEBIT"); glP = await mk("P", "CREDIT"); glB = await mk("B", "DEBIT");
    const sd = (await db.execute(sql`select sd.id, sd."productId", sd."openingGLId", sd."closingPLGLId", sd."closingBSGLId", sd."valuationMethod" from "StockDetail" sd join "Product" p on p.id = sd."productId" where p."companyId" = ${companyId} limit 1`)) as any[];
    sdId = sd[0].id; oldMap = sd[0];
    await db.execute(sql`update "StockDetail" set "valuationMethod" = 'WEIGHTED_AVERAGE', "openingGLId" = ${glO}, "closingPLGLId" = ${glP}, "closingBSGLId" = ${glB} where id = ${sdId}`);
    sbId = ((await db.execute(sql`insert into "StockOpeningBalance" ("branchId","fiscalYearId","stockDetailId",quantity,rate,value,"updatedAt") values (${branchId},${fyId},${sdId},8,50,400,now()) returning id`)) as any[])[0].id;
    const { syncOpeningMovements } = await import("../server/services/stockLedger");
    await syncOpeningMovements(db, { companyId, branchId, fiscalYearId: fyId });
  });
  afterAll(async () => {
    try {
      await db.execute(sql`update "StockDetail" set "valuationMethod" = ${oldMap.valuationMethod}, "openingGLId" = ${oldMap.openingGLId}, "closingPLGLId" = ${oldMap.closingPLGLId}, "closingBSGLId" = ${oldMap.closingBSGLId} where id = ${sdId}`);
      await db.execute(sql`delete from "StockOpeningBalance" where id = ${sbId}`);
      const { syncOpeningMovements } = await import("../server/services/stockLedger");
      await syncOpeningMovements(db, { companyId, branchId, fiscalYearId: fyId });
    } catch { /* best effort */ }
    await close();
  });

  const money = (v: string) => Math.round(Number(v) * 100);

  it("shows one automatic line per stock ledger, and they balance", async () => {
    const b = await report();
    const stock = b.rows.filter((r: any) => r.kind === "STOCK");
    expect(stock.length).toBeGreaterThanOrEqual(2);
    const p = stock.find((r: any) => r.generalLedgerId === glP);
    const o = stock.find((r: any) => r.generalLedgerId === glO);
    expect(money(p.credit)).toBeGreaterThan(0);
    expect(money(o.debit)).toBeGreaterThanOrEqual(40000); // the seed may hold other opening rows for this product
    expect(p.sourceScreen).toBe("inv-stock-valuation");
    const net = stock.reduce((a: number, r: any) => a + money(r.debit) - money(r.credit), 0);
    expect(net).toBe(0);
  });

  it("works grouped by ledger too", async () => {
    const b = await report({ groupBy: "generalLedger" });
    expect(b.rows.filter((r: any) => r.kind === "STOCK").length).toBeGreaterThanOrEqual(2);
    expect(b.groupTotals.length).toBeGreaterThanOrEqual(2);
  });
});
