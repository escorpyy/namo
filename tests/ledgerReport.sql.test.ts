import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(new URL("../server/routes/ledgerReport.ts", import.meta.url), "utf8");

describe("ledger report SQL identifiers", () => {
  it("quotes mixed-case invoiceNumber columns to match PostgreSQL schema identifiers", () => {
    expect(route).toContain('si."invoiceNumber"');
    expect(route).toContain('pb."invoiceNumber"');
    expect(route).not.toMatch(/\b(?:si|pb)\.invoiceNumber\b/);
  });
});
