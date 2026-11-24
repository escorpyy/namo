import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../server/routes/financialReports.ts", import.meta.url), "utf8");
const rowsService = readFileSync(new URL("../server/services/financialReportRows.ts", import.meta.url), "utf8");

describe("financial report SQL contracts", () => {
  it("owns every ledger through mandatory Account Group and keeps Sub Group optional", () => {
    expect(rowsService).toContain('JOIN "AccountGroup" ag ON ag.id = g."accountGroupId"');
    expect(rowsService).toContain('LEFT JOIN "AccountSubGroup" sg ON sg.id = g."accountSubGroupId"');
  });

  it("supports all three statements from the shared report route", () => {
    expect(route).toContain('"trial-balance"');
    expect(route).toContain('"profit-loss"');
    expect(route).toContain('"balance-sheet"');
    expect(rowsService).toContain("ag.type IN ('REVENUE', 'EXPENSE')");
    expect(rowsService).toContain("ag.type IN ('ASSET', 'LIABILITY', 'EQUITY')");
  });

  it("restricts posted transactions to the selected company, branch, year, and date range", () => {
    expect(rowsService).toContain('v."companyId" = ${q.companyId}');
    expect(rowsService).toContain('v."branchId" = ${q.branchId}');
    expect(rowsService).toContain('v."fiscalYear" = ${q.fiscalYear}');
    expect(rowsService).toContain('v."isPosted" = true');
    expect(rowsService).toContain('BETWEEN ${q.start}::date AND ${q.end}::date');
  });

  it("excludes only active closing vouchers from P&L calculations", () => {
    expect(rowsService).toContain('fc.status = \'CLOSED\'');
    expect(route).toContain('kind: "profit-loss", excludeActiveCloseJournals: false');
  });
});
