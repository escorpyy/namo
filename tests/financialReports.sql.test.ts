import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../server/routes/financialReports.ts", import.meta.url), "utf8");

describe("financial report SQL contracts", () => {
  it("owns every ledger through mandatory Account Group and keeps Sub Group optional", () => {
    expect(route).toContain('JOIN "AccountGroup" ag ON ag.id = g."accountGroupId"');
    expect(route).toContain('LEFT JOIN "AccountSubGroup" sg ON sg.id = g."accountSubGroupId"');
  });

  it("supports all three statements from the shared report route", () => {
    expect(route).toContain('"trial-balance"');
    expect(route).toContain('"profit-loss"');
    expect(route).toContain('"balance-sheet"');
    expect(route).toContain("ag.type IN ('REVENUE', 'EXPENSE')");
    expect(route).toContain("ag.type IN ('ASSET', 'LIABILITY', 'EQUITY')");
  });

  it("restricts posted transactions to the selected company, branch, year, and date range", () => {
    expect(route).toContain('v."companyId" = ${companyId}');
    expect(route).toContain('v."branchId" = ${branchId}');
    expect(route).toContain('v."fiscalYear" = ${fiscalYear}');
    expect(route).toContain('v."isPosted" = true');
    expect(route).toContain('BETWEEN ${start}::date AND ${end}::date');
  });
});
