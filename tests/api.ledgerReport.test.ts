import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, startApi, type Res } from "./helpers";

describe.skipIf(!DB_READY)("Ledger report (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, fiscalYear = "", from = "", to = "";
  beforeAll(async () => {
    ({ call, close } = await startApi());
    const ctx = (await call("GET", "/api/context")).body;
    const company = ctx.companies[0];
    const branch = company.branches.find((b: any) => b.isHeadOffice) ?? company.branches[0];
    const fy = company.fiscalYears.find((x: any) => x.isCurrent) ?? company.fiscalYears[0];
    companyId = company.id; branchId = branch.id; fiscalYear = fy.code; from = fy.startDate; to = fy.endDate;
  });
  afterAll(async () => { await close(); });
  it("returns company-scoped ledger, sub-ledger and product lookups", async () => {
    const r = await call("GET", `/api/ledger-report/lookups?companyId=${companyId}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Array.isArray(r.body.ledgers)).toBe(true);
    expect(Array.isArray(r.body.subLedgers)).toBe(true);
    expect(Array.isArray(r.body.products)).toBe(true);
  });
  it("runs the fiscal-year ledger summary and paged transaction query", async () => {
    const q = new URLSearchParams({ companyId: String(companyId), branchId: String(branchId), fiscalYear, from, to });
    const r = await call("GET", `/api/ledger-report?${q}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Array.isArray(r.body.rows)).toBe(true);
    expect(Array.isArray(r.body.summary)).toBe(true);
    expect(r.body.pageSize).toBe(100);
    if (r.body.rows.length) {
      expect(r.body.rows[0]).toHaveProperty("running");
      expect(r.body.rows[0]).toHaveProperty("products");
      expect(r.body.rows[0]).toHaveProperty("posted");
    }
  });
  it("rejects dates outside the selected fiscal year", async () => {
    const q = new URLSearchParams({ companyId: String(companyId), branchId: String(branchId), fiscalYear, from: "1900-01-01", to: "1900-01-31" });
    const r = await call("GET", `/api/ledger-report?${q}`);
    expect(r.status).toBe(400);
  });
});
