import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinesGrid } from "../src/components/purchase/LinesGrid";
import { hasBatch } from "../src/components/purchase/BatchDialog";
import { blankLine, type Product } from "../src/lib/purchaseForm";
import type { PLookups } from "../src/api";

// Purchase bill lines: one Batch column (Yes / No), Net amount always last.

const product: Product = { id: 1, code: "OIL", description: "Oil", type: "STOCK", isActive: true, baseUnitId: 1, tracksBatch: true, tracksExpiry: true, defaultLocationId: null, purchaseRate: "120", alternateUnits: [] };
const lookups = { vendors: [], subLedgers: [], agents: [], locations: [], units: [{ id: 1, code: "LTR", name: "Litre", decimalPlaces: 2 }], products: [product], terms: [], fiscalYears: [] } as unknown as PLookups;
const render = (batchNo: string, kind: "bill" | "challan" = "bill") => renderToStaticMarkup(createElement(LinesGrid, {
  kind, lines: [{ ...blankLine(), productId: "1", qty: "2", rate: "10", batchNo }], onChange: () => {}, lookups, products: new Map([["1", product]]), readOnly: false, errors: {}, calendar: "AD",
  clearError: () => {}, contextKey: "c", onOpenTerms: () => {}, termSummary: () => ({ amount: "0.00", count: 0 }),
}));
const heads = (html: string) => [...html.matchAll(/<span class="(?:xl-rowhead|text-right|text-center|)">([^<]*)<\/span>/g)].map((m) => m[1]).filter(Boolean);

describe("purchase bill lines grid", () => {
  it("has one Batch column and ends with Net amount (then only the remove button)", () => {
    const h = heads(render(""));
    expect(h).toContain("Batch");
    expect(h).not.toContain("Mfg Date");
    expect(h).not.toContain("Expiry");
    expect(h[h.length - 1]).toBe("Net Amount");
  });
  it("Batch says No when empty and Yes when filled", () => {
    expect(render("")).toContain("Batch details: no");
    expect(render("B-17")).toContain("Batch details: yes");
  });
  it("a challan keeps its own batch / expiry columns", () => {
    const h = heads(render("", "challan"));
    expect(h).toEqual(expect.arrayContaining(["Mfg Date", "Expiry"]));
  });
  it("any filled batch field counts as filled", () => {
    expect(hasBatch({ batchNo: "", manufactureDate: "", expiryDate: "" })).toBe(false);
    expect(hasBatch({ batchNo: " ", manufactureDate: "", expiryDate: "" })).toBe(false);
    expect(hasBatch({ batchNo: "", manufactureDate: "", expiryDate: "2027-01-01" })).toBe(true);
  });
});
