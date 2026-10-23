import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, seededContext, startApi, uniq, type Res } from "./helpers";

// The purchase documents over HTTP: Order -> Challan -> Bill. The business rules themselves are covered by tests/service.purchase.test.ts;
// these tests prove the ROUTES: they reach the service, scope every document to the company in the URL, refuse wrong input with a 400
// (never a 500), answer { result, document }, and the screens' read side (lists, whole documents, pick-lists) tells the truth.
// The world is built in a throw-away INACTIVE company (it never shows in the header switcher) and removed afterwards.
describe.skipIf(!DB_READY)("Purchase documents (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  let otherCompanyId = 0, seededUserId = 0;
  const tag = uniq();
  const c = (s: string) => `${s}${tag}`.slice(0, 20);
  const W: Record<string, number> = {};
  const NOW = sql`now()`;

  const ins = async (table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const r = (await db.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`)) as any[];
    return r[0].id as number;
  };
  const rowsOf = async (q: any) => (await db.execute(q)) as any[];
  const n2 = (v: any) => Number(v).toFixed(2);

  // ---- URL helpers ----
  const qs = (extra = "") => `companyId=${W.co}${extra}`;
  const base = (kind: string) => `/api/purchase/${kind}`;
  const get = (kind: string, id: number, cid = W.co) => call("GET", `${base(kind)}/${id}?companyId=${cid}`);
  const list = (kind: string, extra = "", cid = W.co) => call("GET", `${base(kind)}?companyId=${cid}${extra}`);
  const act = (kind: string, id: number, action: string, body?: unknown, cid = W.co) => call("POST", `${base(kind)}/${id}/${action}?companyId=${cid}`, body ?? {});
  const del = (kind: string, id: number, cid = W.co) => call("DELETE", `${base(kind)}/${id}?companyId=${cid}`);

  // ---- builders ----
  const orderBody = (over: Record<string, unknown> = {}) => ({
    companyId: W.co, branchId: W.br, orderDate: "2025-10-01", vendorGLId: W.vendor,
    lines: [{ productId: W.rice, qty: 10, rate: 100 }, { productId: W.oil, qty: 5, rate: 200 }], ...over,
  });
  const standardTerms = () => [{ termId: W.tDisc }, { termId: W.tFreight, inputAmount: 100 }, { termId: W.tVat }];
  const mkOrder = async (over: Record<string, unknown> = {}, approve = true) => {
    const r = await call("POST", base("orders"), orderBody(over));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    if (approve) expect((await act("orders", r.body.result.id, "approve")).status).toBe(200);
    return r.body.result as { id: number; orderNumber: string };
  };
  const challanBody = (over: Record<string, unknown> = {}) => ({
    companyId: W.co, branchId: W.br, challanDate: "2025-10-10", vendorGLId: W.vendor, lines: [{ productId: W.rice, qty: 10 }, { productId: W.oil, qty: 5 }], ...over,
  });
  const mkChallan = async (over: Record<string, unknown> = {}, confirm = true) => {
    const r = await call("POST", base("challans"), challanBody(over));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    if (confirm) expect((await act("challans", r.body.result.id, "confirm")).status).toBe(200);
    return r.body.result as { id: number; challanNumber: string };
  };
  const billBody = (over: Record<string, unknown> = {}) => ({
    companyId: W.co, branchId: W.br, invoiceDate: "2025-10-14", vendorGLId: W.vendor,
    lines: [{ productId: W.rice, qty: 10, rate: 100 }, { productId: W.oil, qty: 5, rate: 200 }], ...over,
  });
  const mkBill = async (over: Record<string, unknown> = {}) => {
    const r = await call("POST", base("bills"), billBody(over));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.result as { id: number; invoiceNumber: string };
  };
  const voucherOf = async (jvId: number) => {
    const rows = await rowsOf(sql`select "generalLedgerId" as gl, debit, credit from "JournalVoucherLine" where "journalVoucherId" = ${jvId} order by "lineNumber"`);
    return { rows, dr: n2(rows.reduce((a, r) => a + Number(r.debit), 0)), cr: n2(rows.reduce((a, r) => a + Number(r.credit), 0)) };
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    const ctx = (await call("GET", "/api/context")).body;
    seededUserId = ctx.user.id;
    ({ companyId: otherCompanyId } = (await seededContext(call)) as any);

    W.co = await ins("Company", { code: c("T"), name: `ZZ Purchase Test ${tag}`, isActive: false, updatedAt: NOW });
    W.br = await ins("Branch", { companyId: W.co, code: c("B"), name: "Branch", updatedAt: NOW });
    W.br2 = await ins("Branch", { companyId: W.co, code: c("B2"), name: "Branch Two", updatedAt: NOW });
    W.fy = await ins("FiscalYear", { companyId: W.co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins("AccountGroup", { companyId: W.co, code: c("G"), description: "Grp", type: "EXPENSE", updatedAt: NOW });
    const sg = await ins("AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, normal = "DEBIT", extra: Record<string, unknown> = {}) => ins("GeneralLedger", { companyId: W.co, code: c(code), name: code, accountSubGroupId: sg, normalBalance: normal, updatedAt: NOW, ...extra });
    W.vendor = await gl("VEND", "CREDIT");
    W.vendor2 = await gl("VENDB", "CREDIT");
    W.purchase = await gl("PURCH"); W.vat = await gl("VAT"); W.freight = await gl("FREIGHT"); W.discount = await gl("DISC", "CREDIT"); W.duty = await gl("DUTY");
    W.sub = await ins("SubLedger", { code: c("SL"), name: "Vendor sub", generalLedgerId: W.vendor, updatedAt: NOW });
    W.agent = await ins("Agent", { companyId: W.co, code: c("AG").slice(0, 10), name: "Agent", updatedAt: NOW });
    W.pcs = await ins("ProductUnit", { companyId: W.co, code: c("PCS").slice(0, 10), name: `Pcs ${tag}`, updatedAt: NOW });
    W.box = await ins("ProductUnit", { companyId: W.co, code: c("BOX").slice(0, 10), name: `Box ${tag}`, updatedAt: NOW });
    const pg = await ins("ProductGroup", { companyId: W.co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins("ProductSubGroup", { code: c("PSG"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    const prod = async (code: string, type: string, extra: Record<string, unknown> = {}) => {
      const id = await ins("Product", { companyId: W.co, code: c(code).slice(0, 10), description: code, type, productSubGroupId: psg, updatedAt: NOW });
      if (type === "STOCK") W[`${code}Sd`] = await ins("StockDetail", { productId: id, baseUnitId: W.pcs, purchaseGLId: W.purchase, updatedAt: NOW, ...extra });
      else await ins("NonStockDetail", { productId: id, unitId: W.pcs, salesGLId: W.purchase, purchaseGLId: W.purchase, updatedAt: NOW });
      return id;
    };
    W.rice = await prod("rice", "STOCK"); W.oil = await prod("oil", "STOCK"); W.med = await prod("med", "STOCK", { tracksBatch: true, tracksExpiry: true }); W.consult = await prod("consult", "NON_STOCK");
    await ins("AlternateUnit", { stockDetailId: W.riceSd, unitId: W.box, conversionFactor: 12 });
    W.loc = await ins("Location", { companyId: W.co, code: c("LOC").slice(0, 10), name: "Store", updatedAt: NOW });
    const term = (code: string, o: Record<string, unknown>) => ins("PurchaseTerm", { companyId: W.co, code: c(code), name: code, updatedAt: NOW, ...o });
    W.tDisc = await term("DISC10", { nature: "DEDUCTIVE", sequence: 10, defaultCalcType: "PERCENT", defaultValue: 10, generalLedgerId: W.discount });
    W.tFreight = await term("FRT", { nature: "ADDITIVE", sequence: 20, defaultCalcType: "AMOUNT", distributeToLines: true, allocationBasis: "VALUE", generalLedgerId: W.freight });
    W.tVat = await term("VAT13", { nature: "ADDITIVE", sequence: 30, defaultCalcType: "PERCENT", defaultValue: 13, calcBase: "RUNNING_TOTAL", generalLedgerId: W.vat });
    W.tDuty = await term("DUTY", { nature: "ADDITIVE", category: "ADDITIONAL", sequence: 10, defaultCalcType: "AMOUNT", distributeToLines: true, allocationBasis: "QUANTITY", generalLedgerId: W.duty });
  });

  afterAll(async () => {
    if (W.co) {
      // Everything of the throw-away company, children before parents. Triggers and foreign keys are switched off for this one transaction
      // (the test database user is a superuser) so the order of the deletes does not matter and posted documents can be removed.
      await db.transaction(async (tx: any) => {
        const co = W.co;
        await tx.execute(sql`set local session_replication_role = replica`);
        const byDoc = (child: string, fk: string, parent: string) => tx.execute(sql`delete from ${sql.identifier(child)} where ${sql.identifier(fk)} in (select id from ${sql.identifier(parent)} where "companyId" = ${co})`);
        await tx.execute(sql`delete from "PurchaseDocumentTermAllocation" where "documentTermId" in (select id from "PurchaseDocumentTerm" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "PurchaseDocumentTerm" where "companyId" = ${co}`);
        await byDoc("PurchaseBillImportDetail", "purchaseBillId", "PurchaseBill");
        await byDoc("PurchaseBillLine", "purchaseBillId", "PurchaseBill");
        await tx.execute(sql`delete from "PurchaseBill" where "companyId" = ${co}`);
        await byDoc("JournalVoucherLine", "journalVoucherId", "JournalVoucher");
        await tx.execute(sql`delete from "JournalVoucher" where "companyId" = ${co}`);
        await byDoc("PurchaseChallanLine", "purchaseChallanId", "PurchaseChallan");
        await tx.execute(sql`delete from "PurchaseChallan" where "companyId" = ${co}`);
        await byDoc("PurchaseOrderLine", "purchaseOrderId", "PurchaseOrder");
        await tx.execute(sql`delete from "PurchaseOrder" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "AlternateUnit" where "stockDetailId" in (select sd.id from "StockDetail" sd join "Product" p on p.id = sd."productId" where p."companyId" = ${co})`);
        await tx.execute(sql`delete from "StockDetail" where "productId" in (select id from "Product" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "NonStockDetail" where "productId" in (select id from "Product" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "Product" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "ProductSubGroup" where "productGroupId" in (select id from "ProductGroup" where "companyId" = ${co})`);
        for (const t of ["ProductGroup", "ProductUnit", "Location", "PurchaseTerm", "Agent"]) await tx.execute(sql`delete from ${sql.identifier(t)} where "companyId" = ${co}`);
        await tx.execute(sql`delete from "SubLedger" where "generalLedgerId" in (select id from "GeneralLedger" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "GeneralLedger" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${co})`);
        for (const t of ["AccountGroup", "FiscalYear", "Branch"]) await tx.execute(sql`delete from ${sql.identifier(t)} where "companyId" = ${co}`);
        await tx.execute(sql`delete from "Company" where id = ${co}`);
      });
    }
    await close();
  });

  // =====================================================================================================================
  describe("pick-lists", () => {
    it("lookups: this company's vendors, products (with alternate units and tracking), units, locations, terms and fiscal years only", async () => {
      const r = await call("GET", `/api/purchase/lookups?${qs()}`);
      expect(r.status).toBe(200);
      const b = r.body;
      expect(b.vendors.map((v: any) => v.id)).toEqual(expect.arrayContaining([W.vendor, W.vendor2, W.purchase]));
      expect(b.subLedgers.map((s: any) => s.id)).toEqual([W.sub]);
      expect(b.agents.map((a: any) => a.id)).toEqual([W.agent]);
      const rice = b.products.find((p: any) => p.id === W.rice);
      expect(rice).toMatchObject({ type: "STOCK", baseUnitId: W.pcs, tracksBatch: false });
      expect(rice.alternateUnits).toEqual([{ unitId: W.box, conversionFactor: "12.000000" }]);
      expect(b.products.find((p: any) => p.id === W.med)).toMatchObject({ tracksBatch: true, tracksExpiry: true });
      expect(b.products.find((p: any) => p.id === W.consult)).toMatchObject({ type: "NON_STOCK", baseUnitId: W.pcs });
      expect(b.units.map((u: any) => u.id).sort()).toEqual([W.pcs, W.box].sort());
      expect(b.locations.map((l: any) => l.id)).toEqual([W.loc]);
      expect(b.terms.map((t: any) => t.id).sort()).toEqual([W.tDisc, W.tFreight, W.tVat, W.tDuty].sort());
      expect(b.terms.find((t: any) => t.id === W.tDuty)).toMatchObject({ category: "ADDITIONAL", nature: "ADDITIVE", distributeToLines: true });
      expect(b.fiscalYears).toEqual([{ id: W.fy, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isActive: true, isClosed: false, isCurrent: true }]);
      // nothing of another company leaks in
      const other = (await call("GET", `/api/purchase/lookups?companyId=${otherCompanyId}`)).body;
      const ids = (rows: any[]) => new Set(rows.map((x) => x.id));
      for (const k of ["vendors", "products", "units", "terms", "locations"] as const) {
        const mine = ids(b[k]);
        expect(other[k].some((x: any) => mine.has(x.id)), k).toBe(false);
      }
    });

    it("lookups needs a company", async () => {
      expect((await call("GET", "/api/purchase/lookups")).status).toBe(400);
      expect((await call("GET", "/api/purchase/lookups?companyId=abc")).status).toBe(400);
    });
  });

  // =====================================================================================================================
  describe("purchase order", () => {
    it("create: 201 { result, document } with numbering, priced terms and the line / term detail a screen shows", async () => {
      const r = await call("POST", base("orders"), orderBody({ terms: standardTerms(), remarks: "first" }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.result).toMatchObject({ orderNumber: "0001", fiscalYear: "2082/83", basicAmount: "2000.00", termAmount: "147.00", totalAmount: "2147.00" });
      const d = r.body.document;
      expect(d).toMatchObject({ id: r.body.result.id, status: "DRAFT", orderNumber: "0001", orderDate: "2025-10-01", vendorGLId: W.vendor, vendorCode: c("VEND"), branchName: "Branch", remarks: "first", totalAmount: "2147.00" });
      expect(d.lines).toHaveLength(2);
      expect(d.lines[0]).toMatchObject({ lineNumber: 1, productId: W.rice, productCode: c("rice").slice(0, 10), unitCode: c("PCS").slice(0, 10), qty: "10.000000", rate: "100.000000", basicAmount: "1000.00", received: "0.000000", pendingToReceive: "10.000000", pendingToBill: "10.000000" });
      expect(d.terms.map((t: any) => [t.termCode, t.nature, n2(t.finalAmount)])).toEqual([[c("DISC10"), "DEDUCTIVE", "200.00"], [c("FRT"), "ADDITIVE", "100.00"], [c("VAT13"), "ADDITIVE", "247.00"]]);
      const next = await call("POST", base("orders"), orderBody());
      expect(next.body.result.orderNumber).toBe("0002");
      expect((await get("orders", d.id)).body.orderNumber).toBe("0001");
    });

    it("a draft can be edited with PUT: lines and terms are replaced, totals recomputed, company and branch stay", async () => {
      const o = await mkOrder({ terms: standardTerms() }, false);
      const r = await call("PUT", `${base("orders")}/${o.id}?${qs()}`, { orderDate: "2025-10-02", vendorGLId: W.vendor, lines: [{ productId: W.oil, qty: 1, rate: 50 }], terms: [] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.result).toMatchObject({ id: o.id, orderNumber: o.orderNumber, basicAmount: "50.00", totalAmount: "50.00" });
      expect(r.body.document.lines).toHaveLength(1);
      expect(r.body.document.terms).toEqual([]);
      expect(r.body.document).toMatchObject({ orderDate: "2025-10-02", branchId: W.br, companyId: W.co });
      // a body that names another branch does not move the order
      const moved = await call("PUT", `${base("orders")}/${o.id}?${qs()}`, { branchId: W.br2, companyId: otherCompanyId, orderDate: "2025-10-02", vendorGLId: W.vendor, lines: [{ productId: W.oil, qty: 1, rate: 50 }] });
      expect(moved.status).toBe(200);
      expect(moved.body.document).toMatchObject({ branchId: W.br, companyId: W.co });
    });

    it("approve, then it is frozen: PUT and DELETE are refused (409), close and cancel follow the status rules", async () => {
      const o = await mkOrder();
      const a = await get("orders", o.id);
      expect(a.body.status).toBe("APPROVED");
      expect((await call("PUT", `${base("orders")}/${o.id}?${qs()}`, orderBody())).status).toBe(409);
      const d = await del("orders", o.id);
      expect(d.status).toBe(409);
      expect(d.body.message).toMatch(/only a DRAFT can be deleted/);
      expect((await act("orders", o.id, "approve")).status).toBe(409);
      const cl = await act("orders", o.id, "close");
      expect(cl.status).toBe(200);
      expect(cl.body).toMatchObject({ result: { id: o.id, status: "CLOSED" }, document: { status: "CLOSED" } });
      expect((await act("orders", o.id, "cancel")).status).toBe(409);
      const o2 = await mkOrder({}, false);
      const ca = await act("orders", o2.id, "cancel");
      expect(ca.body.document.status).toBe("CANCELLED");
    });

    it("delete removes a draft with its lines and terms; afterwards it is gone (404)", async () => {
      const o = await mkOrder({ terms: standardTerms() }, false);
      const d = await del("orders", o.id);
      expect(d.status).toBe(200);
      expect(d.body.result).toEqual({ id: o.id, deleted: true });
      expect((await get("orders", o.id)).status).toBe(404);
      const left = await rowsOf(sql`select (select count(*) from "PurchaseOrderLine" where "purchaseOrderId" = ${o.id})::int as l, (select count(*) from "PurchaseDocumentTerm" where "documentType" = 'PURCHASE_ORDER' and "documentId" = ${o.id})::int as t`);
      expect(left[0]).toEqual({ l: 0, t: 0 });
    });

    it("service refusals come through with their status and message (an order needs a line; a fiscal year must cover the date)", async () => {
      const none = await call("POST", base("orders"), orderBody({ lines: [] }));
      expect(none.status).toBe(400);
      expect(none.body.message).toMatch(/at least one line/);
      const outside = await call("POST", base("orders"), orderBody({ orderDate: "2030-01-01" }));
      expect(outside.status).toBe(400);
      expect(outside.body.message).toMatch(/No fiscal year covers this date/);
    });

    it("list: filters by status, vendor, branch and search; reports the total; newest first", async () => {
      const a = await mkOrder({ vendorGLId: W.vendor2, vendorRefNo: `QT-${tag}`, orderDate: "2025-11-01" }, false);
      const b = await mkOrder({ branchId: W.br2, orderDate: "2025-11-02" }, true);
      const all = (await list("orders")).body;
      expect(all.total).toBe(all.rows.length);
      expect(all.rows.map((r: any) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
      const dates = all.rows.map((r: any) => r.orderDate);
      expect(dates).toEqual([...dates].sort().reverse());
      expect((await list("orders", `&vendorGLId=${W.vendor2}`)).body.rows.map((r: any) => r.id)).toEqual([a.id]);
      expect((await list("orders", `&branchId=${W.br2}`)).body.rows.map((r: any) => r.id)).toEqual([b.id]);
      expect((await list("orders", `&search=QT-${tag}`)).body.rows.map((r: any) => r.id)).toEqual([a.id]);
      expect((await list("orders", `&search=${c("VENDB")}`)).body.rows.map((r: any) => r.id)).toEqual([a.id]);
      expect((await list("orders", `&status=DRAFT&vendorGLId=${W.vendor2}`)).body.rows).toHaveLength(1);
      expect((await list("orders", `&status=APPROVED&vendorGLId=${W.vendor2}`)).body.rows).toHaveLength(0);
      expect((await list("orders", "&status=NOPE")).status).toBe(400);
      // % and _ in a search are plain characters, not wildcards
      expect((await list("orders", "&search=%25")).body.rows).toHaveLength(0);
      expect((await list("orders", "&limit=1")).body.rows).toHaveLength(1);
      expect((await list("orders", "&limit=1")).body.total).toBe(all.total);
    });
  });

  // =====================================================================================================================
  describe("purchase challan", () => {
    it("receipt against an approved order: takes the order line's rate, confirm locks it, progress shows on the order", async () => {
      const o = await mkOrder({ terms: standardTerms() });
      const od = (await get("orders", o.id)).body;
      const r = await call("POST", base("challans"), challanBody({
        purchaseOrderId: o.id, vendorChallanNo: `VC-${tag}`, transporterName: "Truck Co",
        lines: [{ productId: W.rice, qty: 6, purchaseOrderLineId: od.lines[0].id, locationId: W.loc }],
      }));
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const d = r.body.document;
      expect(d).toMatchObject({ isConfirmed: false, purchaseOrderId: o.id, orderNumber: o.orderNumber, orderStatus: "APPROVED", vendorChallanNo: `VC-${tag}`, transporterName: "Truck Co" });
      expect(d.lines[0]).toMatchObject({ purchaseOrderLineId: od.lines[0].id, orderLineNumber: 1, rate: "100.000000", basicAmount: "600.00", locationCode: c("LOC").slice(0, 10), billed: "0.000000", pendingToBill: "6.000000" });
      // not counted until it is confirmed
      expect((await get("orders", o.id)).body.lines[0].received).toBe("0.000000");
      const cf = await act("challans", d.id, "confirm");
      expect(cf.status, JSON.stringify(cf.body)).toBe(200);
      expect(cf.body).toMatchObject({ result: { id: d.id, isConfirmed: true }, document: { isConfirmed: true } });
      const after = (await get("orders", o.id)).body;
      expect(after.lines[0]).toMatchObject({ received: "6.000000", pendingToReceive: "4.000000" });
      expect(after.challans.map((x: any) => x.id)).toEqual([d.id]);
      expect((await act("challans", d.id, "confirm")).status).toBe(409);
    });

    it("a confirmed challan is frozen; a draft can be edited and deleted", async () => {
      const ch = await mkChallan();
      expect((await call("PUT", `${base("challans")}/${ch.id}?${qs()}`, challanBody())).status).toBe(409);
      const d = await del("challans", ch.id);
      expect(d.status).toBe(409);
      expect(d.body.message).toMatch(/confirmed challan cannot be deleted/);
      const draft = await mkChallan({}, false);
      const e = await call("PUT", `${base("challans")}/${draft.id}?${qs()}`, challanBody({ challanDate: "2025-10-11", lines: [{ productId: W.oil, qty: 3 }] }));
      expect(e.status, JSON.stringify(e.body)).toBe(200);
      expect(e.body.document).toMatchObject({ challanDate: "2025-10-11", challanNumber: draft.challanNumber });
      expect(e.body.document.lines).toHaveLength(1);
      expect((await del("challans", draft.id)).status).toBe(200);
      expect((await get("challans", draft.id)).status).toBe(404);
    });

    it("receiving more than ordered is refused when confirming (409 with the pending quantity)", async () => {
      const o = await mkOrder();
      const od = (await get("orders", o.id)).body;
      const ch = await mkChallan({ purchaseOrderId: o.id, lines: [{ productId: W.rice, qty: 11, purchaseOrderLineId: od.lines[0].id }] }, false);
      const cf = await act("challans", ch.id, "confirm");
      expect(cf.status).toBe(409);
      expect(cf.body.message).toMatch(/would exceed the ordered 10/);
    });

    it("batch and expiry are required on confirm for a tracked product", async () => {
      const ch = await mkChallan({ lines: [{ productId: W.med, qty: 2 }] }, false);
      const cf = await act("challans", ch.id, "confirm");
      expect(cf.status).toBe(409);
      expect(cf.body.message).toMatch(/batch/i);
      const ok = await call("PUT", `${base("challans")}/${ch.id}?${qs()}`, challanBody({ lines: [{ productId: W.med, qty: 2, batchNo: "B1", manufactureDate: "2025-09-01", expiryDate: "2027-09-01" }] }));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.document.lines[0]).toMatchObject({ batchNo: "B1", manufactureDate: "2025-09-01", expiryDate: "2027-09-01" });
      expect((await act("challans", ch.id, "confirm")).status).toBe(200);
    });

    it("list: status filter DRAFT / CONFIRMED, order number shown, totals per challan", async () => {
      const o = await mkOrder();
      const od = (await get("orders", o.id)).body;
      const conf = await mkChallan({ purchaseOrderId: o.id, vendorGLId: W.vendor, lines: [{ productId: W.oil, qty: 2, purchaseOrderLineId: od.lines[1].id }] });
      const draft = await mkChallan({}, false);
      const ids = (s: string) => ((list("challans", s) as any) as Promise<Res>).then((r) => r.body.rows.map((x: any) => x.id));
      expect(await ids("&status=CONFIRMED")).toContain(conf.id);
      expect(await ids("&status=CONFIRMED")).not.toContain(draft.id);
      expect(await ids("&status=DRAFT")).toContain(draft.id);
      const row = (await list("challans", `&search=${o.orderNumber}`)).body.rows.find((x: any) => x.id === conf.id);
      expect(row).toMatchObject({ orderNumber: o.orderNumber, isConfirmed: true, totalQty: "2.000000", totalAmount: "400.00" });
      expect((await list("challans", "&status=MAYBE")).status).toBe(400);
    });
  });

  // =====================================================================================================================
  describe("purchase bill", () => {
    it("order -> challan -> bill: from-challan fills a bill, save prices it, post writes a balanced voucher, reverse undoes it", async () => {
      const o = await mkOrder();
      const od = (await get("orders", o.id)).body;
      const ch = await mkChallan({ purchaseOrderId: o.id, lines: [{ productId: W.rice, qty: 10, purchaseOrderLineId: od.lines[0].id }, { productId: W.oil, qty: 5, purchaseOrderLineId: od.lines[1].id }] });

      const start = await call("GET", `${base("bills")}/from-challan/${ch.id}?${qs()}`);
      expect(start.status, JSON.stringify(start.body)).toBe(200);
      expect(start.body).toMatchObject({ companyId: W.co, branchId: W.br, vendorGLId: W.vendor, purchaseChallanId: ch.id, purchaseOrderId: o.id });
      expect(start.body.lines.map((l: any) => [l.productId, l.qty, l.rate])).toEqual([[W.rice, "10.000000", "100.000000"], [W.oil, "5.000000", "200.000000"]]);

      const saved = await call("POST", base("bills"), { ...start.body, invoiceDate: "2025-10-14", vendorInvoiceNo: `INV-${tag}`, dueDays: 30, terms: standardTerms() });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      expect(saved.body.result).toMatchObject({ invoiceNumber: "0001", basicAmount: "2000.00", termAmount: "147.00", totalAmount: "2147.00" });
      const draft = saved.body.document;
      expect(draft).toMatchObject({ state: "DRAFT", isPosted: false, dueDate: "2025-11-13", challanNumber: ch.challanNumber, orderNumber: o.orderNumber, journalVoucher: null, importDetail: null });
      expect(draft.lines[0]).toMatchObject({ challanLineNumber: 1, orderLineNumber: 1 });

      const posted = await act("bills", draft.id, "post");
      expect(posted.status, JSON.stringify(posted.body)).toBe(200);
      // Dr: purchases 2000 + freight 100 + VAT 247; Cr: discount 200 + vendor 2147  ->  both sides 2347
      expect(posted.body.result).toMatchObject({ isPosted: true, totalAmount: "2147.00", debit: "2347.00", credit: "2347.00" });
      const pd = posted.body.document;
      expect(pd).toMatchObject({ state: "POSTED", isPosted: true });
      expect(pd.journalVoucher.id).toBe(posted.body.result.journalVoucherId);
      expect(pd.journalVoucher.voucherNumber).toMatch(/^PB-2082\/83-0001$/);
      const v = await voucherOf(pd.journalVoucher.id);
      expect(v.dr).toBe("2347.00");
      expect(v.cr).toBe("2347.00");
      expect(v.rows.some((r: any) => r.gl === W.vendor && Number(r.credit) === 2147)).toBe(true);
      // freight 100 was spread over the lines by value for stock valuation
      expect(pd.lines.map((l: any) => n2(l.allocatedTermAmount))).toEqual(["50.00", "50.00"]);

      // the order and challan now show the quantity as billed
      expect((await get("orders", o.id)).body.lines.map((l: any) => l.billed)).toEqual(["10.000000", "5.000000"]);
      expect((await get("challans", ch.id)).body.bills.map((b: any) => b.id)).toEqual([draft.id]);

      // posted: frozen, cannot be posted twice, cannot be deleted
      expect((await call("PUT", `${base("bills")}/${draft.id}?${qs()}`, billBody())).status).toBe(409);
      expect((await act("bills", draft.id, "post")).status).toBe(409);
      const dd = await del("bills", draft.id);
      expect(dd.status).toBe(409);
      expect(dd.body.message).toMatch(/Reverse it instead/);

      const rev = await act("bills", draft.id, "reverse", { date: "2025-10-20", reason: "wrong vendor" });
      expect(rev.status, JSON.stringify(rev.body)).toBe(200);
      expect(rev.body.document).toMatchObject({ state: "REVERSED", reversedBy: { id: rev.body.result.reversalBillId } });
      const rb = (await get("bills", rev.body.result.reversalBillId)).body;
      expect(rb).toMatchObject({ state: "REVERSAL", isPosted: true, reversalOf: { id: draft.id }, totalAmount: "2147.00" });
      const rv = await voucherOf(rb.journalVoucher.id);
      expect([rv.dr, rv.cr]).toEqual(["2347.00", "2347.00"]);
      expect((await act("bills", draft.id, "reverse")).status).toBe(409);
      // reversing frees the quantity again
      expect((await get("orders", o.id)).body.lines.map((l: any) => l.billed)).toEqual(["0.000000", "0.000000"]);
    });

    it("a draft bill can be edited and deleted; deleting releases what it reserved", async () => {
      const o = await mkOrder();
      const od = (await get("orders", o.id)).body;
      const first = await mkBill({ purchaseOrderId: o.id, lines: [{ productId: W.rice, qty: 10, rate: 100, purchaseOrderLineId: od.lines[0].id }] });
      expect((await get("orders", o.id)).body.lines[0].billed).toBe("10.000000");
      // a second bill for the same quantity is refused while the first draft stands
      const dup = await call("POST", base("bills"), billBody({ purchaseOrderId: o.id, lines: [{ productId: W.rice, qty: 1, rate: 100, purchaseOrderLineId: od.lines[0].id }] }));
      expect(dup.status).toBe(409);
      expect(dup.body.message).toMatch(/would exceed/);
      const e = await call("PUT", `${base("bills")}/${first.id}?${qs()}`, billBody({ purchaseOrderId: o.id, dueDays: 7, lines: [{ productId: W.rice, qty: 4, rate: 100, purchaseOrderLineId: od.lines[0].id }] }));
      expect(e.status, JSON.stringify(e.body)).toBe(200);
      expect(e.body.document).toMatchObject({ dueDays: 7, dueDate: "2025-10-21", invoiceNumber: first.invoiceNumber, basicAmount: "400.00" });
      expect((await del("bills", first.id)).status).toBe(200);
      expect((await get("bills", first.id)).status).toBe(404);
      expect((await get("orders", o.id)).body.lines[0].billed).toBe("0.000000");
    });

    it("an import bill carries its import detail and cannot be posted without a customs declaration number", async () => {
      const local = await call("POST", base("bills"), billBody({ importDetail: { customsDeclarationNo: "X" } }));
      expect(local.status).toBe(400);
      expect(local.body.message).toMatch(/IMPORT invoice/);
      const b = await mkBill({ invoiceType: "IMPORT", purchaseType: "GOODS_PURCHASE_CAPITAL", importDetail: { customsOffice: "Birgunj", transportMode: "ROAD", countryOfOrigin: "India" } });
      const d = (await get("bills", b.id)).body;
      expect(d).toMatchObject({ invoiceType: "IMPORT", purchaseType: "GOODS_PURCHASE_CAPITAL" });
      expect(d.importDetail).toMatchObject({ customsOffice: "Birgunj", transportMode: "ROAD", countryOfOrigin: "India", customsDeclarationNo: null });
      const no = await act("bills", b.id, "post");
      expect(no.status).toBe(409);
      expect(no.body.message).toMatch(/customs declaration number/);
      const fix = await call("PUT", `${base("bills")}/${b.id}?${qs()}`, billBody({ invoiceType: "IMPORT", importDetail: { customsDeclarationNo: "CD-1", customsDeclarationDate: "2025-10-12", transportMode: "AIR" } }));
      expect(fix.status, JSON.stringify(fix.body)).toBe(200);
      expect(fix.body.document.importDetail).toMatchObject({ customsDeclarationNo: "CD-1", customsDeclarationDate: "2025-10-12", transportMode: "AIR" });
      expect((await act("bills", b.id, "post")).status).toBe(200);
    });

    it("an additional bill adds a charge to a posted main bill's landed cost", async () => {
      const main = await mkBill();
      expect((await act("bills", main.id, "post")).status).toBe(200);
      const before = (await get("bills", main.id)).body;
      expect(before.lines.map((l: any) => n2(l.landedAmount))).toEqual(["1000.00", "1000.00"]);
      const add = await call("POST", base("bills"), { companyId: W.co, branchId: W.br, invoiceDate: "2025-10-20", vendorGLId: W.customs ?? W.vendor, mainBillId: main.id, lines: [], terms: [{ termId: W.tDuty, inputAmount: 150 }] });
      expect(add.status, JSON.stringify(add.body)).toBe(201);
      expect(add.body.document).toMatchObject({ mainBillId: main.id, mainBill: { id: main.id }, state: "DRAFT", totalAmount: "150.00" });
      expect((await act("bills", add.body.result.id, "post")).status).toBe(200);
      const after = (await get("bills", main.id)).body;
      expect(after.lines.map((l: any) => n2(l.landedAmount))).toEqual(["1100.00", "1050.00"]); // 150 by quantity: 10 pcs and 5 pcs -> 100 and 50
      expect(after.additionalBills).toEqual([expect.objectContaining({ id: add.body.result.id, state: "POSTED" })]);
      // the main bill cannot be reversed while a live additional bill stands
      const rev = await act("bills", main.id, "reverse");
      expect(rev.status).toBe(409);
      expect(rev.body.message).toMatch(/additional bills first/);
    });

    it("list: state filter DRAFT / POSTED / REVERSED / REVERSAL, flags for additional bills, search by vendor invoice number", async () => {
      const draft = await mkBill({ vendorInvoiceNo: `V-D-${tag}` });
      const posted = await mkBill({ vendorInvoiceNo: `V-P-${tag}` });
      await act("bills", posted.id, "post");
      const reversedBill = await mkBill({ vendorInvoiceNo: `V-R-${tag}` });
      await act("bills", reversedBill.id, "post");
      const rv = (await act("bills", reversedBill.id, "reverse", { date: "2025-10-20" })).body.result.reversalBillId as number;
      const ids = async (s: string) => (await list("bills", s)).body.rows.map((r: any) => r.id);
      expect(await ids("&status=DRAFT")).toContain(draft.id);
      expect(await ids("&status=DRAFT")).not.toContain(posted.id);
      expect(await ids("&status=POSTED")).toContain(posted.id);
      expect(await ids("&status=POSTED")).not.toContain(reversedBill.id);
      expect(await ids("&status=REVERSED")).toEqual(expect.arrayContaining([reversedBill.id]));
      expect(await ids("&status=REVERSED")).not.toContain(rv);
      expect(await ids("&status=REVERSAL")).toContain(rv);
      expect(await ids(`&search=V-P-${tag}`)).toEqual([posted.id]);
      const row = (await list("bills", `&search=V-R-${tag}`)).body.rows[0];
      expect(row).toMatchObject({ id: reversedBill.id, state: "REVERSED", isAdditional: false, vendorCode: c("VEND"), vendorInvoiceNo: `V-R-${tag}` });
      expect((await list("bills", "&status=GONE")).status).toBe(400);
    });

    it("posting a bill whose product has no purchase ledger is a 409 with the product named, and nothing is posted", async () => {
      const id = await ins("Product", { companyId: W.co, code: c("noGL").slice(0, 10), description: "No ledger", type: "STOCK", productSubGroupId: (await rowsOf(sql`select id from "ProductSubGroup" order by id desc limit 1`))[0].id, updatedAt: NOW });
      const grp = (await rowsOf(sql`select "productSubGroupId" as g from "Product" where id = ${W.rice}`))[0].g;
      await db.execute(sql`update "Product" set "productSubGroupId" = ${grp} where id = ${id}`);
      await ins("StockDetail", { productId: id, baseUnitId: W.pcs, updatedAt: NOW });
      const b = await mkBill({ lines: [{ productId: id, qty: 1, rate: 10 }] });
      const p = await act("bills", b.id, "post");
      expect(p.status).toBe(409);
      expect(p.body.message).toMatch(/no purchase ledger/);
      expect((await get("bills", b.id)).body.state).toBe("DRAFT");
    });
  });

  // =====================================================================================================================
  describe("input checks and company scoping", () => {
    it("wrong types are a 400 that names the field, never a 500", async () => {
      const bad = async (body: any, field: string | RegExp) => {
        const r = await call("POST", base("orders"), body);
        expect(r.status, JSON.stringify(r.body)).toBe(400);
        if (typeof field === "string") expect(r.body.field ?? "", JSON.stringify(r.body)).toBe(field);
        else expect(r.body.message).toMatch(field);
      };
      await bad(orderBody({ lines: "nope" }), "lines");
      await bad(orderBody({ lines: [null] }), /Line 1 must be an object/);
      await bad(orderBody({ lines: [{ productId: "abc", qty: 1 }] }), "productId");
      await bad(orderBody({ lines: [{ productId: W.rice, qty: { a: 1 } }] }), "qty");
      await bad(orderBody({ lines: [{ productId: W.rice, qty: 1, unitId: 1.5 }] }), "unitId");
      await bad(orderBody({ vendorGLId: "x" }), "vendorGLId");
      await bad(orderBody({ remarks: 12 }), "remarks");
      await bad(orderBody({ terms: [{ termId: W.tVat, calcType: "SOMETIMES" }] }), "calcType");
      await bad(orderBody({ terms: {} }), "terms");
      await bad(orderBody({ branchId: undefined }), "branchId");
      await bad(orderBody({ companyId: undefined }), "companyId");
      await bad(orderBody({ lines: Array.from({ length: 501 }, () => ({ productId: W.rice, qty: 1 })) }), "lines");
      const badBill = await call("POST", base("bills"), billBody({ invoiceType: "SEA" }));
      expect(badBill.status).toBe(400);
      expect(badBill.body.field).toBe("invoiceType");
      const badImp = await call("POST", base("bills"), billBody({ invoiceType: "IMPORT", importDetail: { transportMode: "SHIP" } }));
      expect(badImp.status).toBe(400);
      expect(badImp.body.field).toBe("transportMode");
      expect((await call("GET", `${base("orders")}/abc?${qs()}`)).status).toBe(400);
      expect((await call("GET", `${base("orders")}/0?${qs()}`)).status).toBe(400);
      expect((await call("GET", `${base("bills")}/from-challan/abc?${qs()}`)).status).toBe(400);
    });

    it("the acting user must be a real active user; none is allowed (recorded as nobody)", async () => {
      const ghost = await call("POST", base("orders"), orderBody({ userId: 999999 }));
      expect(ghost.status).toBe(400);
      expect(ghost.body.field).toBe("userId");
      const ok = await call("POST", base("orders"), orderBody({ userId: seededUserId }));
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const [row] = await rowsOf(sql`select "createdBy" from "PurchaseOrder" where id = ${ok.body.result.id}`);
      expect(row.createdBy).toBe(seededUserId);
      const anon = await call("POST", base("orders"), orderBody());
      const [row2] = await rowsOf(sql`select "createdBy" from "PurchaseOrder" where id = ${anon.body.result.id}`);
      expect(row2.createdBy).toBeNull();
      const approve = await act("orders", ok.body.result.id, "approve", { userId: seededUserId });
      expect(approve.status).toBe(200);
      const [row3] = await rowsOf(sql`select "approvedBy" from "PurchaseOrder" where id = ${ok.body.result.id}`);
      expect(row3.approvedBy).toBe(seededUserId);
    });

    it("a document of another company is 'not found' on every route; nothing of it can be read, changed, acted on or deleted", async () => {
      const o = await mkOrder({}, false);
      const ch = await mkChallan({}, false);
      const b = await mkBill();
      const other = otherCompanyId;
      for (const [kind, id] of [["orders", o.id], ["challans", ch.id], ["bills", b.id]] as const) {
        expect((await get(kind, id, other)).status, `GET ${kind}`).toBe(404);
        expect((await call("PUT", `${base(kind)}/${id}?companyId=${other}`, kind === "orders" ? orderBody() : kind === "challans" ? challanBody() : billBody())).status, `PUT ${kind}`).toBe(404);
        expect((await del(kind, id, other)).status, `DELETE ${kind}`).toBe(404);
      }
      expect((await act("orders", o.id, "approve", {}, other)).status).toBe(404);
      expect((await act("orders", o.id, "cancel", {}, other)).status).toBe(404);
      expect((await act("challans", ch.id, "confirm", {}, other)).status).toBe(404);
      expect((await act("bills", b.id, "post", {}, other)).status).toBe(404);
      expect((await act("bills", b.id, "reverse", {}, other)).status).toBe(404);
      expect((await call("GET", `${base("bills")}/from-challan/${ch.id}?companyId=${other}`)).status).toBe(404);
      // still untouched in the owning company
      expect((await get("orders", o.id)).body.status).toBe("DRAFT");
      expect((await get("challans", ch.id)).body.isConfirmed).toBe(false);
      expect((await get("bills", b.id)).body.state).toBe("DRAFT");
      // and the other company's lists do not show them
      for (const kind of ["orders", "challans", "bills"]) expect((await list(kind, "", other)).body.rows.some((r: any) => [o.id, ch.id, b.id].includes(r.id) && true && r.vendorGLId === W.vendor)).toBe(false);
    });

    it("a document cannot be created with a ledger, product or term of another company (refused by the service, not stored)", async () => {
      const otherVendor = (await call("GET", `/api/purchase/lookups?companyId=${otherCompanyId}`)).body.vendors[0].id;
      const r = await call("POST", base("orders"), orderBody({ vendorGLId: otherVendor }));
      expect(r.status).toBe(404);
      expect(r.body.message).toMatch(/Vendor ledger not found in this company/);
      const otherProduct = (await call("GET", `/api/purchase/lookups?companyId=${otherCompanyId}`)).body.products[0].id;
      const p = await call("POST", base("orders"), orderBody({ lines: [{ productId: otherProduct, qty: 1, rate: 1 }] }));
      expect(p.status).toBe(400);
      expect(p.body.message).toMatch(/product not found in this company/);
    });
  });
});
