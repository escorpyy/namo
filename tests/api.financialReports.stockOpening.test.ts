import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, type Res } from "./helpers";

// The statements warn when Stock Opening and the Closing Stock (B/S) ledger's opening balance differ (the Balance Sheet stock would be off by the difference).
// Seed: stock 310,000.00 and ledger GL003 opening 310,000.00 agree.
describe.skipIf(!DB_READY)("Financial reports: stock opening vs stock ledger", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, fyId = 0, fyCode = "", from = "", to = "";
  let db: any, sql: any;

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId, fyId } = await seededContext(call));
    const fy = (await call("GET", "/api/context")).body.companies.find((c: any) => c.id === companyId).fiscalYears.find((f: any) => f.id === fyId);
    fyCode = fy.code; from = String(fy.startDate).slice(0, 10); to = String(fy.endDate).slice(0, 10);
    ({ db } = await import("../server/db")); ({ sql } = await import("drizzle-orm"));
  });
  afterAll(async () => { await close(); });

  const report = async (kind: string) => (await call("GET", `/api/financial-reports/${kind}?companyId=${companyId}&branchId=${branchId}&fiscalYear=${encodeURIComponent(fyCode)}&from=${from}&to=${to}`));

  it("is silent when they agree and names the ledger when they do not", async () => {
    const ok = await report("balance-sheet");
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.stockOpeningMismatches).toEqual([]);

    // Make the ledger's opening 5,000 short, then put it back.
    const [gl] = (await db.execute(sql`SELECT id FROM "GeneralLedger" WHERE "companyId" = ${companyId} AND code = 'GL003'`)) as any[];
    const [ob] = (await db.execute(sql`SELECT id, debit::text AS debit FROM "OpeningBalance" WHERE "companyId" = ${companyId} AND "branchId" = ${branchId} AND "fiscalYearId" = ${fyId} AND "generalLedgerId" = ${gl.id} AND debit > 0 LIMIT 1`)) as any[];
    const original = ob.debit;
    try {
      await db.execute(sql`UPDATE "OpeningBalance" SET debit = debit - 5000 WHERE id = ${ob.id}`);
      for (const kind of ["balance-sheet", "trial-balance"]) {
        const bad = await report(kind);
        expect(bad.body.stockOpeningMismatches, kind).toEqual([expect.objectContaining({ ledger: "GL003", stock: "310000.00", ledgerBalance: "305000.00" })]);
      }
      expect((await report("profit-loss")).body.stockOpeningMismatches).toEqual([]);
    } finally {
      await db.execute(sql`UPDATE "OpeningBalance" SET debit = ${original} WHERE id = ${ob.id}`);
    }
    expect((await report("balance-sheet")).body.stockOpeningMismatches).toEqual([]);
  });
});
