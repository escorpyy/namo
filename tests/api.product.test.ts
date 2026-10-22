import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Product = one screen, one header row (Product) + one detail table chosen by Type (Stock / Non-Stock / Service / Fixed Asset / Bundle),
// plus child rows (Alternate Units, Bundle Components), all saved in one transaction.
// Seed (company 1): P001 Basmati Rice (STOCK, alt unit Box), P002 Sunflower Oil (STOCK, batch + expiry), P003 SERVICE, P004 NON_STOCK,
// P005 FIXED_ASSET, P006 Festival Pack (BUNDLE of P001 x5 + P002 x2); opening stock rows for P001 and P002 in the head office.
// Company 2 has no master data, so the cross-company tests create a small product group / unit / product there and remove them again.
describe.skipIf(!DB_READY)("Product master (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, otherCompanyId = 0, branchId = 0, fyId = 0;
  const id: Record<string, number> = {}; // looked-up seed ids: units, groups, ledgers...
  let otherSubGroup = 0, otherUnit = 0, otherGroup = 0, otherStock = 0;
  const created: number[] = []; // product ids, deleted in afterAll (newest first)
  const tag = uniq();

  const rows = async (key: string, cid = companyId) => (await call("GET", `/api/masters/${key}?companyId=${cid}`)).body as any[];
  const idByCode = async (key: string, code: string) => (await rows(key)).find((r) => r.code === code).id as number;
  const list = () => rows("products");
  const byCode = async (code: string) => (await list()).find((p) => p.code === code);

  const post = async (body: Record<string, unknown>, cid = companyId) => {
    const r = await call("POST", `/api/masters/products?companyId=${cid}`, body);
    if (r.status === 201 && cid === companyId) created.push(r.body.id);
    return r;
  };
  const put = (pid: number, body: Record<string, unknown>) => call("PUT", `/api/masters/products/${pid}`, body);

  // Minimal valid payloads. Every checkbox must be sent (the schema treats them as required booleans).
  const common = { isActive: true, tracksBatch: false, tracksExpiry: false };
  const stock = (over: Record<string, unknown> = {}) => ({
    ...common, type: "STOCK", code: `S${tag}`, description: "Test stock item", productSubGroupId: id.sgRice, unitId: id.kg, valuationMethod: "WEIGHTED_AVERAGE", ...over,
  });
  const nonStock = (over: Record<string, unknown> = {}) => ({
    ...common, type: "NON_STOCK", code: `N${tag}`, description: "Test non-stock item", productSubGroupId: id.sgMob, unitId: id.pcs, purchaseGLId: id.purchases, salesGLId: id.sales, ...over,
  });
  const service = (over: Record<string, unknown> = {}) => ({
    ...common, type: "SERVICE", code: `V${tag}`, description: "Test service", productSubGroupId: id.sgMob, purchaseGLId: id.purchases, salesGLId: id.sales, ...over,
  });
  const asset = (over: Record<string, unknown> = {}) => ({
    ...common, type: "FIXED_ASSET", code: `F${tag}`, description: "Test asset", productSubGroupId: id.sgMob, assetGLId: id.vehicles, accumulatedDeprGLId: id.accDep,
    depreciationExpenseGLId: id.depExp, salvageValue: 0, accumulatedDepreciation: 0, depreciationMethod: "STRAIGHT_LINE", ...over,
  });
  const bundle = (over: Record<string, unknown> = {}) => ({
    ...common, type: "BUNDLE", code: `B${tag}`, description: "Test bundle", productSubGroupId: id.sgRice, salesGLId: id.sales,
    components: [{ componentProductId: id.p001, quantity: 2 }], ...over,
  });

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId, fyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    otherCompanyId = ctx.companies.find((c: any) => c.id !== companyId).id;

    const sgs = await rows("product-sub-groups");
    id.sgRice = sgs.find((s) => s.name === "Rice & Grains").id;
    id.sgMob = sgs.find((s) => s.name === "Mobiles").id;
    for (const [k, c] of [["kg", "KG"], ["pcs", "PCS"], ["box", "BOX"], ["ltr", "LTR"]] as const) id[k] = await idByCode("product-units", c);
    id.vat = await idByCode("tax-rates", "VAT13");
    id.trd = await idByCode("stock-categories", "TRD");
    id.gd1 = await idByCode("locations", "GD1");
    id.rackA = await idByCode("locations", "GD1-A");
    for (const [k, c] of [["sales", "GL020"], ["purchases", "GL040"], ["vehicles", "GL060"], ["accDep", "GL061"], ["depExp", "GL062"], ["closeBS", "GL003"]] as const)
      id[k] = await idByCode("general-ledger", c);
    id.vendor = await idByCode("party", "V001");
    id.p001 = await idByCode("products", "P001");
    id.p002 = await idByCode("products", "P002");
    id.p006 = await idByCode("products", "P006");

    // A tiny second-company catalogue (group -> sub group, unit, one stock product)
    const g = await call("POST", `/api/masters/product-groups?companyId=${otherCompanyId}`, { code: `G${tag}`, name: `Other group ${tag}`, isActive: true });
    expect(g.status).toBe(201);
    otherGroup = g.body.id;
    const sg = await call("POST", `/api/masters/product-sub-groups?companyId=${otherCompanyId}`, { productGroupId: otherGroup, code: `SG${tag}`, name: `Other sub ${tag}`, isActive: true });
    expect(sg.status).toBe(201);
    otherSubGroup = sg.body.id;
    const u = await call("POST", `/api/masters/product-units?companyId=${otherCompanyId}`, { code: `U${tag}`, name: `Other unit ${tag}`, decimalPlaces: 0, isActive: true });
    expect(u.status).toBe(201);
    otherUnit = u.body.id;
    const p = await call("POST", `/api/masters/products?companyId=${otherCompanyId}`, stock({ code: `O${tag}`, productSubGroupId: otherSubGroup, unitId: otherUnit }));
    expect(p.status).toBe(201);
    otherStock = p.body.id;
  });
  afterAll(async () => {
    for (const pid of created.reverse()) await call("DELETE", `/api/masters/products/${pid}`);
    if (otherStock) await call("DELETE", `/api/masters/products/${otherStock}`);
    if (otherSubGroup) await call("DELETE", `/api/masters/product-sub-groups/${otherSubGroup}`);
    if (otherGroup) await call("DELETE", `/api/masters/product-groups/${otherGroup}`);
    if (otherUnit) await call("DELETE", `/api/masters/product-units/${otherUnit}`);
    await close();
  });

  it("lists the seeded products with the detail that belongs to each type", async () => {
    const rice = await byCode("P001");
    expect(rice.type).toBe("STOCK");
    expect(rice.unitId).toBe(id.kg);
    expect(rice.valuationMethod).toBe("WEIGHTED_AVERAGE");
    expect(Number(rice.purchaseRate)).toBe(110);
    expect(rice.alternateUnits.map((a: any) => [a.unitId, Number(a.conversionFactor)])).toEqual([[id.box, 25]]);
    expect(rice.stockOpeningCount).toBe(1);
    expect(rice.bundleUseCount).toBe(1); // used inside Festival Pack

    const oil = await byCode("P002");
    expect(oil.tracksBatch).toBe(true);
    expect(oil.tracksExpiry).toBe(true);
    expect(oil.alternateUnits).toEqual([]);

    expect((await byCode("P003")).type).toBe("SERVICE");
    const ns = await byCode("P004");
    expect(ns.type).toBe("NON_STOCK");
    expect(ns.unitId).toBe(id.pcs);
    const fa = await byCode("P005");
    expect(fa.type).toBe("FIXED_ASSET");
    expect(Number(fa.originalCost)).toBe(4500000);
    expect(fa.usefulLifeYears).toBe(8);
    const fest = await byCode("P006");
    expect(fest.type).toBe("BUNDLE");
    expect(Number(fest.bundlePrice)).toBe(1500);
    expect(fest.components.map((c: any) => [c.componentProductId, Number(c.quantity)])).toEqual([[id.p001, 5], [id.p002, 2]]);
  });

  it("requires companyId on list and create", async () => {
    expect((await call("GET", "/api/masters/products")).status).toBe(400);
    expect((await call("POST", "/api/masters/products", stock())).status).toBe(400);
  });

  describe("STOCK", () => {
    it("creates a stock product: code upper-cased, detail + alternate unit saved, fields of other types ignored", async () => {
      const r = await post(stock({
        code: `s${tag}`.toLowerCase(), stockCategoryId: id.trd, locationId: id.gd1, taxRateId: id.vat, defaultVendorId: id.vendor, tracksBatch: true,
        purchaseRate: 99.5, salesRate: 120, mrp: 130, minStock: 5, maxStock: 50, reorderLevel: 10, reorderQty: 20,
        alternateUnits: [{ unitId: id.box, conversionFactor: 12 }],
        bundlePrice: 999, originalCost: 1000, // belong to other types: must be dropped
      }));
      expect(r.status).toBe(201);
      expect(r.body.code).toBe(`S${tag}`);
      expect(r.body.type).toBe("STOCK");
      expect(r.body.unitId).toBe(id.kg);
      expect([r.body.stockCategoryId, r.body.locationId, r.body.taxRateId, r.body.defaultVendorId]).toEqual([id.trd, id.gd1, id.vat, id.vendor]);
      expect(r.body.tracksBatch).toBe(true);
      expect(Number(r.body.purchaseRate)).toBe(99.5);
      expect([Number(r.body.minStock), Number(r.body.maxStock), Number(r.body.reorderLevel), Number(r.body.reorderQty)]).toEqual([5, 50, 10, 20]);
      expect(r.body.alternateUnits.map((a: any) => [a.unitId, Number(a.conversionFactor)])).toEqual([[id.box, 12]]);
      expect(r.body.bundlePrice).toBeNull();
      expect(r.body.originalCost).toBeNull();
    });

    it("requires Unit and Valuation for a stock product", async () => {
      const noUnit = await post(stock({ code: `X1${tag}`, unitId: null }));
      expect(noUnit.status).toBe(400);
      expect(noUnit.body.field).toBe("unitId");
      const noVal = await post(stock({ code: `X2${tag}`, valuationMethod: null }));
      expect(noVal.status).toBe(400);
      expect(noVal.body.field).toBe("valuationMethod");
    });

    it("validates levels, units and numbers", async () => {
      const neg = await post(stock({ code: `X3${tag}`, minStock: -1 }));
      expect(neg.status).toBe(400);
      expect(neg.body.field).toBe("minStock");
      const maxLtMin = await post(stock({ code: `X4${tag}`, minStock: 10, maxStock: 5 }));
      expect(maxLtMin.status).toBe(400);
      expect(maxLtMin.body.field).toBe("maxStock");
      const sameAsBase = await post(stock({ code: `X5${tag}`, alternateUnits: [{ unitId: id.kg, conversionFactor: 2 }] }));
      expect(sameAsBase.status).toBe(400);
      expect(sameAsBase.body.field).toBe("alternateUnits");
      const twice = await post(stock({ code: `X6${tag}`, alternateUnits: [{ unitId: id.box, conversionFactor: 2 }, { unitId: id.box, conversionFactor: 3 }] }));
      expect(twice.status).toBe(400);
      const zeroFactor = await post(stock({ code: `X7${tag}`, alternateUnits: [{ unitId: id.box, conversionFactor: 0 }] }));
      expect(zeroFactor.status).toBe(400);
      const tooPrecise = await post(stock({ code: `X8${tag}`, purchaseRate: 1.1234567 }));
      expect(tooPrecise.status).toBe(400);
      expect((await post(stock({ code: `X9${tag}`, description: "" }))).status).toBe(400);
      expect((await post(stock({ code: `XA${tag}`, type: "GADGET" }))).status).toBe(400);
    });

    it("update replaces the alternate units completely and can toggle tracking", async () => {
      const pid = (await byCode(`S${tag}`)).id;
      const r1 = await put(pid, stock({ code: `S${tag}`, description: "Renamed stock", tracksBatch: false, tracksExpiry: true, alternateUnits: [{ unitId: id.box, conversionFactor: 24 }, { unitId: id.pcs, conversionFactor: 0.5 }] }));
      expect(r1.status).toBe(200);
      expect(r1.body.description).toBe("Renamed stock");
      expect(r1.body.tracksBatch).toBe(false);
      expect(r1.body.tracksExpiry).toBe(true);
      expect(r1.body.alternateUnits.map((a: any) => [a.unitId, Number(a.conversionFactor)])).toEqual([[id.box, 24], [id.pcs, 0.5]]);
      const r2 = await put(pid, stock({ code: `S${tag}`, alternateUnits: [] }));
      expect(r2.status).toBe(200);
      expect(r2.body.alternateUnits).toEqual([]);
    });
  });

  describe("NON_STOCK, SERVICE", () => {
    it("NON_STOCK needs Purchase GL and Sales GL (the one that is missing is named)", async () => {
      const noPurchase = await post(nonStock({ purchaseGLId: null }));
      expect(noPurchase.status).toBe(400);
      expect(noPurchase.body.field).toBe("purchaseGLId");
      const noSales = await post(nonStock({ salesGLId: null }));
      expect(noSales.status).toBe(400);
      expect(noSales.body.field).toBe("salesGLId");
    });

    it("creates a NON_STOCK product; stock-only fields are dropped", async () => {
      const r = await post(nonStock({ taxRateId: id.vat, minStock: 5, alternateUnits: [{ unitId: id.box, conversionFactor: 2 }] }));
      expect(r.status).toBe(201);
      expect(r.body.unitId).toBe(id.pcs);
      expect(r.body.taxRateId).toBe(id.vat);
      expect(r.body.salesGLId).toBe(id.sales);
      expect(r.body.purchaseGLId).toBe(id.purchases);
      expect(r.body.minStock).toBeNull();
      expect(r.body.alternateUnits).toEqual([]);
    });

    it("creates a SERVICE product with and without a unit; stock-only fields are dropped", async () => {
      const without = await post(service({ code: `V1${tag}` }));
      expect(without.status).toBe(201);
      expect(without.body.serviceUnitId).toBeNull();
      const withUnit = await post(service({ code: `V2${tag}`, serviceUnitId: id.pcs, valuationMethod: "FIFO", salesRate: 10 }));
      expect(withUnit.status).toBe(201);
      expect(withUnit.body.serviceUnitId).toBe(id.pcs);
      expect(withUnit.body.valuationMethod).toBeNull();
      expect(withUnit.body.salesRate).toBeNull();
    });

    it("SERVICE needs Purchase GL and Sales GL as well", async () => {
      const r = await post(service({ code: `V3${tag}`, salesGLId: null }));
      expect(r.status).toBe(400);
      expect(r.body.field).toBe("salesGLId");
    });
  });

  describe("FIXED_ASSET", () => {
    it("creates a fixed asset with its three ledgers and depreciation details", async () => {
      const r = await post(asset({ purchaseDate: "2025-08-01", originalCost: 100000, salvageValue: 10000, usefulLifeYears: 5, accumulatedDepreciation: 20000, locationId: id.gd1 }));
      expect(r.status).toBe(201);
      expect([r.body.assetGLId, r.body.accumulatedDeprGLId, r.body.depreciationExpenseGLId]).toEqual([id.vehicles, id.accDep, id.depExp]);
      expect(Number(r.body.originalCost)).toBe(100000);
      expect(Number(r.body.salvageValue)).toBe(10000);
      expect(Number(r.body.accumulatedDepreciation)).toBe(20000);
      expect(r.body.usefulLifeYears).toBe(5);
      expect(String(r.body.purchaseDate).startsWith("2025-08-01")).toBe(true);
      expect(r.body.locationId).toBe(id.gd1);
    });

    it("requires the three ledgers (the missing one is named)", async () => {
      for (const f of ["assetGLId", "accumulatedDeprGLId", "depreciationExpenseGLId"]) {
        const r = await post(asset({ code: `F${f.length}${tag}`, [f]: null }));
        expect(r.status, f).toBe(400);
        expect(r.body.field).toBe(f);
      }
    });

    it("salvage value and accumulated depreciation cannot exceed the original cost", async () => {
      const salvage = await post(asset({ code: `F8${tag}`, originalCost: 1000, salvageValue: 1001 }));
      expect(salvage.status).toBe(400);
      expect(salvage.body.field).toBe("salvageValue");
      const accum = await post(asset({ code: `F9${tag}`, originalCost: 1000, accumulatedDepreciation: 1001 }));
      expect(accum.status).toBe(400);
      expect(accum.body.field).toBe("accumulatedDepreciation");
      const equal = await post(asset({ code: `FA${tag}`, originalCost: 1000, salvageValue: 1000, accumulatedDepreciation: 1000 }));
      expect(equal.status).toBe(201); // equal is allowed
    });

    it("written-down-value method needs a rate between 0 and 100; straight line does not", async () => {
      const noRate = await post(asset({ code: `FB${tag}`, depreciationMethod: "WRITTEN_DOWN_VALUE" }));
      expect(noRate.status).toBe(400);
      expect(noRate.body.field).toBe("depreciationRatePercent");
      expect((await post(asset({ code: `FC${tag}`, depreciationMethod: "WRITTEN_DOWN_VALUE", depreciationRatePercent: 101 }))).status).toBe(400);
      const ok = await post(asset({ code: `FD${tag}`, depreciationMethod: "WRITTEN_DOWN_VALUE", depreciationRatePercent: 15 }));
      expect(ok.status).toBe(201);
      expect(Number(ok.body.depreciationRatePercent)).toBe(15);
    });

    it("rejects an impossible purchase date and a zero useful life", async () => {
      expect((await post(asset({ code: `FE${tag}`, purchaseDate: "2025-02-30" }))).status).toBe(400);
      expect((await post(asset({ code: `FF${tag}`, usefulLifeYears: 0 }))).status).toBe(400);
    });
  });

  describe("BUNDLE", () => {
    it("creates a bundle with components and its own price", async () => {
      const r = await post(bundle({ bundlePrice: 500, components: [{ componentProductId: id.p001, quantity: 2.5 }, { componentProductId: id.p002, quantity: 1 }] }));
      expect(r.status).toBe(201);
      expect(Number(r.body.bundlePrice)).toBe(500);
      expect(r.body.salesGLId).toBe(id.sales);
      expect(r.body.components.map((c: any) => [c.componentProductId, Number(c.quantity)])).toEqual([[id.p001, 2.5], [id.p002, 1]]);
    });

    it("needs a Sales GL and at least one component", async () => {
      const noGl = await post(bundle({ code: `B1${tag}`, salesGLId: null }));
      expect(noGl.status).toBe(400);
      expect(noGl.body.field).toBe("salesGLId");
      const none = await post(bundle({ code: `B2${tag}`, components: [] }));
      expect(none.status).toBe(400);
      expect(none.body.field).toBe("components");
    });

    it("rejects a repeated component, a bundle inside a bundle, a zero quantity, and unknown or foreign components", async () => {
      const dup = await post(bundle({ code: `B3${tag}`, components: [{ componentProductId: id.p001, quantity: 1 }, { componentProductId: id.p001, quantity: 2 }] }));
      expect(dup.status).toBe(400);
      expect(dup.body.field).toBe("components");
      const nested = await post(bundle({ code: `B4${tag}`, components: [{ componentProductId: id.p006, quantity: 1 }] }));
      expect(nested.status).toBe(400);
      expect(nested.body.message).toMatch(/another bundle/);
      expect((await post(bundle({ code: `B5${tag}`, components: [{ componentProductId: id.p001, quantity: 0 }] }))).status).toBe(400);
      expect((await post(bundle({ code: `B6${tag}`, components: [{ componentProductId: 999999, quantity: 1 }] }))).status).toBe(400);
      const foreign = await post(bundle({ code: `B7${tag}`, components: [{ componentProductId: otherStock, quantity: 1 }] }));
      expect(foreign.status).toBe(400);
      expect(foreign.body.message).toMatch(/not found in this company/);
    });

    it("a bundle cannot be edited to contain itself, and its components can be replaced", async () => {
      const pid = (await byCode(`B${tag}`)).id;
      const self = await put(pid, bundle({ components: [{ componentProductId: pid, quantity: 1 }] }));
      expect(self.status).toBe(400);
      expect(self.body.message).toMatch(/itself/);
      const r = await put(pid, bundle({ bundlePrice: 650, components: [{ componentProductId: id.p002, quantity: 4 }] }));
      expect(r.status).toBe(200);
      expect(r.body.components.map((c: any) => [c.componentProductId, Number(c.quantity)])).toEqual([[id.p002, 4]]);
      expect(Number(r.body.bundlePrice)).toBe(650);
    });
  });

  describe("code and barcode", () => {
    it("rejects a duplicate code (case-insensitive) with 409, naming the field", async () => {
      const r = await post(stock({ code: `s${tag}`.toLowerCase(), description: "dup" }));
      expect(r.status).toBe(409);
      expect(r.body.field).toBe("code");
    });

    it("rejects a duplicate barcode (case-insensitive) with 409, and allows the same code in another company", async () => {
      const a = await post(nonStock({ code: `BC1${tag}`, barcode: `bar${tag}` }));
      expect(a.status).toBe(201);
      const dup = await post(nonStock({ code: `BC2${tag}`, barcode: `BAR${tag}` }));
      expect(dup.status).toBe(409);
      expect(dup.body.field).toBe("barcode");
      // same code in company 2 is fine (unique per company)
      const other = await call("POST", `/api/masters/products?companyId=${otherCompanyId}`, stock({ code: `BC1${tag}`, productSubGroupId: otherSubGroup, unitId: otherUnit }));
      expect(other.status).toBe(201);
      expect((await call("DELETE", `/api/masters/products/${other.body.id}`)).status).toBe(200);
    });

    it("PUT: keeping your own code is fine, taking another product's code or barcode is 409, unknown id is 404", async () => {
      expect((await put(999999, stock())).status).toBe(404);
      const pid = (await byCode(`BC1${tag}`)).id;
      expect((await put(pid, nonStock({ code: `BC1${tag}`, barcode: `BAR${tag}`, description: "Same keys" }))).status).toBe(200);
      const code409 = await put(pid, nonStock({ code: `S${tag}`, barcode: `BAR${tag}` }));
      expect(code409.status).toBe(409);
      expect(code409.body.field).toBe("code");
      const barcode409 = await put(pid, nonStock({ code: `BC1${tag}`, barcode: "8901000000011" })); // seeded P001
      expect(barcode409.status).toBe(409);
      expect(barcode409.body.field).toBe("barcode");
    });
  });

  describe("links must belong to the same company", () => {
    it("a Sub Group of another company is refused", async () => {
      const r = await post(stock({ code: `L1${tag}` }), otherCompanyId); // company 1's sub group used in company 2
      expect(r.status).toBe(400);
      expect(r.body.field).toBe("productSubGroupId");
      expect((await post(stock({ code: `L2${tag}`, productSubGroupId: 999999 }))).status).toBe(400);
    });

    it("a Unit, Location, Tax Rate, Stock Category or Vendor of another company (or that does not exist) is refused with the field named", async () => {
      const own = { productSubGroupId: otherSubGroup, unitId: otherUnit };
      const cases: [string, Record<string, unknown>][] = [
        ["unitId", { unitId: id.kg }],
        ["locationId", { locationId: id.gd1 }],
        ["taxRateId", { taxRateId: id.vat }],
        ["stockCategoryId", { stockCategoryId: id.trd }],
        ["defaultVendorId", { defaultVendorId: id.vendor }],
      ];
      for (const [field, extra] of cases) {
        const r = await post(stock({ code: `L3${field.length}${tag}`, ...own, ...extra }), otherCompanyId);
        expect(r.status, field).toBe(400);
        expect(r.body.field).toBe(field);
      }
      const ghost = await post(stock({ code: `L4${tag}`, locationId: 999999 }));
      expect(ghost.status).toBe(400);
      expect(ghost.body.field).toBe("locationId");
    });

    it("a ledger of another company is refused (the field is named)", async () => {
      const r = await post(nonStock({ code: `L5${tag}`, productSubGroupId: otherSubGroup, unitId: otherUnit }), otherCompanyId); // company 1's GLs
      expect(r.status).toBe(400);
      expect(["purchaseGLId", "salesGLId"]).toContain(r.body.field);
    });

    it("an alternate unit of another company is refused", async () => {
      const r = await post(stock({ code: `L6${tag}`, alternateUnits: [{ unitId: otherUnit, conversionFactor: 2 }] }));
      expect(r.status).toBe(400);
      expect(r.body.field).toBe("alternateUnits");
    });
  });

  describe("type is fixed after creation", () => {
    it("changing the Type on update is 409 and changes nothing", async () => {
      const row = await byCode(`N${tag}`);
      const r = await put(row.id, service({ code: `N${tag}` }));
      expect(r.status).toBe(409);
      expect(r.body.field).toBe("type");
      expect((await byCode(`N${tag}`)).type).toBe("NON_STOCK");
    });

    it("a failed update leaves the old detail untouched (all-or-nothing)", async () => {
      const row = await byCode(`S${tag}`);
      const before = row.description;
      const bad = await put(row.id, stock({ code: `S${tag}`, description: "Should not stick", alternateUnits: [{ unitId: id.kg, conversionFactor: 2 }] })); // alt = base: refused
      expect(bad.status).toBe(400);
      expect((await byCode(`S${tag}`)).description).toBe(before);
    });
  });

  describe("delete", () => {
    it("unknown id is 404; a plain product is deleted together with its detail rows", async () => {
      expect((await call("DELETE", "/api/masters/products/999999")).status).toBe(404);
      const p = await post(stock({ code: `D1${tag}`, alternateUnits: [{ unitId: id.box, conversionFactor: 6 }] }));
      expect(p.status).toBe(201);
      expect((await call("DELETE", `/api/masters/products/${p.body.id}`)).status).toBe(200);
      expect((await list()).some((x) => x.id === p.body.id)).toBe(false);
      created.splice(created.indexOf(p.body.id), 1);
    });

    it("is blocked while the product is a bundle component, and allowed once it is removed from the bundle", async () => {
      const comp = await post(stock({ code: `D2${tag}` }));
      const b = await post(bundle({ code: `D3${tag}`, components: [{ componentProductId: comp.body.id, quantity: 3 }] }));
      expect([comp.status, b.status]).toEqual([201, 201]);
      const blocked = await call("DELETE", `/api/masters/products/${comp.body.id}`);
      expect(blocked.status).toBe(409);
      expect(blocked.body.message).toMatch(/Bundle component/);
      expect((await put(b.body.id, bundle({ code: `D3${tag}`, components: [{ componentProductId: id.p001, quantity: 1 }] }))).status).toBe(200);
      expect((await call("DELETE", `/api/masters/products/${comp.body.id}`)).status).toBe(200);
      created.splice(created.indexOf(comp.body.id), 1);
    });

    it("is blocked while a Stock Opening row exists, and allowed once that row is removed", async () => {
      const p = await post(stock({ code: `D4${tag}` }));
      expect(p.status).toBe(201);
      const q = `companyId=${companyId}&branchId=${branchId}&fiscalYearId=${fyId}`;
      const sdId = ((await call("GET", `/api/stock-opening?${q}`)).body.products as any[]).find((x) => x.productId === p.body.id).stockDetailId;
      const save = await call("PUT", "/api/stock-opening", { companyId, branchId, fiscalYearId: fyId, upserts: [{ stockDetailId: sdId, locationId: null, quantity: "2", rate: "10", value: "20.00" }] });
      expect(save.status).toBe(200);
      try {
        const blocked = await call("DELETE", `/api/masters/products/${p.body.id}`);
        expect(blocked.status).toBe(409);
        expect(blocked.body.message).toMatch(/Stock Opening row/);
      } finally {
        const line = ((await call("GET", `/api/stock-opening?${q}`)).body.lines as any[]).find((l) => l.stockDetailId === sdId);
        await call("PUT", "/api/stock-opening", { companyId, branchId, fiscalYearId: fyId, deletes: [line.id] });
      }
      expect((await call("DELETE", `/api/masters/products/${p.body.id}`)).status).toBe(200);
      created.splice(created.indexOf(p.body.id), 1);
    });
  });
});
