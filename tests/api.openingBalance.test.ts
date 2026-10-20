import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, type Res } from "./helpers";

// Accounting rules for the Opening Balance grid: amount validation, exact totals, Dr = Cr before lock,
// no edits after lock, no edits in a closed fiscal year. Assumes the freshly seeded demo company (balanced at 760,000.00).
describe.skipIf(!DB_READY)("Opening Balance (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, fyId = 0;
  let glA = 0, glB = 0; // two plain, empty ledgers used for test entries
  let setClosed: (v: boolean) => Promise<void>;

  const q = () => `companyId=${companyId}&branchId=${branchId}&fiscalYearId=${fyId}`;
  const get = async () => (await call("GET", `/api/opening-balance?${q()}`)).body;
  const put = (items: unknown[], extra: Record<string, unknown> = {}) => call("PUT", "/api/opening-balance", { companyId, branchId, fiscalYearId: fyId, items, ...extra });
  const lock = () => call("POST", "/api/opening-balance/lock", { companyId, fiscalYearId: fyId });
  const unlock = () => call("POST", "/api/opening-balance/unlock", { companyId, fiscalYearId: fyId });
  const clear = () => put([{ generalLedgerId: glA, debit: "0", credit: "0" }, { generalLedgerId: glB, debit: "0", credit: "0" }]);

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId, fyId } = await seededContext(call));
    const rows = (await get()).rows as any[];
    const empty = rows.filter((r) => !r.requiresSubLedger && r.isActive && r.debit === "0.00" && r.credit === "0.00");
    expect(empty.length, "seed should have empty plain ledgers").toBeGreaterThanOrEqual(2);
    glA = empty[0].generalLedgerId;
    glB = empty[1].generalLedgerId;
    const { db } = await import("../server/db");
    const { fiscalYear } = await import("../server/db/schema");
    const { eq } = await import("drizzle-orm");
    setClosed = async (v) => { await db.update(fiscalYear).set({ isClosed: v }).where(eq(fiscalYear.id, fyId)); };
  });
  afterAll(async () => {
    await setClosed(false);
    await unlock(); // ignore result: fine if it was not locked
    await clear();
    await close();
  });

  it("seed baseline is balanced and the branch total equals the company total", async () => {
    const d = await get();
    expect(d.totals.company).toEqual({ debit: "760000.00", credit: "760000.00" });
    expect(d.totals.branch).toEqual(d.totals.company);
    expect(d.fiscalYear.isOpeningBalanceLocked).toBe(false);
  });

  describe("amount validation", () => {
    it.each([
      ["both debit and credit on one ledger", { debit: "10", credit: "5" }],
      ["negative amount", { debit: "-1", credit: "0" }],
      ["more than 2 decimals", { debit: "1.005", credit: "0" }],
      ["non-numeric amount", { debit: "abc", credit: "0" }],
      ["scientific notation", { debit: "1e3", credit: "0" }],
    ])("rejects %s", async (_n, amt) => {
      const r = await put([{ generalLedgerId: glA, ...amt }]);
      expect(r.status).toBe(400);
    });
    it("rejects the same ledger twice, an unknown ledger, and an empty save", async () => {
      expect((await put([{ generalLedgerId: glA, debit: "1", credit: "0" }, { generalLedgerId: glA, debit: "2", credit: "0" }])).status).toBe(400);
      expect((await put([{ generalLedgerId: 999999, debit: "1", credit: "0" }])).status).toBe(400);
      expect((await put([])).status).toBe(400);
    });
    it("rejects an amount on a Sub-Ledger-controlled ledger without a Sub Ledger", async () => {
      const ctl = ((await get()).rows as any[]).find((r) => r.requiresSubLedger && r.subLedgerId == null) ?? ((await get()).rows as any[]).find((r) => r.requiresSubLedger);
      const r = await put([{ generalLedgerId: ctl.generalLedgerId, subLedgerId: null, debit: "5", credit: "0" }]);
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/requires a Sub Ledger/);
    });
    it("is scoped to the company: a foreign fiscal year is 404", async () => {
      const r = await call("GET", `/api/opening-balance?companyId=${companyId}&branchId=${branchId}&fiscalYearId=999999`);
      expect(r.status).toBe(404);
    });
    it("nothing was saved by the rejected requests", async () => {
      expect((await get()).totals.company).toEqual({ debit: "760000.00", credit: "760000.00" });
    });
  });

  describe("posting, balance and lock", () => {
    it("saves entries and totals are exact to the paisa (no float drift)", async () => {
      const r = await put([{ generalLedgerId: glA, debit: "1000.10", credit: "0" }]);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ saved: 1, deleted: 0 });
      expect((await get()).totals.company).toEqual({ debit: "761000.10", credit: "760000.00" });
    });
    it("refuses to lock while Dr != Cr, and stays unlocked", async () => {
      const r = await lock();
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/not balanced/);
      expect((await get()).fiscalYear.isOpeningBalanceLocked).toBe(false);
    });
    it("locks once balanced", async () => {
      expect((await put([{ generalLedgerId: glB, debit: "0", credit: "1000.10" }])).status).toBe(200);
      expect((await get()).totals.company).toEqual({ debit: "761000.10", credit: "761000.10" });
      const r = await lock();
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await get()).fiscalYear.isOpeningBalanceLocked).toBe(true);
    });
    it("blocks edits and double-locking while locked", async () => {
      const r = await put([{ generalLedgerId: glA, debit: "5", credit: "0" }]);
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/locked/);
      expect((await lock()).status).toBe(409);
      expect((await get()).totals.company.debit).toBe("761000.10"); // unchanged
    });
    it("unlock re-enables editing; unlocking twice is refused", async () => {
      expect((await unlock()).status).toBe(200);
      expect((await unlock()).status).toBe(409);
      expect((await put([{ generalLedgerId: glA, debit: "1000.10", credit: "0" }])).status).toBe(200);
    });
    it("a zero amount deletes the row and restores the baseline", async () => {
      const r = await clear();
      expect(r.status).toBe(200);
      expect(r.body.deleted).toBe(2);
      expect((await get()).totals.company).toEqual({ debit: "760000.00", credit: "760000.00" });
    });
  });

  describe("closed fiscal year", () => {
    it("blocks edits and locking; GET still works", async () => {
      await setClosed(true);
      try {
        const r = await put([{ generalLedgerId: glA, debit: "1", credit: "0" }]);
        expect(r.status).toBe(409);
        expect(r.body.message).toMatch(/closed/);
        expect((await lock()).status).toBe(409);
        expect((await get()).fiscalYear.isClosed).toBe(true);
      } finally {
        await setClosed(false);
      }
    });
  });
});
