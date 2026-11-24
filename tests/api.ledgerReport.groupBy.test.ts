import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Group By must give exact subtotals for the WHOLE filtered report, not for the page on screen.
// Two fresh ledgers in different account sub-groups; 12 balanced journal vouchers (Dr first ledger, Cr second) => 24 lines,
// more than one page of 20, so a group that spans pages has to carry the same total on both pages.
describe.skipIf(!DB_READY)("Ledger report — Group By (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, fiscalYear = "", from = "", to = "";
  let glDr = 0, glCr = 0;
  const tag = uniq();
  const VOUCHERS = 12, AMOUNT = "25.00";

  const report = async (extra: Record<string, string> = {}, expected = 200) => {
    const q = new URLSearchParams({ companyId: String(companyId), branchId: String(branchId), fiscalYear, from, to, ledgerIds: `${glDr},${glCr}`, pageSize: "20", ...extra });
    const r = await call("GET", `/api/ledger-report?${q}`);
    expect(r.status, JSON.stringify(r.body)).toBe(expected);
    return r.body;
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    let fyId = 0;
    ({ companyId, branchId, fyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    const fy = ctx.companies.find((c: any) => c.id === companyId).fiscalYears.find((y: any) => y.id === fyId);
    fiscalYear = fy.code; from = fy.startDate; to = fy.endDate;
    const subs = (await call("GET", `/api/masters/account-sub-groups?companyId=${companyId}`)).body as any[];
    const bank = subs.find((s) => s.description === "Bank Accounts");
    const other = subs.find((s) => s.id !== bank.id);
    const mk = async (suffix: string, accountSubGroupId: number) => {
      const r = await call("POST", `/api/masters/general-ledger?companyId=${companyId}`, { code: `GB${suffix}${tag}`, name: `Group by ${suffix}`, accountGroupId: subs.find((s) => s.id === accountSubGroupId).accountGroupId, accountSubGroupId, normalBalance: "DEBIT", glType: "OTHER", isActive: true, isCashOrBank: false, postsToCashBook: false, requiresSubLedger: false, allowDocAdjust: false });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as number;
    };
    glDr = await mk("D", bank.id);
    glCr = await mk("C", other.id);
    for (let i = 0; i < VOUCHERS; i++) {
      const v = await call("POST", "/api/journal-vouchers", { companyId, branchId, voucherDate: from, remarks: `group by ${tag} ${i}`, lines: [
        { generalLedgerId: glDr, debit: AMOUNT, credit: "", narration: "dr" }, { generalLedgerId: glCr, debit: "", credit: AMOUNT, narration: "cr" }] });
      expect(v.status, JSON.stringify(v.body)).toBe(201);
      const p = await call("POST", `/api/journal-vouchers/${v.body.result.id}/post?companyId=${companyId}`, {});
      expect(p.status, JSON.stringify(p.body)).toBe(200);
    }
  });
  afterAll(async () => { await close(); });

  it("leaves the ungrouped report unchanged", async () => {
    const b = await report();
    expect(b.total).toBe(VOUCHERS * 2);
    expect(b.groupTotals).toBeUndefined();
    expect(b.rows[0]).not.toHaveProperty("groupKeys");
    expect(b.rows[0].accountGroupId).toBeNull(); // attribute joins are skipped when nothing is grouped
  });

  it("returns exact group subtotals over all pages, not just the visible page", async () => {
    const p1 = await report({ groupBy: "generalLedger", page: "1" });
    const p2 = await report({ groupBy: "generalLedger", page: "2" });
    expect(p1.total).toBe(VOUCHERS * 2);
    expect(p1.rows).toHaveLength(20);
    expect(p2.rows).toHaveLength(4);
    const money = (v: string) => Math.round(Number(v) * 100);
    const byKey = (b: any, id: number) => b.groupTotals.find((t: any) => t.keys[0] === String(id));
    // Same totals on both pages, and they cover all 12 vouchers (the page itself holds fewer lines of one of the groups).
    for (const b of [p1, p2]) {
      expect(money(byKey(b, glDr).debit)).toBe(VOUCHERS * 2500);
      expect(money(byKey(b, glDr).credit)).toBe(0);
      expect(byKey(b, glDr).count).toBe(VOUCHERS);
      expect(money(byKey(b, glCr).credit)).toBe(VOUCHERS * 2500);
      expect(byKey(b, glCr).count).toBe(VOUCHERS);
    }
    // Group-contiguous order across the page boundary: every line of the first group comes before any line of the second.
    const keys = [...p1.rows, ...p2.rows].map((r: any) => r.groupKeys[0]);
    const firstOfSecond = keys.findIndex((k) => k !== keys[0]);
    expect(keys.slice(firstOfSecond).every((k) => k !== keys[0])).toBe(true);
    expect(p1.rows[0].groupLabels[0]).toMatch(/Group by/);
  });

  it("groups by account sub-group (master data) with the same exact totals", async () => {
    const b = await report({ groupBy: "accountSubGroup" });
    const debit = b.groupTotals.reduce((t: number, g: any) => t + Math.round(Number(g.debit) * 100), 0);
    const credit = b.groupTotals.reduce((t: number, g: any) => t + Math.round(Number(g.credit) * 100), 0);
    expect(debit).toBe(VOUCHERS * 2500);
    expect(credit).toBe(VOUCHERS * 2500);
    expect(b.groupTotals).toHaveLength(2);
  });

  it("supports a two-level hierarchy and a visible Unassigned agent group", async () => {
    const b = await report({ groupBy: "accountSubGroup,agent" });
    expect(b.groupTotals.every((g: any) => g.keys.length === 2)).toBe(true);
    expect(b.groupTotals.every((g: any) => g.keys[1] === null)).toBe(true);
    expect(b.rows[0].groupLabels[1]).toBe("Unassigned");
  });

  it("groups invoice-header agents separately and leaves ordinary journals Unassigned", async () => {
    const b = await report({ groupBy: "invoiceAgent" });
    expect(b.groupTotals).toHaveLength(1);
    expect(b.groupTotals[0].keys).toEqual([null]);
    expect(b.rows[0].invoiceAgentId).toBeNull();
    expect(b.rows[0].groupLabels[0]).toBe("Unassigned");
  });

  it("groups by month from the client's month starts", async () => {
    const b = await report({ groupBy: "month", monthBounds: `${from},${to}` });
    expect(b.groupTotals).toHaveLength(1);
    expect(b.groupTotals[0].keys[0]).toBe(from);
    expect(b.groupTotals[0].count).toBe(VOUCHERS * 2);
  });

  it("rejects unknown fields, more than three levels, and month without bounds", async () => {
    await report({ groupBy: "password" }, 400);
    await report({ groupBy: "agent,area,subArea,source" }, 400);
    await report({ groupBy: "month" }, 400);
    await report({ groupBy: "month", monthBounds: "2025-01-01'; DROP TABLE x;--" }, 400);
  });
});
