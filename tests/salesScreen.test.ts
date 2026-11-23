import { describe, expect, it } from "vitest";
import { toPLookups } from "../src/screens/sales/SalesInvoiceScreen";
import { lineToPayload, blankLine } from "../src/lib/purchaseForm";
import type { SalesLookups } from "../src/api";

// The sales screen reuses the purchase grids, so it hands them its pick-lists in the purchase shape.
const sales: SalesLookups = {
  customers: [{ id: 9, code: "C001", name: "Ram Traders", requiresSubLedger: false, isCashOrBank: false, creditLimit: "50000.00", creditDays: 30 }],
  subLedgers: [{ id: 4, code: "S1", name: "Branch 1", generalLedgerId: 9 }],
  agents: [{ id: 2, code: "A1", name: "Sita" }],
  products: [{ id: 5, code: "P1", description: "Rice", type: "STOCK", unitId: 3, unitCode: "KG", salesRate: "120", salesGLId: 70, alternateUnits: [{ unitId: 6, unitCode: "BAG", conversionFactor: "25" }], tracksBatch: false, tracksExpiry: false, defaultLocationId: null }],
  locations: [{ id: 2, code: "WH", name: "Warehouse", isActive: true }],
  units: [{ id: 3, code: "KG", name: "Kilogram", decimalPlaces: 3 }],
  terms: [{ id: 1, code: "ROUND", name: "Round Off", category: "ROUNDED", nature: "ADDITIVE", isProductwise: false, isMandatory: true, isEditable: false, defaultCalcType: "AMOUNT", defaultValue: "0", calcBase: "RUNNING_TOTAL", baseTermId: null, sequence: 9, generalLedgerId: 80, roundingMethod: null }],
  fiscalYears: [{ id: 1, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, isClosed: false }],
  series: [],
};

describe("sales screen pick-lists", () => {
  const lk = toPLookups(sales);
  it("customers take the place of vendors (credit days become the payment term) and every row is active", () => {
    expect(lk.vendors).toEqual([{ id: 9, code: "C001", name: "Ram Traders", requiresSubLedger: false, isCashOrBank: false, creditLimit: "50000.00", creditDays: 30, isActive: true, paymentTermDays: 30 }]);
    expect(lk.subLedgers[0].isActive && lk.agents[0].isActive).toBe(true);
  });
  it("a product keeps its unit, sales rate, alternate units and batch/expiry tracking, and the locations are passed on", () => {
    expect(lk.products[0]).toMatchObject({ baseUnitId: 3, salesRate: "120", tracksBatch: false, tracksExpiry: false, defaultLocationId: null, alternateUnits: [{ unitId: 6, conversionFactor: "25" }] });
    expect(lk.locations).toEqual([{ id: 2, code: "WH", name: "Warehouse", isActive: true }]);
    expect(lk.units[0].decimalPlaces).toBe(3);
  });
  it("terms keep their rules; a missing rounding method simply is not set", () => {
    expect(lk.terms[0]).toMatchObject({ code: "ROUND", category: "ROUNDED", isActive: true, distributeToLines: false });
    expect(lk.terms[0].roundingMethod).toBeUndefined();
  });
});

describe("sales line payload", () => {
  const p = toPLookups(sales).products[0];
  it("sends product, quantity, rate and where the stock comes from: no order links", () => {
    expect(lineToPayload(blankLine({ productId: "5", qty: "2", rate: "120" }), p, "sales")).toEqual({ productId: 5, qty: "2", rate: "120", locationId: null, batchNo: null, expiryDate: null });
  });
  it("sends the alternate quantity and unit instead of the quantity when one is used", () => {
    expect(lineToPayload(blankLine({ productId: "5", altQty: "2", altUnitId: "6", qty: "50", rate: "120" }), p, "sales")).toEqual({ productId: 5, altQty: "2", altUnitId: 6, rate: "120", locationId: null, batchNo: null, expiryDate: null });
  });
});
