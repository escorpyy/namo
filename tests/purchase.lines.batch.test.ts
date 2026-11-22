import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LinesGrid } from "../src/components/purchase/LinesGrid";
import { hasBatch } from "../src/components/purchase/BatchDialog";
import { blankLine, type Product } from "../src/lib/purchaseForm";
import type { PLookups } from "../src/api";

// Purchase bill lines: one "More" column (location, batch, expiry) after Net amount; the alternate qty / unit columns are always there.

const product: Product = { id: 1, code: "OIL", description: "Oil", type: "STOCK", isActive: true, baseUnitId: 1, tracksBatch: true, tracksExpiry: true, defaultLocationId: null, purchaseRate: "120", alternateUnits: [] };
const lookups = { vendors: [], subLedgers: [], agents: [], locations: [], units: [{ id: 1, code: "LTR", name: "Litre", decimalPlaces: 2 }], products: [product], terms: [], fiscalYears: [] } as unknown as PLookups;
const render = (batchNo: string, kind: "bill" | "challan" = "bill") => renderToStaticMarkup(createElement(LinesGrid, {
  kind, lines: [{ ...blankLine(), productId: "1", qty: "2", rate: "10", batchNo }], onChange: () => {}, lookups, products: new Map([["1", product]]), readOnly: false, errors: {}, calendar: "AD",
  clearError: () => {}, contextKey: "c", onOpenTerms: () => {}, termSummary: () => ({ amount: "0.00", count: 0 }),
}));
const heads = (html: string) => [...html.matchAll(/<span class="(?:xl-rowhead|text-right|text-center|)">([^<]*)<\/span>/g)].map((m) => m[1]).filter(Boolean);

describe("purchase bill lines grid", () => {
  it("has one More column after Net amount (then only the remove button), and always the alternate columns", () => {
    const h = heads(render(""));
    expect(h).toEqual(expect.arrayContaining(["Alt Qty", "Alt Unit", "More"]));
    expect(h).not.toContain("Batch");
    expect(h).not.toContain("Mfg Date");
    expect(h).not.toContain("Expiry");
    expect(h).not.toContain("Location");
    expect(h.indexOf("More")).toBe(h.indexOf("Net Amount") + 1);
    expect(h[h.length - 1]).toBe("More");
  });
  it("More shows what is filled", () => {
    expect(render("")).toContain("Add location");
    expect(render("B-17")).toContain("B-17");
  });
  it("a challan keeps its own batch / expiry columns", () => {
    const h = heads(render("", "challan"));
    expect(h).toEqual(expect.arrayContaining(["Mfg Date", "Expiry"]));
  });
  it("any filled batch field counts as filled", () => {
    expect(hasBatch({ locationId: "", batchNo: "", manufactureDate: "", expiryDate: "" })).toBe(false);
    expect(hasBatch({ locationId: "", batchNo: " ", manufactureDate: "", expiryDate: "" })).toBe(false);
    expect(hasBatch({ locationId: "", batchNo: "", manufactureDate: "", expiryDate: "2027-01-01" })).toBe(true);
    expect(hasBatch({ locationId: "2", batchNo: "", manufactureDate: "", expiryDate: "" })).toBe(true);
  });
});
