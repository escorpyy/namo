import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// Stock Opening = the opening quantity / rate / value lines of Stock products for one (Company, Branch, Fiscal Year).
// Rules: value must equal Quantity x Rate (2 decimals, half up); quantity respects the unit's decimal places; batch / expiry only where the
// product tracks them (and then they are required); (product, location, batch) is unique per branch and year; saves are all-or-nothing;
// nothing can change once the opening balance is locked or the fiscal year is closed.
// Reconciliation: the stock value per branch must equal the opening balance of the product's Closing Stock GL (B/S) before the lock goes through.
// Seed (company 1, head office, FY 2082/083): P001 2000 kg @110 = 220,000.00 (rack A), P002 500 ltr @180 = 90,000.00 (batch B-2082-01, expiry 2027-03-31),
// ledger GL003 opening balance 310,000.00, so stock and ledger agree at the start.
describe.skipIf(!DB_READY)("Stock Opening (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let companyId = 0, branchId = 0, fyId = 0, br1 = 0;
  let otherCompanyId = 0, otherBranch = 0, otherFy = 0;
  const id: Record<string, number> = {};
  const sd: Record<string, number> = {}; // stock detail ids
  const productIds: number[] = [];
  let otherProduct = 0, otherSub = 0, otherGroup = 0, otherUnit = 0;
  let seedLineIds = new Set<number>();
  let setClosed: (v: boolean) => Promise<void>;
  const tag = uniq();

  const qs = (c = companyId, b = branchId, f = fyId) => `companyId=${c}&branchId=${b}&fiscalYearId=${f}`;
  const get = async (b = branchId, c = companyId, f = fyId) => (await call("GET", `/api/stock-opening?${qs(c, b, f)}`)).body;
  const put = (body: Record<string, unknown>, b = branchId, c = companyId, f = fyId) => call("PUT", "/api/stock-opening", { companyId: c, branchId: b, fiscalYearId: f, ...body });
  const mine = async (sdId: number, b = branchId) => ((await get(b)).lines as any[]).filter((l) => l.stockDetailId === sdId);
  const row = (sdId: number, quantity: string | number, rate: string | number, value: string, extra: Record<string, unknown> = {}) => ({ stockDetailId: sdId, locationId: null, quantity, rate, value, ...extra });
  const lock = (force = false) => call("POST", "/api/opening-balance/lock", { companyId, fiscalYearId: fyId, ...(force ? { force: true } : {}) });
  const unlock = () => call("POST", "/api/opening-balance/unlock", { companyId, fiscalYearId: fyId });

  const makeProduct = async (over: Record<string, unknown>) => {
    const r = await call("POST", `/api/masters/products?companyId=${companyId}`, {
      type: "STOCK", isActive: true, tracksBatch: false, tracksExpiry: false, productSubGroupId: id.sgRice, unitId: id.pcs, valuationMethod: "WEIGHTED_AVERAGE", closingBSGLId: id.closeBS, ...over,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    productIds.push(r.body.id);
    return r.body.id as number;
  };
  const sdOf = async (productId: number) => ((await get()).products as any[]).find((p) => p.productId === productId).stockDetailId as number;

  // Remove every line a test added, keep the seeded ones, and make sure the year is open and unlocked again.
  const reset = async () => {
    await setClosed(false);
    await unlock(); // 409 when not locked is fine
    const ho = await get();
    const extra = (ho.lines as any[]).filter((l) => !seedLineIds.has(l.id)).map((l) => l.id);
    if (extra.length) await put({ deletes: extra });
    for (const [b, c, f] of [[br1, companyId, fyId], [otherBranch, otherCompanyId, otherFy]] as const) {
      const lines = ((await get(b, c, f)).lines as any[]).map((l) => l.id);
      if (lines.length) await put({ deletes: lines }, b, c, f);
    }
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ companyId, branchId, fyId } = await seededContext(call));
    const ctx = (await call("GET", "/api/context")).body;
    const co = ctx.companies.find((c: any) => c.id === companyId);
    br1 = co.branches.find((b: any) => !b.isHeadOffice).id;
    const other = ctx.companies.find((c: any) => c.id !== companyId);
    otherCompanyId = other.id;
    otherBranch = other.branches[0].id;
    otherFy = other.fiscalYears[0].id;

    const rows = async (key: string) => (await call("GET", `/api/masters/${key}?companyId=${companyId}`)).body as any[];
    const idByCode = async (key: string, code: string) => (await rows(key)).find((r) => r.code === code).id as number;
    id.sgRice = (await rows("product-sub-groups")).find((s) => s.name === "Rice & Grains").id;
    id.pcs = await idByCode("product-units", "PCS");
    id.kg = await idByCode("product-units", "KG");
    id.closeBS = await idByCode("general-ledger", "GL003");
    id.gd1 = await idByCode("locations", "GD1");
    id.rackA = await idByCode("locations", "GD1-A");
    id.rackB = await idByCode("locations", "GD1-B");

    // Three throw-away stock products in PCS (0 decimals): plain, batch-only, and one without a Closing Stock GL
    sd.pcs = await sdOf(await makeProduct({ code: `T1${tag}`, description: "Test plain item" }));
    sd.batch = await sdOf(await makeProduct({ code: `T2${tag}`, description: "Test batch item", tracksBatch: true }));
    sd.noGl = await sdOf(await makeProduct({ code: `T3${tag}`, description: "Test item without stock GL", closingBSGLId: null }));
    const seeded = (await get()).products as any[];
    sd.p001 = seeded.find((p) => p.code === "P001").stockDetailId;
    sd.p002 = seeded.find((p) => p.code === "P002").stockDetailId;
    seedLineIds = new Set(((await get()).lines as any[]).map((l) => l.id));

    // A product in the second company (it has no master data, so its group / unit are created here)
    const g = await call("POST", `/api/masters/product-groups?companyId=${otherCompanyId}`, { code: `G${tag}`, name: `Other group ${tag}`, isActive: true });
    otherGroup = g.body.id;
    const s = await call("POST", `/api/masters/product-sub-groups?companyId=${otherCompanyId}`, { productGroupId: otherGroup, code: `SG${tag}`, name: `Other sub ${tag}`, isActive: true });
    otherSub = s.body.id;
    const u = await call("POST", `/api/masters/product-units?companyId=${otherCompanyId}`, { code: `U${tag}`, name: `Other unit ${tag}`, decimalPlaces: 2, isActive: true });
    otherUnit = u.body.id;
    const p = await call("POST", `/api/masters/products?companyId=${otherCompanyId}`, {
      type: "STOCK", isActive: true, tracksBatch: false, tracksExpiry: false, code: `O${tag}`, description: "Other company item", productSubGroupId: otherSub, unitId: otherUnit, valuationMethod: "FIFO",
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    otherProduct = p.body.id;
    sd.other = ((await get(otherBranch, otherCompanyId, otherFy)).products as any[]).find((x) => x.productId === otherProduct).stockDetailId;

    const { db } = await import("../server/db");
    const { fiscalYear } = await import("../server/db/schema");
    const { eq } = await import("drizzle-orm");
    setClosed = async (v) => { await db.update(fiscalYear).set({ isClosed: v }).where(eq(fiscalYear.id, fyId)); };
  });
  afterEach(reset);
  afterAll(async () => {
    await reset();
    for (const pid of productIds.reverse()) await call("DELETE", `/api/masters/products/${pid}`);
    if (otherProduct) await call("DELETE", `/api/masters/products/${otherProduct}`);
    if (otherSub) await call("DELETE", `/api/masters/product-sub-groups/${otherSub}`);
    if (otherGroup) await call("DELETE", `/api/masters/product-groups/${otherGroup}`);
    if (otherUnit) await call("DELETE", `/api/masters/product-units/${otherUnit}`);
    await close();
  });

  describe("GET", () => {
    it("requires companyId, branchId and fiscalYearId", async () => {
      for (const missing of ["companyId", "branchId", "fiscalYearId"]) {
        const params = { companyId, branchId, fiscalYearId: fyId } as Record<string, number | string>;
        delete params[missing];
        const r = await call("GET", `/api/stock-opening?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`);
        expect(r.status, missing).toBe(400);
        expect(r.body.message).toMatch(new RegExp(missing));
      }
      expect((await call("GET", `/api/stock-opening?companyId=abc&branchId=${branchId}&fiscalYearId=${fyId}`)).status).toBe(400);
    });

    it("404 for a fiscal year or branch that does not belong to the company", async () => {
      expect((await call("GET", `/api/stock-opening?${qs(companyId, branchId, otherFy)}`)).status).toBe(404);
      expect((await call("GET", `/api/stock-opening?${qs(companyId, otherBranch, fyId)}`)).status).toBe(404);
      expect((await call("GET", `/api/stock-opening?${qs(companyId, 999999, fyId)}`)).status).toBe(404);
      expect((await call("GET", `/api/stock-opening?${qs(companyId, branchId, 999999)}`)).status).toBe(404);
    });

    it("returns the year flags, only Stock products with unit and tracking info, locations, the seeded lines and the stock ledger balance", async () => {
      const d = await get();
      expect(d.fiscalYear.id).toBe(fyId);
      expect(d.fiscalYear.isClosed).toBe(false);
      expect(d.fiscalYear.isOpeningBalanceLocked).toBe(false);
      const codes = (d.products as any[]).map((p) => p.code);
      expect(codes).toEqual(expect.arrayContaining(["P001", "P002"]));
      for (const notStock of ["P003", "P004", "P005", "P006"]) expect(codes).not.toContain(notStock);
      const p001 = (d.products as any[]).find((p) => p.code === "P001");
      expect([p001.unitCode, p001.decimals, p001.tracksBatch]).toEqual(["KG", 3, false]);
      const p002 = (d.products as any[]).find((p) => p.code === "P002");
      expect([p002.unitCode, p002.decimals, p002.tracksBatch, p002.tracksExpiry]).toEqual(["LTR", 2, true, true]);
      expect((d.locations as any[]).map((l) => l.code)).toEqual(expect.arrayContaining(["GD1", "GD1-A", "GD1-B"]));

      const l1 = (d.lines as any[]).find((l) => l.stockDetailId === sd.p001);
      expect([Number(l1.quantity), Number(l1.rate), Number(l1.value), l1.locationId, l1.batchNo]).toEqual([2000, 110, 220000, id.rackA, null]);
      const l2 = (d.lines as any[]).find((l) => l.stockDetailId === sd.p002);
      expect([Number(l2.quantity), Number(l2.value), l2.batchNo]).toEqual([500, 90000, "B-2082-01"]);
      expect(String(l2.expiryDate).startsWith("2027-03-31")).toBe(true);

      const gl = (d.ledgers as any[]).find((x) => x.code === "GL003");
      expect(gl.balance).toBe("310000.00");
    });

    it("lines are per branch: another branch starts empty and its ledger balance is zero", async () => {
      const d = await get(br1);
      expect(d.lines).toEqual([]);
      const gl = (d.ledgers as any[]).find((x) => x.code === "GL003");
      expect(Number(gl.balance)).toBe(0);
    });

    it("is scoped to the company: the other company sees neither company 1's products nor lines", async () => {
      const d = await get(otherBranch, otherCompanyId, otherFy);
      expect((d.products as any[]).map((p) => p.productId)).toEqual([otherProduct]);
      expect(d.lines).toEqual([]);
    });
  });

  describe("PUT: request shape", () => {
    it("needs ids and something to save", async () => {
      expect((await call("PUT", "/api/stock-opening", { branchId, fiscalYearId: fyId, upserts: [row(sd.pcs, 1, 1, "1.00")] })).status).toBe(400);
      const nothing = await put({});
      expect(nothing.status).toBe(400);
      expect(nothing.body.message).toMatch(/Nothing to save/);
      expect((await put({ upserts: [], deletes: [] })).status).toBe(400);
    });

    it("a save of 1,000 rows gets as far as validation (here: the same key 1,000 times is a 409, not a size error)", async () => {
      const r = await put({ upserts: Array.from({ length: 1000 }, () => row(sd.pcs, 1, 1, "1.00")) });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/appears twice/);
    });

    // KNOWN ISSUE (PROJECT_TRACKER ERP-017): the 5000-row cap in stockOpening.ts is unreachable, because express.json() has its default 100 KB limit
    // (about 1,300 rows) and the error handler answers that with 500. `it.fails` keeps CI green and starts FAILING once this is fixed: then change it to a plain `it`.
    it.fails("rejects more than 5000 rows with a clear 400 (today the 100 KB body limit answers 500 first)", async () => {
      const many = await put({ upserts: Array.from({ length: 5001 }, () => row(sd.pcs, 1, 1, "1.00")) });
      expect(many.status).toBe(400);
      expect(many.body.message).toMatch(/Too many rows/);
    });

    it("404 for a fiscal year or branch of another company", async () => {
      expect((await put({ upserts: [row(sd.pcs, 1, 1, "1.00")] }, branchId, companyId, otherFy)).status).toBe(404);
      expect((await put({ upserts: [row(sd.pcs, 1, 1, "1.00")] }, otherBranch)).status).toBe(404);
    });
  });

  describe("PUT: quantity, rate and value", () => {
    it.each([
      ["zero quantity", "0", "10", "0.00", /greater than 0/],
      ["negative quantity", "-1", "10", "-10.00", /invalid quantity or rate/],
      ["non-numeric quantity", "abc", "10", "0.00", /invalid quantity or rate/],
      ["scientific notation", "1e3", "10", "10000.00", /invalid quantity or rate/],
      ["empty quantity", "", "10", "0.00", /invalid quantity or rate/],
      ["empty rate", "1", "", "0.00", /invalid quantity or rate/],
      ["negative rate", "1", "-5", "-5.00", /invalid quantity or rate/],
      ["more than 6 decimals in the rate", "1", "1.1234567", "1.12", /invalid quantity or rate/],
    ])("rejects %s", async (_n, quantity, rate, value, msg) => {
      const r = await put({ upserts: [row(sd.pcs, quantity, rate, value)] });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(msg);
      expect(await mine(sd.pcs)).toEqual([]);
    });

    it("quantity may not have more decimals than the unit allows (PCS: 0, KG: 3)", async () => {
      const pcs = await put({ upserts: [row(sd.pcs, "1.5", "10", "15.00")] });
      expect(pcs.status).toBe(400);
      expect(pcs.body.message).toMatch(/at most 0 decimal/);
      const kg = await put({ upserts: [row(sd.p001, "1.2345", "10", "12.35", { locationId: id.rackB })] });
      expect(kg.status).toBe(400);
      expect(kg.body.message).toMatch(/at most 3 decimal/);
      const kgOk = await put({ upserts: [row(sd.p001, "1.234", "10", "12.34", { locationId: id.rackB })] });
      expect(kgOk.status).toBe(200);
    });

    it("value must equal Quantity x Rate rounded half-up to 2 decimals, written with exactly 2 decimals", async () => {
      const wrong = await put({ upserts: [row(sd.pcs, 3, "10.5", "31.51")] });
      expect(wrong.status).toBe(400);
      expect(wrong.body.message).toMatch(/does not match Quantity × Rate \(31\.50\)/);
      expect((await put({ upserts: [row(sd.pcs, 3, "10.5", "31.5")] })).status).toBe(400); // "31.5" is not the 2-decimal form
      expect((await put({ upserts: [row(sd.pcs, 3, "10.5", "31.50")] })).status).toBe(200);
      // 3 x 0.125 = 0.375 -> 0.38 (half up); 0.37 is refused
      expect((await put({ upserts: [row(sd.pcs, 3, "0.125", "0.37", { locationId: id.gd1 })] })).status).toBe(400);
      expect((await put({ upserts: [row(sd.pcs, 3, "0.125", "0.38", { locationId: id.gd1 })] })).status).toBe(200);
      const lines = await mine(sd.pcs);
      expect(lines.map((l) => Number(l.value)).sort()).toEqual([0.38, 31.5]);
    });

    it("accepts numbers as well as strings and stores quantity, rate and value exactly", async () => {
      const r = await put({ upserts: [row(sd.pcs, 7, 12.5, "87.50")] });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ saved: 1, deleted: 0 });
      const [l] = await mine(sd.pcs);
      expect([Number(l.quantity), Number(l.rate), Number(l.value), l.locationId, l.batchNo, l.expiryDate]).toEqual([7, 12.5, 87.5, null, null, null]);
    });
  });

  describe("PUT: batch and expiry", () => {
    const base = (over: Record<string, unknown> = {}) => row(sd.p002, "10", "5", "50.00", { locationId: id.rackA, batchNo: "NEW1", expiryDate: "2027-12-31", ...over });

    it("a batch-tracked product needs a batch number; a product that does not track batches must not have one", async () => {
      const no = await put({ upserts: [base({ batchNo: "" })] });
      expect(no.status).toBe(400);
      expect(no.body.message).toMatch(/batch no is required/);
      expect((await put({ upserts: [base({ batchNo: "   " })] })).status).toBe(400);
      const plain = await put({ upserts: [row(sd.pcs, 1, 1, "1.00", { batchNo: "X1" })] });
      expect(plain.status).toBe(400);
      expect(plain.body.message).toMatch(/batch is not tracked/);
      expect((await put({ upserts: [base({ batchNo: "B".repeat(51) })] })).status).toBe(400);
    });

    it("an expiry-tracked product needs a valid expiry date; a product that does not track expiry must not have one", async () => {
      const no = await put({ upserts: [base({ expiryDate: null })] });
      expect(no.status).toBe(400);
      expect(no.body.message).toMatch(/expiry date is required/);
      const bad = await put({ upserts: [base({ expiryDate: "2027-02-30" })] });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/invalid expiry date/);
      expect((await put({ upserts: [base({ expiryDate: "31/12/2027" })] })).status).toBe(400);
      const plain = await put({ upserts: [row(sd.pcs, 1, 1, "1.00", { expiryDate: "2027-12-31" })] });
      expect(plain.status).toBe(400);
      expect(plain.body.message).toMatch(/expiry is not tracked/);
      const batchOnly = await put({ upserts: [row(sd.batch, 1, 1, "1.00", { batchNo: "BO1", expiryDate: "2027-12-31" })] });
      expect(batchOnly.status).toBe(400);
      expect(batchOnly.body.message).toMatch(/expiry is not tracked/);
    });

    it("saves a batch + expiry line, trims the batch number, and a batch-only product works without expiry", async () => {
      expect((await put({ upserts: [base({ batchNo: "  NEW1  " })] })).status).toBe(200);
      const [l] = await mine(sd.p002).then((x) => x.filter((r) => !seedLineIds.has(r.id)));
      expect(l.batchNo).toBe("NEW1");
      expect(String(l.expiryDate).startsWith("2027-12-31")).toBe(true);
      expect((await put({ upserts: [row(sd.batch, 4, "2.5", "10.00", { batchNo: "BO1" })] })).status).toBe(200);
    });
  });

  describe("PUT: links must belong to the company", () => {
    it("an unknown product, or a product of another company, is refused", async () => {
      const ghost = await put({ upserts: [row(999999, 1, 1, "1.00")] });
      expect(ghost.status).toBe(400);
      expect(ghost.body.message).toMatch(/Product not found in this company/);
      expect((await put({ upserts: [row(sd.other, 1, 1, "1.00")] })).status).toBe(400); // company 2's product into company 1
      expect((await put({ upserts: [row(sd.pcs, 1, 1, "1.00")] }, otherBranch, otherCompanyId, otherFy)).status).toBe(400); // company 1's product into company 2
      expect((await put({ upserts: [{ quantity: 1, rate: 1, value: "1.00" }] })).status).toBe(400); // no stockDetailId
    });

    it("an unknown location, or a location of another company, is refused", async () => {
      const ghost = await put({ upserts: [row(sd.pcs, 1, 1, "1.00", { locationId: 999999 })] });
      expect(ghost.status).toBe(400);
      expect(ghost.body.message).toMatch(/Location not found in this company/);
      const foreign = await put({ upserts: [row(sd.other, 1, 1, "1.00", { locationId: id.gd1 })] }, otherBranch, otherCompanyId, otherFy);
      expect(foreign.status).toBe(400);
      expect(foreign.body.message).toMatch(/Location not found in this company/);
    });

    it("the other company can save its own lines, and they never show up in company 1", async () => {
      expect((await put({ upserts: [row(sd.other, "2.5", "4", "10.00")] }, otherBranch, otherCompanyId, otherFy)).status).toBe(200);
      expect((await get(otherBranch, otherCompanyId, otherFy)).lines).toHaveLength(1);
      expect(((await get()).lines as any[]).some((l) => l.stockDetailId === sd.other)).toBe(false);
    });

    it("rows to update or delete must belong to this branch and fiscal year", async () => {
      const seededId = [...seedLineIds][0];
      const upd = await put({ upserts: [row(sd.pcs, 1, 1, "1.00", { id: seededId })] }, br1); // a head-office row id used from another branch
      expect(upd.status).toBe(400);
      expect(upd.body.message).toMatch(/Row to update not found/);
      const del = await put({ deletes: [seededId] }, br1);
      expect(del.status).toBe(400);
      expect(del.body.message).toMatch(/Row to delete not found/);
      expect((await put({ deletes: [999999] })).status).toBe(400);
      expect(((await get()).lines as any[]).some((l) => l.id === seededId)).toBe(true); // still there
    });
  });

  describe("PUT: uniqueness of (product, location, batch)", () => {
    it("the same product / location / batch twice in one save is 409, and nothing is saved", async () => {
      const r = await put({ upserts: [row(sd.pcs, 1, 1, "1.00", { locationId: id.gd1 }), row(sd.pcs, 2, 1, "2.00", { locationId: id.gd1 })] });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/appears twice/);
      expect(await mine(sd.pcs)).toEqual([]);
      expect((await put({ upserts: [row(sd.pcs, 1, 1, "1.00"), row(sd.pcs, 2, 1, "2.00")] })).status).toBe(409); // no location counts as a location too
    });

    it("a line that already exists in this branch cannot be added again", async () => {
      const r = await put({ upserts: [row(sd.p001, 1, 1, "1.00", { locationId: id.rackA })] }); // seeded P001 @ rack A
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/P001/);
      expect((await mine(sd.p001))).toHaveLength(1);
    });

    it("the batch number is compared case-insensitively", async () => {
      const r = await put({ upserts: [row(sd.p002, 1, 1, "1.00", { locationId: id.gd1, batchNo: "b-2082-01", expiryDate: "2027-03-31" })] }); // seeded P002 batch B-2082-01 @ GD1
      expect(r.status).toBe(409);
    });

    it("a different location, a different batch, or no location at all are different lines", async () => {
      const ok = await put({
        upserts: [
          row(sd.pcs, 1, 1, "1.00"),
          row(sd.pcs, 1, 1, "1.00", { locationId: id.gd1 }),
          row(sd.pcs, 1, 1, "1.00", { locationId: id.rackB }),
          row(sd.p002, 1, 1, "1.00", { locationId: id.gd1, batchNo: "B-2082-02", expiryDate: "2027-03-31" }), // same place as the seeded row, new batch
        ],
      });
      expect(ok.status).toBe(200);
      expect(ok.body.saved).toBe(4);
      expect(await mine(sd.pcs)).toHaveLength(3);
    });

    it("the same product can be opened in two branches", async () => {
      expect((await put({ upserts: [row(sd.pcs, 3, 2, "6.00")] })).status).toBe(200);
      expect((await put({ upserts: [row(sd.pcs, 5, 2, "10.00")] }, br1)).status).toBe(200);
      expect((await mine(sd.pcs)).map((l) => Number(l.quantity))).toEqual([3]);
      expect((await mine(sd.pcs, br1)).map((l) => Number(l.quantity))).toEqual([5]);
    });
  });

  describe("PUT: update and delete", () => {
    it("updates a line by id (no duplicate row), and keeping its own key is not a conflict", async () => {
      await put({ upserts: [row(sd.pcs, 2, 10, "20.00", { locationId: id.gd1 })] });
      const [l] = await mine(sd.pcs);
      const r = await put({ upserts: [row(sd.pcs, 4, 10, "40.00", { id: l.id, locationId: id.gd1 })] });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ saved: 1, deleted: 0 });
      const after = await mine(sd.pcs);
      expect(after).toHaveLength(1);
      expect([after[0].id, Number(after[0].quantity), Number(after[0].value)]).toEqual([l.id, 4, 40]);
    });

    it("moving a line onto the key of another existing line is 409 and leaves both unchanged", async () => {
      await put({ upserts: [row(sd.pcs, 1, 1, "1.00", { locationId: id.gd1 }), row(sd.pcs, 2, 1, "2.00", { locationId: id.rackB })] });
      const [a, b] = await mine(sd.pcs);
      const r = await put({ upserts: [row(sd.pcs, 9, 1, "9.00", { id: b.id, locationId: id.gd1 })] });
      expect(r.status).toBe(409);
      const after = await mine(sd.pcs);
      expect(after.map((l) => [l.id, l.locationId, Number(l.quantity)])).toEqual([[a.id, id.gd1, 1], [b.id, id.rackB, 2]]);
    });

    it("delete + re-add of the same key in one save works; counts are reported", async () => {
      await put({ upserts: [row(sd.pcs, 2, 10, "20.00", { locationId: id.gd1 })] });
      const [l] = await mine(sd.pcs);
      const r = await put({ deletes: [l.id], upserts: [row(sd.pcs, 6, 10, "60.00", { locationId: id.gd1 })] });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ saved: 1, deleted: 1 });
      const after = await mine(sd.pcs);
      expect(after).toHaveLength(1);
      expect(Number(after[0].quantity)).toBe(6);
      expect((await put({ deletes: [after[0].id] })).body).toEqual({ saved: 0, deleted: 1 });
      expect(await mine(sd.pcs)).toEqual([]);
    });

    it("a save is all-or-nothing: one bad row means none of the rows (or deletes) are applied", async () => {
      await put({ upserts: [row(sd.pcs, 2, 10, "20.00")] });
      const [keep] = await mine(sd.pcs);
      const r = await put({ deletes: [keep.id], upserts: [row(sd.batch, 1, 1, "1.00", { batchNo: "OK1" }), row(sd.pcs, 1, 1, "9.99", { locationId: id.gd1 })] }); // last row: value mismatch
      expect(r.status).toBe(400);
      expect((await mine(sd.pcs)).map((l) => l.id)).toEqual([keep.id]); // delete not applied
      expect(await mine(sd.batch)).toEqual([]); // first row not saved
    });
  });

  describe("PUT: locked and closed years", () => {
    it("is refused while the opening balance is locked, for saves and deletes, and works again after unlock", async () => {
      expect((await lock()).status).toBe(200); // the seed is balanced and stock matches the ledger
      try {
        expect((await get()).fiscalYear.isOpeningBalanceLocked).toBe(true);
        const save = await put({ upserts: [row(sd.pcs, 1, 1, "1.00")] });
        expect(save.status).toBe(409);
        expect(save.body.message).toMatch(/locked/);
        expect((await put({ deletes: [[...seedLineIds][0]] })).status).toBe(409);
        expect(await get()).toHaveProperty("lines"); // reading is still fine
      } finally {
        expect((await unlock()).status).toBe(200);
      }
      expect((await put({ upserts: [row(sd.pcs, 1, 1, "1.00")] })).status).toBe(200);
    });

    it("is refused in a closed fiscal year, while reading still works", async () => {
      await setClosed(true);
      const r = await put({ upserts: [row(sd.pcs, 1, 1, "1.00")] });
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/closed/);
      const d = await get();
      expect(d.fiscalYear.isClosed).toBe(true);
    });
  });

  describe("reconciliation with the stock ledger (checked when the opening balance is locked)", () => {
    it("matches at the seed baseline, so the lock goes through without force", async () => {
      const r = await lock();
      expect(r.status).toBe(200);
      await unlock();
    });

    it("refuses the lock when the stock value differs from the ledger, naming branch, ledger and both amounts", async () => {
      await put({ upserts: [row(sd.pcs, 10, 10, "100.00")] }); // product's Closing Stock GL is GL003: stock 310,100.00 vs ledger 310,000.00
      const r = await lock();
      expect(r.status).toBe(409);
      expect(r.body.field).toBe("stockMismatch");
      expect(r.body.message).toMatch(/Main Branch · GL003: stock 310100\.00 vs ledger 310000\.00/);
      expect((await get()).fiscalYear.isOpeningBalanceLocked).toBe(false);
    });

    it("force locks anyway", async () => {
      await put({ upserts: [row(sd.pcs, 10, 10, "100.00")] });
      expect((await lock()).status).toBe(409);
      const forced = await lock(true);
      expect(forced.status).toBe(200);
      expect((await get()).fiscalYear.isOpeningBalanceLocked).toBe(true);
    });

    it("stock of a product without a Closing Stock GL is reported as its own mismatch", async () => {
      await put({ upserts: [row(sd.noGl, 5, 10, "50.00")] });
      const r = await lock();
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/\(products without Closing Stock GL\): stock 50\.00 vs ledger 0\.00/);
    });

    it("is checked per branch: stock in another branch without any ledger opening there is a mismatch", async () => {
      await put({ upserts: [row(sd.pcs, 1, 10, "10.00")] }, br1);
      const r = await lock();
      expect(r.status).toBe(409);
      expect(r.body.message).toMatch(/Birgunj Branch · GL003: stock 10\.00 vs ledger 0\.00/);
    });

    it("removing the extra stock brings the lock back", async () => {
      await put({ upserts: [row(sd.pcs, 10, 10, "100.00")] });
      expect((await lock()).status).toBe(409);
      const [l] = await mine(sd.pcs);
      await put({ deletes: [l.id] });
      expect((await lock()).status).toBe(200);
    });
  });
});
