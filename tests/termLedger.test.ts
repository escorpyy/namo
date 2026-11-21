import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MASTERS } from "../shared/masters";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("a billing term always has its own ledger", () => {
  it.each(["purchase-terms", "sales-terms"])("%s: General Ledger is required", (key) => {
    const f = MASTERS[key].fields.find((x) => x.name === "generalLedgerId");
    expect(f?.required).toBe(true);
  });
});

describe("a draft posts to the term's ledger as it is now", () => {
  it("purchase bill: the master's ledger wins over the copy saved with the draft, and the copy follows", () => {
    const s = src("server/services/purchase/purchaseBill.ts");
    expect(s).toContain("const gl = masterGL ?? t.generalLedgerId;");
    expect(s).toContain("await tx.update(S.purchaseDocumentTerm).set({ generalLedgerId: gl })");
    expect(s).not.toContain("t.generalLedgerId ?? masterGL");
  });
  it("sales invoice: same rule", () => {
    const s = src("server/services/salesInvoice.ts");
    expect(s).toContain("const glId = masterGL ?? row.generalLedgerId;");
    expect(s).toContain("await tx.update(S.salesDocumentTerm).set({ generalLedgerId: glId })");
    expect(s).toContain("masterGL: S.salesTerm.generalLedgerId");
  });
});
