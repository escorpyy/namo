import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";
import { stockBalance, syncOpeningMovements } from "../server/services/stockLedger";
import { stockValuation } from "../server/services/stockValuation";
import { stockLedgerBalances, stockAutoRows, stockAutoSql } from "../server/services/stockLedgerAuto";

// The purchase service layer end to end: order -> challan -> bill -> journal, with the rules the database cannot
// express (pricing, landed cost, quantity limits, balanced posting, reversal). Every test runs inside one transaction
// that is rolled back, and passes it to the services, so nothing is left behind.
describe.skipIf(!DB_READY)("purchase service layer", () => {
  let db: any;
  let svc: typeof import("../server/services/purchase");
  class Rollback extends Error {}
  const NOW = sql`now()`;
  const ACTOR = { userId: null };

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    svc = await import("../server/services/purchase");
  });

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };
  const q = async (tx: any, query: any) => (await tx.execute(query)) as any[];
  const n2 = (v: any) => Number(v).toFixed(2);

  async function world(tx: any) {
    const t = uniq();
    const c = (s: string) => `${s}${t}`.slice(0, 20);
    const co = await ins(tx, "Company", { code: c("T"), name: `Test ${t}`, updatedAt: NOW });
    const br = await ins(tx, "Branch", { companyId: co, code: c("B"), name: "Branch", updatedAt: NOW });
    await ins(tx, "FiscalYear", { companyId: co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins(tx, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "EXPENSE", updatedAt: NOW });
    const sg = await ins(tx, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, normal = "DEBIT") => ins(tx, "GeneralLedger", { companyId: co, code: c(code), name: code, accountGroupId: grp, accountSubGroupId: sg, normalBalance: normal, updatedAt: NOW });
    const vendor = await gl("VEND", "CREDIT"), customs = await gl("CUST", "CREDIT");
    const purchase = await gl("PURCH"), vat = await gl("VAT"), freight = await gl("FREIGHT"), discount = await gl("DISC", "CREDIT"), duty = await gl("DUTY");
    const pcs = await ins(tx, "ProductUnit", { companyId: co, code: c("PCS"), name: "Pcs", updatedAt: NOW });
    const box = await ins(tx, "ProductUnit", { companyId: co, code: c("BOX"), name: "Box", updatedAt: NOW });
    const pg = await ins(tx, "ProductGroup", { companyId: co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins(tx, "ProductSubGroup", { code: c("PSG"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    const prod = async (code: string, type: string, extra: Record<string, unknown> = {}, glId: number | null = purchase) => {
      const id = await ins(tx, "Product", { companyId: co, code: c(code), description: code, type, productSubGroupId: psg, updatedAt: NOW });
      if (type === "STOCK") {
        const sd = await ins(tx, "StockDetail", { productId: id, baseUnitId: pcs, purchaseGLId: glId, updatedAt: NOW, ...extra });
        return { id, sd };
      }
      await ins(tx, "NonStockDetail", { productId: id, unitId: pcs, salesGLId: purchase, purchaseGLId: purchase, updatedAt: NOW });
      return { id, sd: 0 };
    };
    const rice = await prod("RICE", "STOCK"), oil = await prod("OIL", "STOCK"), med = await prod("MED", "STOCK", { tracksBatch: true, tracksExpiry: true }), nogl = await prod("NOGL", "STOCK", {}, null), consult = await prod("CONS", "NON_STOCK");
    await ins(tx, "AlternateUnit", { stockDetailId: rice.sd, unitId: box, conversionFactor: 12 });
    const loc = await ins(tx, "Location", { companyId: co, code: c("LOC"), name: "Store", updatedAt: NOW });
    const term = (code: string, o: Record<string, unknown>) => ins(tx, "PurchaseTerm", { companyId: co, code: c(code), name: code, updatedAt: NOW, ...o });
    const tDisc = await term("DISC10", { nature: "DEDUCTIVE", sequence: 10, defaultCalcType: "PERCENT", defaultValue: 10, generalLedgerId: discount });
    const tFreight = await term("FRT", { nature: "ADDITIVE", sequence: 20, defaultCalcType: "AMOUNT", distributeToLines: true, allocationBasis: "VALUE", generalLedgerId: freight });
    const tVat = await term("VAT13", { nature: "ADDITIVE", sequence: 30, defaultCalcType: "PERCENT", defaultValue: 13, calcBase: "RUNNING_TOTAL", generalLedgerId: vat });
    const tDuty = await term("DUTY", { nature: "ADDITIVE", category: "COSTING", sequence: 10, defaultCalcType: "AMOUNT", distributeToLines: true, allocationBasis: "QUANTITY", generalLedgerId: duty });
    const tLineDisc = await term("LDISC", { nature: "DEDUCTIVE", sequence: 5, isProductwise: true, defaultCalcType: "PERCENT", defaultValue: 5, generalLedgerId: discount });
    const tNoGL = await term("NOGLT", { nature: "ADDITIVE", sequence: 40, defaultCalcType: "AMOUNT" });
    return { co, br, vendor, customs, purchase, vat, freight, discount, duty, pcs, box, rice, oil, med, nogl, consult, loc, tDisc, tFreight, tVat, tDuty, tLineDisc, tNoGL };
  }
  type W = Awaited<ReturnType<typeof world>>;

  const run = async (body: (tx: any, W: W) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        await body(tx, await world(tx));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };

  // ---- builders ----
  const rejects = async (tx: any, p: Promise<unknown>, status: number, msg: RegExp) => {
    let err: any;
    try { await p; } catch (e) { err = e; }
    expect(err, "should have been refused").toBeDefined();
    expect(err.status, err.message).toBe(status);
    expect(err.message).toMatch(msg);
  };

  const orderIn = (W: W, over: any = {}) => ({
    companyId: W.co, branchId: W.br, orderDate: "2025-10-01", vendorGLId: W.vendor,
    lines: [{ productId: W.rice.id, qty: 10, rate: 100 }, { productId: W.oil.id, qty: 5, rate: 200 }], ...over,
  });
  const mkOrder = async (tx: any, W: W, over: any = {}, approve = true) => {
    const o = await svc.savePurchaseOrder(orderIn(W, over), ACTOR, { tx });
    if (approve) await svc.approvePurchaseOrder(o.id, ACTOR, { tx });
    return o;
  };
  const olines = (tx: any, orderId: number) => q(tx, sql`select * from "PurchaseOrderLine" where "purchaseOrderId" = ${orderId} order by "lineNumber"`);
  const challanIn = (W: W, over: any = {}) => ({
    companyId: W.co, branchId: W.br, challanDate: "2025-10-10", vendorGLId: W.vendor,
    lines: [{ productId: W.rice.id, qty: 10 }, { productId: W.oil.id, qty: 5 }], ...over,
  });
  const clines = (tx: any, challanId: number) => q(tx, sql`select * from "PurchaseChallanLine" where "purchaseChallanId" = ${challanId} order by "lineNumber"`);
  const billIn = (W: W, over: any = {}) => ({
    companyId: W.co, branchId: W.br, invoiceDate: "2025-10-14", vendorGLId: W.vendor,
    lines: [{ productId: W.rice.id, qty: 10, rate: 100 }, { productId: W.oil.id, qty: 5, rate: 200 }], ...over,
  });
  const blines = (tx: any, billId: number) => q(tx, sql`select * from "PurchaseBillLine" where "purchaseBillId" = ${billId} order by "lineNumber"`);
  const bill = async (tx: any, id: number) => (await q(tx, sql`select * from "PurchaseBill" where id = ${id}`))[0];
  const voucher = async (tx: any, jvId: number) => {
    const rows = await q(tx, sql`select l."generalLedgerId" as gl, l.debit, l.credit from "JournalVoucherLine" l where l."journalVoucherId" = ${jvId} order by l."lineNumber"`);
    const dr = rows.reduce((a, r) => a + Number(r.debit), 0), cr = rows.reduce((a, r) => a + Number(r.credit), 0);
    return { rows: rows.map((r) => ({ gl: r.gl, debit: n2(r.debit), credit: n2(r.credit) })), dr: n2(dr), cr: n2(cr) };
  };
  // the worked example: discount 10% of items, freight 100 spread by value, VAT 13% on the running total
  const standardTerms = (W: W) => [{ termId: W.tDisc }, { termId: W.tFreight, inputAmount: 100 }, { termId: W.tVat }];

  // =====================================================================================================
  describe("purchase order", () => {
    it("saves a draft: totals priced, numbered 0001, 0002 per branch and fiscal year", async () => {
      await run(async (tx, W) => {
        const a = await svc.savePurchaseOrder(orderIn(W, { terms: standardTerms(W) }), ACTOR, { tx });
        expect(a.orderNumber).toBe("0001");
        expect(a.fiscalYear).toBe("2082/83");
        expect(a.basicAmount).toBe("2000.00");
        expect(a.termAmount).toBe("147.00"); // -200 + 100 + 247
        expect(a.totalAmount).toBe("2147.00");
        const b = await svc.savePurchaseOrder(orderIn(W), ACTOR, { tx });
        expect(b.orderNumber).toBe("0002");
        const [row] = await q(tx, sql`select status, "totalAmount" from "PurchaseOrder" where id = ${a.id}`);
        expect(row.status).toBe("DRAFT");
        expect(n2(row.totalAmount)).toBe("2147.00");
        const lines = await olines(tx, a.id);
        expect(lines.map((l) => n2(l.basicAmount))).toEqual(["1000.00", "1000.00"]);
      });
    });

    it("a quantity typed in an alternate unit becomes stock units: 2 boxes x 12 = 24 pcs", async () => {
      await run(async (tx, W) => {
        const o = await svc.savePurchaseOrder(orderIn(W, { lines: [{ productId: W.rice.id, altQty: 2, altUnitId: W.box, rate: 10 }] }), ACTOR, { tx });
        const [l] = await olines(tx, o.id);
        expect(n2(l.qty)).toBe("24.00");
        expect(l.unitId).toBe(W.pcs);
        expect(n2(l.altQty)).toBe("2.00");
        expect(n2(l.basicAmount)).toBe("240.00");
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { lines: [{ productId: W.oil.id, altQty: 2, altUnitId: W.box, rate: 10 }] }), ACTOR, { tx }), 400, /not an alternate unit/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { lines: [{ productId: W.consult.id, altQty: 2, altUnitId: W.box }] }), ACTOR, { tx }), 400, /only for stock products/);
      });
    });

    it("refuses bad lines: no lines, zero qty, unknown or inactive product, bundle", async () => {
      await run(async (tx, W) => {
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { lines: [] }), ACTOR, { tx }), 400, /at least one line/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { lines: [{ productId: W.rice.id, qty: 0, rate: 1 }] }), ACTOR, { tx }), 400, /greater than zero/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { lines: [{ productId: W.rice.id, qty: 1, rate: -1 }] }), ACTOR, { tx }), 400, /rate cannot be negative/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { lines: [{ productId: 999999, qty: 1 }] }), ACTOR, { tx }), 400, /product not found/);
        await tx.execute(sql`update "Product" set "isActive" = false where id = ${W.oil.id}`);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { lines: [{ productId: W.oil.id, qty: 1 }] }), ACTOR, { tx }), 409, /not active/);
      });
    });

    it("fiscal year: date outside any year, outside the named year, or in a closed year is refused", async () => {
      await run(async (tx, W) => {
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { orderDate: "2027-01-01" }), ACTOR, { tx }), 400, /No fiscal year covers/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { orderDate: "2027-01-01", fiscalYear: "2082/83" }), ACTOR, { tx }), 400, /outside fiscal year/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { orderDate: "not a date" }), ACTOR, { tx }), 400, /must be a date/);
        await tx.execute(sql`update "FiscalYear" set "isClosed" = true where "companyId" = ${W.co}`);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W), ACTOR, { tx }), 409, /closed/);
      });
    });

    it("an additional charge cannot be put on an order; a productwise term needs a line", async () => {
      await run(async (tx, W) => {
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { terms: [{ termId: W.tDuty, inputAmount: 50 }] }), ACTOR, { tx }), 400, /additional purchase bill/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { terms: [{ termId: W.tLineDisc }] }), ACTOR, { tx }), 400, /productwise/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { terms: [{ termId: W.tVat, lineNumber: 1 }] }), ACTOR, { tx }), 400, /whole document/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { terms: [{ termId: W.tVat }, { termId: W.tVat }] }), ACTOR, { tx }), 400, /entered twice/);
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { terms: [{ termId: W.tLineDisc, lineNumber: 9 }] }), ACTOR, { tx }), 400, /no line 9/);
        const ok = await svc.savePurchaseOrder(orderIn(W, { terms: [{ termId: W.tLineDisc, lineNumber: 1 }] }), ACTOR, { tx });
        expect(ok.termAmount).toBe("-50.00"); // 5% of the first line's 1000
      });
    });

    it("lifecycle: DRAFT -> APPROVED (locked) -> CLOSED; a mandatory term must be present to approve", async () => {
      await run(async (tx, W) => {
        await tx.execute(sql`update "PurchaseTerm" set "isMandatory" = true where id = ${W.tVat}`);
        const o = await svc.savePurchaseOrder(orderIn(W), ACTOR, { tx });
        await rejects(tx, svc.approvePurchaseOrder(o.id, ACTOR, { tx }), 409, /Mandatory term.*VAT13/);
        const o2 = await svc.savePurchaseOrder(orderIn(W, { id: o.id, terms: [{ termId: W.tVat }] }), ACTOR, { tx });
        expect(o2.id).toBe(o.id);
        expect(o2.termAmount).toBe("260.00");
        expect(await svc.approvePurchaseOrder(o.id, ACTOR, { tx })).toMatchObject({ status: "APPROVED" });
        const [r] = await q(tx, sql`select status, "approvedAt" from "PurchaseOrder" where id = ${o.id}`);
        expect(r.approvedAt).not.toBeNull();
        await rejects(tx, svc.savePurchaseOrder(orderIn(W, { id: o.id }), ACTOR, { tx }), 409, /only a DRAFT/);
        await rejects(tx, svc.approvePurchaseOrder(o.id, ACTOR, { tx }), 409, /only a DRAFT/);
        await svc.closePurchaseOrder(o.id, ACTOR, { tx });
        await rejects(tx, svc.closePurchaseOrder(o.id, ACTOR, { tx }), 409, /only an APPROVED/);
        await rejects(tx, svc.cancelPurchaseOrder(o.id, ACTOR, { tx }), 409, /cannot be cancelled/);
      });
    });

    it("editing a draft replaces its lines and terms (no leftovers); cancelling is blocked once a challan exists", async () => {
      await run(async (tx, W) => {
        const o = await svc.savePurchaseOrder(orderIn(W, { terms: standardTerms(W) }), ACTOR, { tx });
        const again = await svc.savePurchaseOrder(orderIn(W, { id: o.id, lines: [{ productId: W.rice.id, qty: 1, rate: 100 }] }), ACTOR, { tx });
        expect(again.totalAmount).toBe("100.00");
        expect((await olines(tx, o.id)).length).toBe(1);
        expect((await q(tx, sql`select count(*)::int as n from "PurchaseDocumentTerm" where "documentType" = 'PURCHASE_ORDER' and "documentId" = ${o.id}`))[0].n).toBe(0);

        const live = await mkOrder(tx, W);
        const ch = await svc.savePurchaseChallan(challanIn(W, { purchaseOrderId: live.id, lines: [{ productId: W.rice.id, qty: 1, purchaseOrderLineId: (await olines(tx, live.id))[0].id }] }), ACTOR, { tx });
        expect(ch.id).toBeGreaterThan(0);
        await rejects(tx, svc.cancelPurchaseOrder(live.id, ACTOR, { tx }), 409, /Close it instead/);
        const fresh = await mkOrder(tx, W, {}, false);
        expect(await svc.cancelPurchaseOrder(fresh.id, ACTOR, { tx })).toMatchObject({ status: "CANCELLED" });
      });
    });
  });

  // =====================================================================================================
  describe("purchase challan", () => {
    it("receives against an order: rate comes from the order line, receipt is tracked in progress", async () => {
      await run(async (tx, W) => {
        const o = await mkOrder(tx, W);
        const [l1, l2] = await olines(tx, o.id);
        const c = await svc.savePurchaseChallan(challanIn(W, { purchaseOrderId: o.id, lines: [{ productId: W.rice.id, qty: 4, purchaseOrderLineId: l1.id }, { productId: W.oil.id, qty: 5, purchaseOrderLineId: l2.id }] }), ACTOR, { tx });
        expect(c.challanNumber).toBe("0001");
        const cl = await clines(tx, c.id);
        expect(n2(cl[0].rate)).toBe("100.00");
        expect(n2(cl[0].basicAmount)).toBe("400.00");
        expect(n2(cl[1].basicAmount)).toBe("1000.00");
        await svc.confirmPurchaseChallan(c.id, ACTOR, { tx });
        const p = await svc.getPurchaseOrderProgress(o.id, { tx });
        expect(p.lines[0]).toMatchObject({ ordered: "10.000000", received: "4.000000", pendingToReceive: "6.000000", billed: "0.000000" });
        expect(p.lines[1]).toMatchObject({ received: "5.000000", pendingToReceive: "0.000000" });
      });
    });

    it("cannot receive more than ordered (all confirmed challans together), unless a tolerance allows it", async () => {
      await run(async (tx, W) => {
        const o = await mkOrder(tx, W);
        const [l1] = await olines(tx, o.id);
        const mk = (qty: number) => svc.savePurchaseChallan(challanIn(W, { purchaseOrderId: o.id, lines: [{ productId: W.rice.id, qty, purchaseOrderLineId: l1.id }] }), ACTOR, { tx });
        const a = await mk(7);
        await svc.confirmPurchaseChallan(a.id, ACTOR, { tx });
        const b = await mk(4);
        await rejects(tx, svc.confirmPurchaseChallan(b.id, ACTOR, { tx }), 409, /would exceed the ordered 10\.000000 \(already received 7\.000000\)\. Pending: 3\.000000/);
        await svc.confirmPurchaseChallan(b.id, ACTOR, { tx, tolerancePercent: 10 }); // 11 <= 10 + 10%
        const c = await mk(1);
        await rejects(tx, svc.confirmPurchaseChallan(c.id, ACTOR, { tx, tolerancePercent: 10 }), 409, /would exceed/);
      });
    });

    it("a challan that splits one order line over two rows is checked on the sum", async () => {
      await run(async (tx, W) => {
        const o = await mkOrder(tx, W);
        const [l1] = await olines(tx, o.id);
        const c = await svc.savePurchaseChallan(challanIn(W, { purchaseOrderId: o.id, lines: [{ productId: W.rice.id, qty: 6, purchaseOrderLineId: l1.id }, { productId: W.rice.id, qty: 6, purchaseOrderLineId: l1.id }] }), ACTOR, { tx });
        await rejects(tx, svc.confirmPurchaseChallan(c.id, ACTOR, { tx }), 409, /receiving 12\.000000 would exceed/);
      });
    });

    it("goods can only be received against an APPROVED order; a loose challan needs no order", async () => {
      await run(async (tx, W) => {
        const draft = await mkOrder(tx, W, {}, false);
        const [l1] = await olines(tx, draft.id);
        await rejects(tx, svc.savePurchaseChallan(challanIn(W, { purchaseOrderId: draft.id, lines: [{ productId: W.rice.id, qty: 1, purchaseOrderLineId: l1.id }] }), ACTOR, { tx }), 409, /APPROVED order/);
        await rejects(tx, svc.savePurchaseChallan(challanIn(W, { lines: [{ productId: W.rice.id, qty: 1, purchaseOrderLineId: l1.id }] }), ACTOR, { tx }), 400, /no purchase order/);
        const o = await mkOrder(tx, W);
        const [a] = await olines(tx, o.id);
        const c = await svc.savePurchaseChallan(challanIn(W, { purchaseOrderId: o.id, lines: [{ productId: W.rice.id, qty: 1, purchaseOrderLineId: a.id }] }), ACTOR, { tx });
        await svc.closePurchaseOrder(o.id, ACTOR, { tx });
        await rejects(tx, svc.confirmPurchaseChallan(c.id, ACTOR, { tx }), 409, /is CLOSED/);
        const loose = await svc.savePurchaseChallan(challanIn(W, { lines: [{ productId: W.rice.id, qty: 3, rate: 90 }] }), ACTOR, { tx });
        expect(await svc.confirmPurchaseChallan(loose.id, ACTOR, { tx })).toMatchObject({ isConfirmed: true });
      });
    });

    it("batch-tracked and expiring products need batch and expiry to confirm", async () => {
      await run(async (tx, W) => {
        const mk = (extra: any) => svc.savePurchaseChallan(challanIn(W, { lines: [{ productId: W.med.id, qty: 5, rate: 10, ...extra }] }), ACTOR, { tx });
        await rejects(tx, svc.confirmPurchaseChallan((await mk({})).id, ACTOR, { tx }), 409, /batch-tracked/);
        await rejects(tx, svc.confirmPurchaseChallan((await mk({ batchNo: "B1" })).id, ACTOR, { tx }), 409, /expires/);
        const ok = await mk({ batchNo: "B1", manufactureDate: "2025-09-01", expiryDate: "2027-09-01", locationId: W.loc });
        await svc.confirmPurchaseChallan(ok.id, ACTOR, { tx });
        const [l] = await clines(tx, ok.id);
        expect(l.batchNo).toBe("B1");
      });
    });

    it("a confirmed challan is locked and cannot be confirmed twice; vendor challan number is unique per vendor", async () => {
      await run(async (tx, W) => {
        const c = await svc.savePurchaseChallan(challanIn(W, { vendorChallanNo: "VC-7" }), ACTOR, { tx });
        await rejects(tx, svc.savePurchaseChallan(challanIn(W, { vendorChallanNo: "VC-7" }), ACTOR, { tx }), 409, /Already exists/);
        await svc.confirmPurchaseChallan(c.id, ACTOR, { tx });
        await rejects(tx, svc.confirmPurchaseChallan(c.id, ACTOR, { tx }), 409, /already confirmed/);
        await rejects(tx, svc.savePurchaseChallan(challanIn(W, { id: c.id }), ACTOR, { tx }), 409, /cannot be edited/);
      });
    });
  });

  // =====================================================================================================
  describe("purchase bill: pricing, landed cost, posting", () => {
    it("worked example: priced in sequence, landed cost split, journal balanced and posted", async () => {
      await run(async (tx, W) => {
        const s = await svc.savePurchaseBill(billIn(W, { terms: standardTerms(W), vendorInvoiceNo: "V-1001", dueDays: 30 }), ACTOR, { tx });
        expect(s).toMatchObject({ invoiceNumber: "0001", basicAmount: "2000.00", termAmount: "147.00", totalAmount: "2147.00" });
        expect(s.dueDate.toISOString().slice(0, 10)).toBe("2025-11-13");

        // landed cost: freight 100 split by value (50 / 50); discount and VAT are not cost
        const lines = await blines(tx, s.id);
        expect(lines.map((l) => [n2(l.allocatedTermAmount), n2(l.landedAmount), Number(l.landedRate).toFixed(2)])).toEqual([["50.00", "1050.00", "105.00"], ["50.00", "1050.00", "210.00"]]);
        const terms = await q(tx, sql`select t."termId", t."baseAmount", t."finalAmount" from "PurchaseDocumentTerm" t where t."documentId" = ${s.id} order by t.sequence`);
        expect(terms.map((t) => [n2(t.baseAmount), n2(t.finalAmount)])).toEqual([["2000.00", "200.00"], ["2000.00", "100.00"], ["1900.00", "247.00"]]);

        const p = await svc.postPurchaseBill(s.id, ACTOR, { tx });
        expect(p).toMatchObject({ isPosted: true, totalAmount: "2147.00", debit: "2347.00", credit: "2347.00" });
        expect(p.voucherNumber).toBe("PB-2082/83-0001");
        const v = await voucher(tx, p.journalVoucherId);
        expect(v.dr).toBe("2347.00");
        expect(v.cr).toBe("2347.00");
        expect(v.rows).toEqual([
          { gl: W.purchase, debit: "2000.00", credit: "0.00" }, // both lines share one purchase ledger -> one row
          { gl: W.discount, debit: "0.00", credit: "200.00" }, // terms follow in sequence: discount 10, freight 20, VAT 30
          { gl: W.freight, debit: "100.00", credit: "0.00" },
          { gl: W.vat, debit: "247.00", credit: "0.00" },
          { gl: W.vendor, debit: "0.00", credit: "2147.00" },
        ]);
        const b = await bill(tx, s.id);
        expect(b.isPosted).toBe(true);
        expect(b.journalVoucherId).toBe(p.journalVoucherId);
        const [jv] = await q(tx, sql`select "isPosted", "voucherDate", "fiscalYear" from "JournalVoucher" where id = ${p.journalVoucherId}`);
        expect(jv.isPosted).toBe(true);
        expect(jv.fiscalYear).toBe("2082/83");
      });
    });

    it("a posted bill is immutable and cannot be posted twice", async () => {
      await run(async (tx, W) => {
        const s = await svc.savePurchaseBill(billIn(W), ACTOR, { tx });
        await svc.postPurchaseBill(s.id, ACTOR, { tx });
        await rejects(tx, svc.savePurchaseBill(billIn(W, { id: s.id }), ACTOR, { tx }), 409, /posted bill cannot be edited/);
        await rejects(tx, svc.postPurchaseBill(s.id, ACTOR, { tx }), 409, /already posted/);
      });
    });

    it("editing a draft re-prices everything; due date can be typed", async () => {
      await run(async (tx, W) => {
        const s = await svc.savePurchaseBill(billIn(W, { terms: standardTerms(W) }), ACTOR, { tx });
        const e = await svc.savePurchaseBill(billIn(W, { id: s.id, lines: [{ productId: W.rice.id, qty: 10, rate: 100 }], terms: [{ termId: W.tVat }], dueDate: "2025-12-31" }), ACTOR, { tx });
        expect(e).toMatchObject({ basicAmount: "1000.00", termAmount: "130.00", totalAmount: "1130.00" });
        expect(e.dueDate.toISOString().slice(0, 10)).toBe("2025-12-31");
        expect((await blines(tx, s.id)).length).toBe(1);
        expect((await q(tx, sql`select count(*)::int as n from "PurchaseDocumentTerm" where "documentId" = ${s.id} and "documentType" = 'PURCHASE_BILL'`))[0].n).toBe(1);
      });
    });

    it("a productwise (line-level) term prices one line and is posted like any term", async () => {
      await run(async (tx, W) => {
        const s = await svc.savePurchaseBill(billIn(W, { terms: [{ termId: W.tLineDisc, lineNumber: 2 }, { termId: W.tVat }] }), ACTOR, { tx });
        // line 2 is 1000: 5% off = 50; VAT 13% of (2000 - 50) = 253.50
        expect(s).toMatchObject({ basicAmount: "2000.00", termAmount: "203.50", totalAmount: "2203.50" });
        const p = await svc.postPurchaseBill(s.id, ACTOR, { tx });
        const v = await voucher(tx, p.journalVoucherId);
        expect(v.dr).toBe(v.cr);
        expect(v.dr).toBe("2253.50"); // 2000 purchases + 253.50 VAT; the 50.00 discount and the vendor are the credits
        expect(v.rows.find((r) => r.gl === W.vendor)!.credit).toBe("2203.50");
        expect(v.rows.find((r) => r.gl === W.discount)!.credit).toBe("50.00");
      });
    });

    it("every Dr = Cr to the paisa even with awkward numbers", async () => {
      await run(async (tx, W) => {
        const s = await svc.savePurchaseBill(billIn(W, {
          lines: [{ productId: W.rice.id, qty: "3", rate: "33.333333" }, { productId: W.oil.id, qty: "7", rate: "14.285714" }, { productId: W.consult.id, qty: 1, rate: "0.01" }],
          terms: [{ termId: W.tDisc, rate: "7.5" }, { termId: W.tFreight, inputAmount: "100" }, { termId: W.tVat, rate: "13" }],
        }), ACTOR, { tx });
        const p = await svc.postPurchaseBill(s.id, ACTOR, { tx });
        expect(p.debit).toBe(p.credit);
        const lines = await blines(tx, s.id);
        expect(n2(lines.reduce((a, l) => a + Number(l.allocatedTermAmount), 0))).toBe("100.00"); // freight fully spread, not a paisa lost
      });
    });

    it("posting refuses what drafting allowed: no purchase ledger, term without ledger, zero total, mandatory term, tracked batch", async () => {
      await run(async (tx, W) => {
        const noGl = await svc.savePurchaseBill(billIn(W, { lines: [{ productId: W.nogl.id, qty: 1, rate: 10 }] }), ACTOR, { tx });
        await rejects(tx, svc.postPurchaseBill(noGl.id, ACTOR, { tx }), 409, /no purchase ledger/);
        const noTermGl = await svc.savePurchaseBill(billIn(W, { terms: [{ termId: W.tNoGL, inputAmount: 5 }] }), ACTOR, { tx });
        await rejects(tx, svc.postPurchaseBill(noTermGl.id, ACTOR, { tx }), 409, /has no ledger/);
        const zero = await svc.savePurchaseBill(billIn(W, { lines: [{ productId: W.rice.id, qty: 1, rate: 0 }] }), ACTOR, { tx });
        await rejects(tx, svc.postPurchaseBill(zero.id, ACTOR, { tx }), 409, /greater than zero/);
        const med = await svc.savePurchaseBill(billIn(W, { lines: [{ productId: W.med.id, qty: 1, rate: 10 }] }), ACTOR, { tx });
        await rejects(tx, svc.postPurchaseBill(med.id, ACTOR, { tx }), 409, /batch-tracked/);
        await svc.savePurchaseBill(billIn(W, { id: med.id, lines: [{ productId: W.med.id, qty: 1, rate: 10, batchNo: "B", expiryDate: "2027-01-01" }] }), ACTOR, { tx });
        await svc.postPurchaseBill(med.id, ACTOR, { tx });
        await tx.execute(sql`update "PurchaseTerm" set "isMandatory" = true where id = ${W.tVat}`);
        const plain = await svc.savePurchaseBill(billIn(W), ACTOR, { tx });
        await rejects(tx, svc.postPurchaseBill(plain.id, ACTOR, { tx }), 409, /Mandatory term/);
        // nothing half-posted
        expect((await bill(tx, plain.id)).isPosted).toBe(false);
        expect((await bill(tx, plain.id)).journalVoucherId).toBeNull();
      });
    });

    it("an import invoice needs a customs declaration number to post; import details only on IMPORT", async () => {
      await run(async (tx, W) => {
        await rejects(tx, svc.savePurchaseBill(billIn(W, { importDetail: { lcNo: "LC1" } }), ACTOR, { tx }), 400, /IMPORT invoice/);
        const s = await svc.savePurchaseBill(billIn(W, { invoiceType: "IMPORT", importDetail: { lcNo: "LC1", transportMode: "AIR" } }), ACTOR, { tx });
        await rejects(tx, svc.postPurchaseBill(s.id, ACTOR, { tx }), 409, /customs declaration number/);
        await svc.savePurchaseBill(billIn(W, { id: s.id, invoiceType: "IMPORT", importDetail: { customsDeclarationNo: "CD-55", customsDeclarationDate: "2025-10-12" } }), ACTOR, { tx });
        expect(await svc.postPurchaseBill(s.id, ACTOR, { tx })).toMatchObject({ isPosted: true });
      });
    });

    it("stock valuation: closing value = balance x rate by each product's own method (weighted average, FIFO, standard)", async () => {
      await run(async (tx, W) => {
        const val = async () => (await stockValuation(tx, { companyId: W.co, productId: W.rice.id })).rows[0];
        // 10 @ 100 arrives on a challan and is billed; 4 @ 130 comes on a direct bill
        const ch = await svc.savePurchaseChallan(challanIn(W, { lines: [{ productId: W.rice.id, qty: 10 }] }), ACTOR, { tx });
        await svc.confirmPurchaseChallan(ch.id, ACTOR, { tx });
        const [cl1] = await clines(tx, ch.id);
        const linked = await svc.savePurchaseBill(billIn(W, { purchaseChallanId: ch.id, lines: [{ productId: W.rice.id, qty: 10, rate: 100, challanLineId: cl1.id }] }), ACTOR, { tx });
        await svc.postPurchaseBill(linked.id, ACTOR, { tx });
        const direct = await svc.savePurchaseBill(billIn(W, { lines: [{ productId: W.rice.id, qty: 4, rate: 130 }] }), ACTOR, { tx });
        await svc.postPurchaseBill(direct.id, ACTOR, { tx });
        await tx.execute(sql`update "StockDetail" set "valuationMethod" = 'WEIGHTED_AVERAGE', "purchaseRate" = 90 where "productId" = ${W.rice.id}`);
        expect(await val()).toMatchObject({ qty: "14.000000", value: "1520.00", method: "WEIGHTED_AVERAGE" }); // (1000 + 520) / 14 = 108.571..

        // 5 go out on a sale (raw ledger row: the sale itself is tested elsewhere)
        const [any] = (await tx.execute(sql`select "branchId", "companyId" from "StockMovement" where "productId" = ${W.rice.id} limit 1`)) as any[];
        await tx.execute(sql`insert into "StockMovement" ("companyId","branchId","productId","movementDate","qty","sourceType","sourceId","sourceLineId") values (${any.companyId}, ${any.branchId}, ${W.rice.id}, '2025-11-01', -5, 'SALES_INVOICE', 1, 1)`);
        expect(await val()).toMatchObject({ qty: "9.000000", value: "977.14" }); // 9 x 108.571..
        await tx.execute(sql`update "StockDetail" set "valuationMethod" = 'FIFO' where "productId" = ${W.rice.id}`);
        expect(await val()).toMatchObject({ qty: "9.000000", value: "1020.00", method: "FIFO" }); // the oldest 5 @100 went; 5 @100 + 4 @130 are left
        await tx.execute(sql`update "StockDetail" set "valuationMethod" = 'STANDARD_COST' where "productId" = ${W.rice.id}`);
        expect(await val()).toMatchObject({ value: "810.00", method: "STANDARD_COST" }); // 9 x the standard 90

        // as of an earlier date the later sale is not counted
        expect((await stockValuation(tx, { companyId: W.co, productId: W.rice.id, asOf: "2025-10-31" })).rows[0]).toMatchObject({ qty: "14.000000" });
      });
    });

    it("opening stock enters the ledger on the first day of its year and is valued at its own rate", async () => {
      await run(async (tx, W) => {
        const fy = (await tx.execute(sql`select id from "FiscalYear" where "companyId" = ${W.co}`))[0].id as number;
        const br = (await tx.execute(sql`select id from "Branch" where "companyId" = ${W.co}`))[0].id as number;
        const sd = (await tx.execute(sql`select id from "StockDetail" where "productId" = ${W.rice.id}`))[0].id as number;
        await tx.execute(sql`update "StockDetail" set "valuationMethod" = 'WEIGHTED_AVERAGE' where id = ${sd}`);
        await ins(tx, "StockOpeningBalance", { branchId: br, fiscalYearId: fy, stockDetailId: sd, quantity: 8, rate: 50, value: 400, updatedAt: NOW });
        await syncOpeningMovements(tx, { companyId: W.co, branchId: br, fiscalYearId: fy });
        await syncOpeningMovements(tx, { companyId: W.co, branchId: br, fiscalYearId: fy }); // running it again changes nothing
        expect((await stockBalance(tx, { companyId: W.co, productId: W.rice.id })).reduce((a, r) => a + Number(r.qty), 0)).toBe(8);
        expect((await stockValuation(tx, { companyId: W.co, productId: W.rice.id })).rows[0]).toMatchObject({ qty: "8.000000", value: "400.00" });
        expect((await stockValuation(tx, { companyId: W.co, productId: W.rice.id, asOf: "2025-07-01" })).rows).toHaveLength(0); // before the year began
      });
    });

    it("automatic stock ledgers: closing stock (P&L, B/S) and opening stock (P&L) follow the stock, and always balance", async () => {
      await run(async (tx, W) => {
        const fy = (await tx.execute(sql`select id from "FiscalYear" where "companyId" = ${W.co}`))[0].id as number;
        const br = (await tx.execute(sql`select id from "Branch" where "companyId" = ${W.co}`))[0].id as number;
        const sd = (await tx.execute(sql`select id from "StockDetail" where "productId" = ${W.rice.id}`))[0].id as number;
        const [opl, cpl, cbs] = [await ins(tx, "GeneralLedger", { companyId: W.co, code: `OPL${uniq()}`.slice(0, 10), name: "Opening stock", accountGroupId: (await tx.execute(sql`select "accountGroupId" as id from "GeneralLedger" where id = ${W.purchase}`))[0].id, normalBalance: "DEBIT", updatedAt: NOW }),
          await ins(tx, "GeneralLedger", { companyId: W.co, code: `CPL${uniq()}`.slice(0, 10), name: "Closing stock P&L", accountGroupId: (await tx.execute(sql`select "accountGroupId" as id from "GeneralLedger" where id = ${W.purchase}`))[0].id, normalBalance: "CREDIT", updatedAt: NOW }),
          await ins(tx, "GeneralLedger", { companyId: W.co, code: `CBS${uniq()}`.slice(0, 10), name: "Closing stock B/S", accountGroupId: (await tx.execute(sql`select "accountGroupId" as id from "GeneralLedger" where id = ${W.purchase}`))[0].id, normalBalance: "DEBIT", updatedAt: NOW })];
        await tx.execute(sql`update "StockDetail" set "valuationMethod" = 'WEIGHTED_AVERAGE', "openingGLId" = ${opl}, "closingPLGLId" = ${cpl}, "closingBSGLId" = ${cbs} where id = ${sd}`);
        await ins(tx, "StockOpeningBalance", { branchId: br, fiscalYearId: fy, stockDetailId: sd, quantity: 8, rate: 50, value: 400, updatedAt: NOW });
        await syncOpeningMovements(tx, { companyId: W.co, branchId: br, fiscalYearId: fy });
        const direct = await svc.savePurchaseBill(billIn(W, { lines: [{ productId: W.rice.id, qty: 10, rate: 100 }] }), ACTOR, { tx });
        await svc.postPurchaseBill(direct.id, ACTOR, { tx });
        const at = (asOf: string) => stockLedgerBalances(tx, { companyId: W.co, branchId: br, fiscalYearId: fy, fyStart: "2025-07-17", asOf });
        const num = (m: Map<number, bigint>, id: number) => Number(m.get(id) ?? 0n) / 1e6;
        let b = await at("2026-07-16");
        // 8 @ 50 + 10 @ 100 = 18 units worth 1400: closing 1400 (Cr), opening 400 (Dr), B/S carries the rest (1000) on top of its opening balance
        expect([num(b, cpl), num(b, opl), num(b, cbs)]).toEqual([-1400, 400, 1000]);
        expect([...b.values()].reduce((a, v) => a + v, 0n)).toBe(0n);
        // a sale of 5 lowers the closing value at once; the three still balance
        const [m] = (await tx.execute(sql`select "companyId", "branchId" from "StockMovement" where "productId" = ${W.rice.id} limit 1`)) as any[];
        await tx.execute(sql`insert into "StockMovement" ("companyId","branchId","productId","movementDate","qty","sourceType","sourceId","sourceLineId") values (${m.companyId}, ${m.branchId}, ${W.rice.id}, '2026-01-10', -5, 'SALES_INVOICE', 1, 1)`);
        b = await at("2026-07-16");
        expect(num(b, cpl)).toBeCloseTo(-1011.11, 2);
        expect([...b.values()].reduce((a, v) => a + v, 0n)).toBe(0n);
        // before the year there is nothing; as on a date before the sale the sale is not counted
        expect((await at("2025-07-16")).size).toBe(0);
        expect(num(await at("2025-12-31"), cpl)).toBe(-1400);
        // report rows for a period: what stood before it, and the change inside it
        const rows = await stockAutoRows(tx, { companyId: W.co, branchId: br, fiscalYear: "2082/83", start: "2025-12-01", end: "2026-07-16" });
        expect(rows.filter((r) => r.generalLedgerId === cpl).map((r) => [r.d, Number(r.cr) / 1e6, Number(r.dr) / 1e6])).toEqual([["2025-11-30", 1400, 0], ["2026-07-16", 0, expect.closeTo(388.89, 2)]]);
        // the SQL form the reports join onto: net of the rows = the balance at the end
        const sums = (await tx.execute(sql`select sa.gl, sum(sa.dr - sa.cr)::text as net from ${stockAutoSql(rows)} group by sa.gl`)) as any[];
        expect(Number(sums.find((r) => Number(r.gl) === cpl).net)).toBeCloseTo(-1011.11, 2);
        expect(await tx.execute(sql`select * from ${stockAutoSql([])}`)).toHaveLength(0);
      });
    });

    it("stock: a challan brings goods in once, a bill with no challan brings its own, and reversing a bill takes back only what it brought", async () => {
      await run(async (tx, W) => {
        const on = async (productId: number) => Number((await stockBalance(tx, { companyId: W.co, productId })).reduce((a, r) => a + Number(r.qty), 0));
        const ch = await svc.savePurchaseChallan(challanIn(W, { lines: [{ productId: W.rice.id, qty: 10 }, { productId: W.oil.id, qty: 3 }] }), ACTOR, { tx });
        expect(await on(W.rice.id)).toBe(0); // a draft challan is not stock
        await svc.confirmPurchaseChallan(ch.id, ACTOR, { tx });
        expect([await on(W.rice.id), await on(W.oil.id)]).toEqual([10, 3]);

        // the bill that bills the challan does not bring the goods in a second time
        const [cl1] = await clines(tx, ch.id);
        const linked = await svc.savePurchaseBill(billIn(W, { purchaseChallanId: ch.id, lines: [{ productId: W.rice.id, qty: 10, rate: 100, challanLineId: cl1.id }] }), ACTOR, { tx });
        await svc.postPurchaseBill(linked.id, ACTOR, { tx });
        expect(await on(W.rice.id)).toBe(10);

        // a bill with no challan is the receipt
        const direct = await svc.savePurchaseBill(billIn(W, { lines: [{ productId: W.rice.id, qty: 4, rate: 100 }] }), ACTOR, { tx });
        expect(await on(W.rice.id)).toBe(10); // still a draft
        await svc.postPurchaseBill(direct.id, ACTOR, { tx });
        expect(await on(W.rice.id)).toBe(14);

        // reversing it takes its 4 back; reversing the challan-linked bill leaves the received 10
        await svc.reversePurchaseBill(direct.id, ACTOR, { tx, date: "2025-10-20", reason: "stock check" });
        expect(await on(W.rice.id)).toBe(10);
        await svc.reversePurchaseBill(linked.id, ACTOR, { tx, date: "2025-10-20", reason: "stock check" });
        expect(await on(W.rice.id)).toBe(10);
        expect(await on(W.oil.id)).toBe(3);
        // the ledger is append-only
        await expect(tx.execute(sql`update "StockMovement" set qty = 1 where "productId" = ${W.rice.id}`)).rejects.toThrow();
      });
    });

    it("an import bill in a foreign currency is typed in it, priced in NPR at the exchange rate, and reversed with the same figures", async () => {
      await run(async (tx, W) => {
        const imp = { customsDeclarationNo: "CD-USD-1", currencyCode: "usd", exchangeRate: "133.5" };
        const lines = [{ productId: W.rice.id, qty: 10, foreignRate: 2 }, { productId: W.oil.id, qty: 5, foreignRate: "1.5" }];
        await rejects(tx, svc.savePurchaseBill(billIn(W, { invoiceType: "IMPORT", importDetail: { ...imp, exchangeRate: undefined }, lines }), ACTOR, { tx }), 400, /exchange rate/);
        await rejects(tx, svc.savePurchaseBill(billIn(W, { invoiceType: "IMPORT", importDetail: imp, lines: [{ productId: W.rice.id, qty: 10 }] }), ACTOR, { tx }), 400, /rate in USD/);
        const s = await svc.savePurchaseBill(billIn(W, { invoiceType: "IMPORT", importDetail: imp, lines }), ACTOR, { tx });
        const ls = await blines(tx, s.id);
        expect(ls.map((l: any) => [Number(l.rate), Number(l.basicAmount), Number(l.foreignRate), Number(l.foreignAmount)])).toEqual([[267, 2670, 2, 20], [200.25, 1001.25, 1.5, 7.5]]);
        const [d] = await q(tx, sql`select "currencyCode", "foreignInvoiceAmount" from "PurchaseBillImportDetail" where "purchaseBillId" = ${s.id}`);
        expect(d.currencyCode).toBe("USD");
        expect(Number(d.foreignInvoiceAmount)).toBe(27.5); // worked out from the lines, not typed
        await svc.postPurchaseBill(s.id, ACTOR, { tx });
        const rev = await svc.reversePurchaseBill(s.id, ACTOR, { tx, date: "2025-10-20", reason: "usd check" });
        const rl = await blines(tx, rev.reversalBillId);
        expect(rl.map((l: any) => Number(l.foreignAmount))).toEqual([20, 7.5]);
      });
    });

    it("links separate service invoices into import CIF using each source basis, excludes input tax, and reverses cleanly", async () => {
      await run(async (tx, W) => {
        const goods = await svc.savePurchaseBill(billIn(W, {
          invoiceType: "IMPORT", importDetail: { customsDeclarationNo: "CD-CIF-1" },
        }), ACTOR, { tx });
        await svc.postPurchaseBill(goods.id, ACTOR, { tx });

        const insurance = await svc.savePurchaseBill(billIn(W, {
          invoiceType: "LOCAL", purchaseType: "SERVICE_PURCHASE_OTHERS",
          lines: [{ productId: W.consult.id, qty: 1, rate: 200 }],
          terms: [{ termId: W.tVat }], // Rs 26 input tax is recoverable and must not be capitalized into CIF.
          importCostForBillId: goods.id, importCostAllocationBasis: "VALUE",
        }), ACTOR, { tx });
        expect(insurance).toMatchObject({ basicAmount: "200.00", termAmount: "26.00", totalAmount: "226.00" });
        const insurancePost = await svc.postPurchaseBill(insurance.id, ACTOR, { tx });
        const serviceVoucher = await voucher(tx, insurancePost.journalVoucherId);
        expect(serviceVoucher.rows).toEqual([
          { gl: W.purchase, debit: "200.00", credit: "0.00" },
          { gl: W.vat, debit: "26.00", credit: "0.00" },
          { gl: W.vendor, debit: "0.00", credit: "226.00" },
        ]);

        const freight = await svc.savePurchaseBill(billIn(W, {
          invoiceType: "LOCAL", purchaseType: "SERVICE_PURCHASE_OTHERS",
          lines: [{ productId: W.consult.id, qty: 1, rate: 300 }],
          importCostForBillId: goods.id, importCostAllocationBasis: "QUANTITY", importCostTreatment: "LANDED_ONLY",
        }), ACTOR, { tx });
        await svc.postPurchaseBill(freight.id, ACTOR, { tx });
        let lines = await blines(tx, goods.id);
        expect(lines.map((line) => [n2(line.landedAmount), Number(line.landedRate).toFixed(2)])).toEqual([["1300.00", "130.00"], ["1200.00", "240.00"]]);
        const { importCostBasis } = await import("../server/services/purchase/importCostBasis");
        const amount = (micro: bigint) => (Number(micro) / 1_000_000).toFixed(2);
        let basis = await importCostBasis(tx, goods.id);
        expect([amount(basis.cifValue), amount(basis.landedValue), amount(basis.cifSourceCost), amount(basis.landedOnlyCost)]).toEqual(["2200.00", "2500.00", "200.00", "300.00"]);

        await svc.reversePurchaseBill(freight.id, ACTOR, { tx, date: "2025-10-20", reason: "Freight invoice corrected" });
        lines = await blines(tx, goods.id);
        expect(lines.map((line) => n2(line.landedAmount))).toEqual(["1100.00", "1100.00"]);
        basis = await importCostBasis(tx, goods.id);
        expect([amount(basis.cifValue), amount(basis.landedValue)]).toEqual(["2200.00", "2200.00"]);
        await svc.reversePurchaseBill(insurance.id, ACTOR, { tx, date: "2025-10-21", reason: "Insurance invoice corrected" });
        lines = await blines(tx, goods.id);
        expect(lines.map((line) => n2(line.landedAmount))).toEqual(["1000.00", "1000.00"]);
        basis = await importCostBasis(tx, goods.id);
        expect([amount(basis.cifValue), amount(basis.landedValue)]).toEqual(["2000.00", "2000.00"]);
      });
    });

    it("the vendor ledger and sub-ledger are validated", async () => {
      await run(async (tx, W) => {
        await rejects(tx, svc.savePurchaseBill(billIn(W, { vendorGLId: 999999 }), ACTOR, { tx }), 404, /Vendor ledger not found/);
        const sl = await ins(tx, "SubLedger", { generalLedgerId: W.customs, code: "S1", name: "Belongs to another ledger", updatedAt: NOW });
        await rejects(tx, svc.savePurchaseBill(billIn(W, { subLedgerId: sl }), ACTOR, { tx }), 400, /does not belong/);
        await tx.execute(sql`update "GeneralLedger" set "requiresSubLedger" = true where id = ${W.vendor}`);
        const s = await svc.savePurchaseBill(billIn(W), ACTOR, { tx });
        await rejects(tx, svc.postPurchaseBill(s.id, ACTOR, { tx }), 400, /needs a sub-ledger/);
      });
    });
  });

  // =====================================================================================================
  describe("order -> challan -> bill chain", () => {
    async function chain(tx: any, W: W) {
      const o = await mkOrder(tx, W);
      const [ol1, ol2] = await olines(tx, o.id);
      const c = await svc.savePurchaseChallan(challanIn(W, { purchaseOrderId: o.id, lines: [{ productId: W.rice.id, qty: 10, purchaseOrderLineId: ol1.id }, { productId: W.oil.id, qty: 5, purchaseOrderLineId: ol2.id }] }), ACTOR, { tx });
      await svc.confirmPurchaseChallan(c.id, ACTOR, { tx });
      const [cl1, cl2] = await clines(tx, c.id);
      return { o, ol1, ol2, c, cl1, cl2 };
    }

    it("a bill is built from the challan's pending quantities, and progress follows", async () => {
      await run(async (tx, W) => {
        const { o, c, cl1, ol1 } = await chain(tx, W);
        const draft = await svc.billInputFromChallan(c.id, { tx });
        expect(draft.lines.map((l) => [l.qty, l.challanLineId !== undefined])).toEqual([["10.000000", true], ["5.000000", true]]);
        expect(draft).toMatchObject({ purchaseChallanId: c.id, purchaseOrderId: o.id });
        const b = await svc.savePurchaseBill({ ...draft, invoiceDate: "2025-10-14", terms: [] }, ACTOR, { tx });
        expect(b.basicAmount).toBe("2000.00");
        await svc.postPurchaseBill(b.id, ACTOR, { tx });
        const cp = await svc.getPurchaseChallanProgress(c.id, { tx });
        expect(cp.lines.map((l) => [l.received, l.billed, l.pendingToBill])).toEqual([["10.000000", "10.000000", "0.000000"], ["5.000000", "5.000000", "0.000000"]]);
        const op = await svc.getPurchaseOrderProgress(o.id, { tx });
        expect(op.lines[0]).toMatchObject({ received: "10.000000", billed: "10.000000", pendingToBill: "0.000000" });
        await rejects(tx, svc.billInputFromChallan(c.id, { tx }), 409, /already been billed/);
        expect(cl1.id).toBeGreaterThan(0); expect(ol1.id).toBeGreaterThan(0);
      });
    });

    it("cannot bill more than the challan received; a draft reserves its quantity; partial bills add up", async () => {
      await run(async (tx, W) => {
        const { c, cl1, ol1 } = await chain(tx, W);
        const part = (qty: number, id?: number) => svc.savePurchaseBill({ ...billIn(W, { id, purchaseChallanId: c.id, purchaseOrderId: ol1 ? undefined : undefined, lines: [{ productId: W.rice.id, qty, rate: 100, challanLineId: cl1.id }] }) }, ACTOR, { tx });
        const a = await part(6);
        await rejects(tx, part(5), 409, /Challan line 1: billing 5\.000000 would exceed the 10\.000000 received \(already billed 6\.000000\)\. Pending: 4\.000000/);
        const b = await part(4);
        expect(b.id).not.toBe(a.id);
        await rejects(tx, part(1), 409, /would exceed/);
        // editing the draft itself does not count its own quantity twice
        await part(6, a.id);
      });
    });

    it("a reversed bill frees its quantity again", async () => {
      await run(async (tx, W) => {
        const { c, cl1 } = await chain(tx, W);
        const part = (qty: number) => svc.savePurchaseBill(billIn(W, { purchaseChallanId: c.id, lines: [{ productId: W.rice.id, qty, rate: 100, challanLineId: cl1.id }] }), ACTOR, { tx });
        const a = await part(10);
        await svc.postPurchaseBill(a.id, ACTOR, { tx });
        await rejects(tx, part(1), 409, /would exceed/);
        await svc.reversePurchaseBill(a.id, ACTOR, { tx, date: "2025-10-20" });
        const again = await part(10);
        expect(again.id).toBeGreaterThan(0);
      });
    });

    it("bill must come from the challan's vendor and needs a confirmed challan; unconfirmed / draft order refused", async () => {
      await run(async (tx, W) => {
        const { c, cl1 } = await chain(tx, W);
        await rejects(tx, svc.savePurchaseBill(billIn(W, { vendorGLId: W.customs, purchaseChallanId: c.id, lines: [{ productId: W.rice.id, qty: 1, rate: 1, challanLineId: cl1.id }] }), ACTOR, { tx }), 409, /Vendor mismatch/);
        const open = await svc.savePurchaseChallan(challanIn(W), ACTOR, { tx });
        await rejects(tx, svc.savePurchaseBill(billIn(W, { purchaseChallanId: open.id }), ACTOR, { tx }), 409, /not confirmed yet/);
        const draftOrder = await mkOrder(tx, W, {}, false);
        await rejects(tx, svc.savePurchaseBill(billIn(W, { purchaseOrderId: draftOrder.id }), ACTOR, { tx }), 409, /is DRAFT/);
      });
    });

    it("an order can be billed directly, without a challan, up to the ordered quantity", async () => {
      await run(async (tx, W) => {
        const { ol1 } = await chain(tx, W);
        const o2 = await mkOrder(tx, W);
        const [d1] = await olines(tx, o2.id);
        const mk = (qty: number) => svc.savePurchaseBill(billIn(W, { purchaseOrderId: o2.id, lines: [{ productId: W.rice.id, qty, rate: 100, purchaseOrderLineId: d1.id }] }), ACTOR, { tx });
        await mk(10);
        await rejects(tx, mk(1), 409, /Order line 1: billing 1\.000000 would exceed the 10\.000000 ordered/);
        expect(ol1.id).toBeGreaterThan(0);
      });
    });
  });

  // =====================================================================================================
  describe("additional bills and reversal", () => {
    const mainBill = async (tx: any, W: W) => {
      const s = await svc.savePurchaseBill(billIn(W, { terms: standardTerms(W) }), ACTOR, { tx });
      await svc.postPurchaseBill(s.id, ACTOR, { tx });
      return s;
    };
    const additional = (tx: any, W: W, mainBillId: number, amount = 300, over: any = {}) =>
      svc.savePurchaseBill({ companyId: W.co, branchId: W.br, invoiceDate: "2025-10-20", vendorGLId: W.customs, mainBillId, lines: [], terms: [{ termId: W.tDuty, inputAmount: amount }], ...over }, ACTOR, { tx });
    const landedOf = async (tx: any, id: number) => (await blines(tx, id)).map((l) => [n2(l.landedAmount), Number(l.landedRate).toFixed(2)]);

    it("duty arriving later re-values the MAIN bill's lines (split by quantity) once posted", async () => {
      await run(async (tx, W) => {
        const m = await mainBill(tx, W);
        expect(await landedOf(tx, m.id)).toEqual([["1050.00", "105.00"], ["1050.00", "210.00"]]);
        const a = await additional(tx, W, m.id, 300);
        expect(a).toMatchObject({ basicAmount: "0.00", termAmount: "300.00", totalAmount: "300.00" });
        // a draft additional bill does not change the main bill's cost yet
        expect(await landedOf(tx, m.id)).toEqual([["1050.00", "105.00"], ["1050.00", "210.00"]]);
        const p = await svc.postPurchaseBill(a.id, ACTOR, { tx });
        // 300 over qty 10 and 5 -> 200 / 100
        expect(await landedOf(tx, m.id)).toEqual([["1250.00", "125.00"], ["1150.00", "230.00"]]);
        const v = await voucher(tx, p.journalVoucherId);
        expect(v.rows).toEqual([{ gl: W.duty, debit: "300.00", credit: "0.00" }, { gl: W.customs, debit: "0.00", credit: "300.00" }]);
        expect(v.dr).toBe(v.cr);
      });
    });

    it("rules for additional bills: main must be posted, one level, no lines, needs a charge, COSTING terms only here", async () => {
      await run(async (tx, W) => {
        const draftMain = await svc.savePurchaseBill(billIn(W), ACTOR, { tx });
        await rejects(tx, additional(tx, W, draftMain.id), 409, /Post the main bill/);
        const m = await mainBill(tx, W);
        await rejects(tx, additional(tx, W, m.id, 300, { lines: [{ productId: W.rice.id, qty: 1, rate: 1 }] }), 400, /no item lines/);
        await rejects(tx, additional(tx, W, m.id, 300, { terms: [] }), 400, /at least one charge/);
        await rejects(tx, svc.savePurchaseBill(billIn(W, { terms: [{ termId: W.tDuty, inputAmount: 5 }] }), ACTOR, { tx }), 400, /only be entered on an additional purchase bill/);
        const a = await additional(tx, W, m.id);
        await svc.postPurchaseBill(a.id, ACTOR, { tx });
        await rejects(tx, additional(tx, W, a.id), 400, /another additional bill/);
        await rejects(tx, svc.savePurchaseBill(billIn(W, { id: m.id, mainBillId: m.id }), ACTOR, { tx }), 409, /posted bill cannot be edited/);
      });
    });

    it("reversing an additional bill takes its duty back off the main bill's cost", async () => {
      await run(async (tx, W) => {
        const m = await mainBill(tx, W);
        const a = await additional(tx, W, m.id, 300);
        await svc.postPurchaseBill(a.id, ACTOR, { tx });
        expect(await landedOf(tx, m.id)).toEqual([["1250.00", "125.00"], ["1150.00", "230.00"]]);
        await svc.reversePurchaseBill(a.id, ACTOR, { tx, date: "2025-10-25" });
        expect(await landedOf(tx, m.id)).toEqual([["1050.00", "105.00"], ["1050.00", "210.00"]]);
      });
    });

    it("the main bill cannot be reversed while a live additional bill stands", async () => {
      await run(async (tx, W) => {
        const m = await mainBill(tx, W);
        const a = await additional(tx, W, m.id);
        await svc.postPurchaseBill(a.id, ACTOR, { tx });
        await rejects(tx, svc.reversePurchaseBill(m.id, ACTOR, { tx, date: "2025-10-25" }), 409, /Reverse this bill's additional bills first/);
        await svc.reversePurchaseBill(a.id, ACTOR, { tx, date: "2025-10-25" });
        expect(await svc.reversePurchaseBill(m.id, ACTOR, { tx, date: "2025-10-26" })).toHaveProperty("reversalBillId");
      });
    });

    it("reversal: a new posted bill and a voucher with Dr and Cr swapped; the original is untouched; only once", async () => {
      await run(async (tx, W) => {
        const m = await mainBill(tx, W);
        const [orig] = await q(tx, sql`select "journalVoucherId", "totalAmount" from "PurchaseBill" where id = ${m.id}`);
        const r = await svc.reversePurchaseBill(m.id, ACTOR, { tx, date: "2025-10-30", reason: "wrong vendor" });
        expect(r.invoiceNumber).toBe("R-0001");
        const before = await voucher(tx, orig.journalVoucherId);
        const after = await voucher(tx, r.reversalVoucherId);
        expect(after.rows).toEqual(before.rows.map((x) => ({ gl: x.gl, debit: x.credit, credit: x.debit })));
        expect(after.dr).toBe(after.cr);
        const rb = await bill(tx, r.reversalBillId);
        expect(rb).toMatchObject({ isPosted: true, reversalOfId: m.id });
        expect(n2(rb.totalAmount)).toBe("2147.00");
        expect(rb.vendorInvoiceNo).toBeNull();
        expect((await blines(tx, rb.id)).length).toBe(2);
        const [jv] = await q(tx, sql`select "reversalOfId", "voucherDate" from "JournalVoucher" where id = ${r.reversalVoucherId}`);
        expect(jv.reversalOfId).toBe(orig.journalVoucherId);
        expect((await bill(tx, m.id)).isPosted).toBe(true); // original stays as it was
        await rejects(tx, svc.reversePurchaseBill(m.id, ACTOR, { tx, date: "2025-10-31" }), 409, /already been reversed/);
        await rejects(tx, svc.reversePurchaseBill(r.reversalBillId, ACTOR, { tx, date: "2025-10-31" }), 409, /cannot itself be reversed/);
      });
    });

    it("reversal guards: draft bills, dates before the bill, closed fiscal year", async () => {
      await run(async (tx, W) => {
        const draft = await svc.savePurchaseBill(billIn(W), ACTOR, { tx });
        await rejects(tx, svc.reversePurchaseBill(draft.id, ACTOR, { tx }), 409, /Only a posted bill/);
        const m = await mainBill(tx, W);
        await rejects(tx, svc.reversePurchaseBill(m.id, ACTOR, { tx, date: "2025-10-01" }), 400, /before the bill/);
        await tx.execute(sql`update "FiscalYear" set "isClosed" = true where "companyId" = ${W.co}`);
        await rejects(tx, svc.reversePurchaseBill(m.id, ACTOR, { tx, date: "2025-10-30" }), 409, /closed/);
      });
    });
  });

  // =====================================================================================================
  describe("bill rules found in the review", () => {
    it("a draft whose deductions exceed the items and charges is refused, not stored with a negative total", async () => {
      await run(async (tx, W) => {
        // items 2000, discount 150% = 3000 off -> total -1000
        await rejects(tx, svc.savePurchaseBill(billIn(W, { terms: [{ termId: W.tDisc, rate: 150 }] }), ACTOR, { tx }), 400, /total would be -1000\.00/);
        const ok = await svc.savePurchaseBill(billIn(W, { terms: [{ termId: W.tDisc, rate: 100 }] }), ACTOR, { tx }); // a total of exactly zero is a draft, only posting refuses it
        expect(ok.totalAmount).toBe("0.00");
      });
    });

    it("the lines must be the kind of product the purchase type says (checked when saving and again when posting)", async () => {
      await run(async (tx, W) => {
        await rejects(tx, svc.savePurchaseBill(billIn(W, { purchaseType: "SERVICE_PURCHASE_OTHERS" }), ACTOR, { tx }), 400, /stock product does not belong on a Service purchase \(others\) bill/);
        await rejects(tx, svc.savePurchaseBill(billIn(W, { purchaseType: "GOODS_PURCHASE_CAPITAL" }), ACTOR, { tx }), 400, /Line 1: a stock product does not belong on a Goods purchase \(capital\) bill/);
        // a non-stock item is an expense-type item and may be bought on a goods or a service bill
        await svc.savePurchaseBill(billIn(W, { purchaseType: "SERVICE_PURCHASE_OTHERS", lines: [{ productId: W.consult.id, qty: 1, rate: 100 }] }), ACTOR, { tx });
        // a draft saved before the rule existed is caught at posting: change its type underneath it
        const draft = await svc.savePurchaseBill(billIn(W), ACTOR, { tx });
        await tx.execute(sql`update "PurchaseBill" set "purchaseType" = 'SERVICE_PURCHASE_OTHERS' where id = ${draft.id}`);
        await rejects(tx, svc.postPurchaseBill(draft.id, ACTOR, { tx }), 400, /does not belong on a Service purchase \(others\) bill/);
      });
    });

    it("today() (the default invoice and reversal date) is the date in Nepal, not the date in UTC", async () => {
      const { dateInZone } = await import("../shared/businessDate");
      expect(dateInZone(new Date("2026-11-11T22:00:00Z")).toISOString().slice(0, 10)).toBe("2026-11-12"); // 03:45 on 12 Nov in Kathmandu
      expect(dateInZone(new Date("2026-11-11T22:00:00Z"), "UTC").toISOString().slice(0, 10)).toBe("2026-11-11");
      expect(dateInZone(new Date("2026-11-11T18:14:00Z")).toISOString().slice(0, 10)).toBe("2026-11-11"); // 23:59 in Kathmandu, still the 11th
      expect(dateInZone(new Date("2026-11-11T18:15:00Z")).toISOString().slice(0, 10)).toBe("2026-11-12"); // 00:00 NPT
      const { today } = await import("../server/services/purchase/common");
      expect(today().getTime()).toBe(dateInZone(new Date()).getTime());
    });
  });
  // =====================================================================================================
  describe("TDS flag, post-time warnings, landed cost guard, purchase return, reverse and correct", () => {
    const post = async (tx: any, W: W, over: any = {}) => {
      const s = await svc.savePurchaseBill(billIn(W, { terms: standardTerms(W), ...over }), ACTOR, { tx });
      return { s, p: await svc.postPurchaseBill(s.id, ACTOR, { tx }) };
    };
    const stock = async (tx: any, W: W, productId: number) => Number((await stockBalance(tx, { companyId: W.co, productId })).reduce((a: number, r: any) => a + Number(r.qty), 0));

    it("the TDS flag is saved on the bill, carried to a reversal and to a corrected copy", async () => {
      await run(async (tx, W) => {
        const s = await svc.savePurchaseBill(billIn(W, { tdsApplicable: true, terms: standardTerms(W) }), ACTOR, { tx });
        expect((await bill(tx, s.id)).tdsApplicable).toBe(true);
        const off = await svc.savePurchaseBill(billIn(W, { terms: standardTerms(W) }), ACTOR, { tx });
        expect((await bill(tx, off.id)).tdsApplicable).toBe(false);
        await svc.postPurchaseBill(s.id, ACTOR, { tx });
        const r = await svc.reverseAndCopyPurchaseBill(s.id, W.co, ACTOR, { tx, date: "2025-10-20", reason: "wrong vendor rate" });
        expect((await bill(tx, r.reversal.reversalBillId)).tdsApplicable).toBe(true);
        expect((await bill(tx, r.draft.id)).tdsApplicable).toBe(true);
      });
    });

    it("posting tells about a vendor invoice with no date, dated after the bill, or outside the fiscal year (and still posts)", async () => {
      await run(async (tx, W) => {
        const a = await post(tx, W, { vendorInvoiceNo: "W-1" });
        expect(a.p.isPosted).toBe(true);
        expect(a.p.warnings).toEqual([expect.stringMatching(/Vendor invoice W-1 has no date/)]);
        const b = await post(tx, W, { vendorInvoiceNo: "W-2", vendorInvoiceDate: "2025-10-20" });
        expect(b.p.warnings).toEqual([expect.stringMatching(/dated 2025-10-20, after the bill date 2025-10-14/)]);
        const c = await post(tx, W, { vendorInvoiceNo: "W-3", vendorInvoiceDate: "2025-06-01" });
        expect(c.p.warnings).toEqual([expect.stringMatching(/2025-06-01 is outside fiscal year 2082\/83/)]);
        const ok = await post(tx, W, { vendorInvoiceNo: "W-4", vendorInvoiceDate: "2025-10-10" });
        expect(ok.p.warnings).toEqual([]);
      });
    });

    it("duty that arrives after goods were sold says how much of it falls on the sold goods", async () => {
      await run(async (tx, W) => {
        const m = await post(tx, W);
        await ins(tx, "StockMovement", { companyId: W.co, branchId: W.br, productId: W.rice.id, movementDate: "2025-10-16", qty: -8, sourceType: "SALES_INVOICE", sourceId: 1, sourceLineId: 1 });
        const a = await svc.savePurchaseBill({ companyId: W.co, branchId: W.br, invoiceDate: "2025-10-20", vendorGLId: W.customs, mainBillId: m.s.id, lines: [], terms: [{ termId: W.tDuty, inputAmount: 300 }] }, ACTOR, { tx });
        const p = await svc.postPurchaseBill(a.id, ACTOR, { tx });
        const rice = p.revaluation.find((r: any) => r.lineNumber === 1)!, oil = p.revaluation.find((r: any) => r.lineNumber === 2)!;
        expect(rice).toMatchObject({ addedCost: "200.00", costOnSoldStock: "160.00" });
        expect(Number(rice.soldQty)).toBe(8);
        expect(Number(rice.unsoldQty)).toBe(2);
        expect(oil).toMatchObject({ addedCost: "100.00", costOnSoldStock: "0.00" });
        expect(p.warnings.join(" ")).toMatch(/Line 1 of the goods bill: 200\.00 of added cost, about 160\.00 of it on/);
      });
    });

    it("a charge already added to stock value through an additional bill is flagged (not blocked) when a cost assessment adds it again", async () => {
      await run(async (tx, W) => {
        const m = await post(tx, W);
        const a = await svc.savePurchaseBill({ companyId: W.co, branchId: W.br, invoiceDate: "2025-10-20", vendorGLId: W.customs, mainBillId: m.s.id, lines: [], terms: [{ termId: W.tDuty, inputAmount: 300 }] }, ACTOR, { tx });
        await svc.postPurchaseBill(a.id, ACTOR, { tx });
        const draft = await svc.createImportAssessment({ companyId: W.co, branchId: W.br, importBillId: m.s.id, assessmentDate: "2025-10-21", terms: [{ termId: W.tDuty, calcType: "AMOUNT", inputAmount: "300", allocationBasis: "QUANTITY", capitalizable: true, againstLedgerId: W.customs } as any] }, ACTOR, { tx });
        const applied = await svc.applyImportAssessment(draft.id, W.co, ACTOR, { tx });
        expect(applied.warnings.join(" ")).toMatch(/is also added to the stock value on bill .*not counted twice/);
      });
    });

    describe("purchase return", () => {
      it("returns part of a bill: balanced debit note in the share returned, stock out, quantity tracked", async () => {
        await run(async (tx, W) => {
          const { s } = await post(tx, W);
          const [l1] = await blines(tx, s.id);
          expect(await stock(tx, W, W.rice.id)).toBe(10);
          const r = await svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", reason: "damaged", lines: [{ billLineId: l1.id, qty: 4 }] }, ACTOR, { tx });
          expect(r).toMatchObject({ basicAmount: "400.00", termAmount: "29.40", totalAmount: "429.40" });
          const v = await voucher(tx, r.journalVoucherId);
          expect(v.rows).toEqual([
            { gl: W.purchase, debit: "0.00", credit: "400.00" },
            { gl: W.discount, debit: "40.00", credit: "0.00" }, // the discount of the goods returned is given back
            { gl: W.freight, debit: "0.00", credit: "20.00" },
            { gl: W.vat, debit: "0.00", credit: "49.40" },
            { gl: W.vendor, debit: "429.40", credit: "0.00" },
          ]);
          expect(v.dr).toBe(v.cr);
          const rb = await bill(tx, r.returnBillId);
          expect(rb).toMatchObject({ isPosted: true, returnOfBillId: s.id });
          expect(n2(rb.totalAmount)).toBe("429.40");
          expect(await stock(tx, W, W.rice.id)).toBe(6);
          const [rl] = await blines(tx, r.returnBillId);
          expect(rl.returnOfLineId).toBe(l1.id);
          // the original stays live, and what is left to return is known
          expect((await bill(tx, s.id)).isPosted).toBe(true);
          const left = await svc.returnedQtyByLine(tx, [l1.id]);
          expect(Number(left.get(l1.id)) / 1e6).toBe(4);
        });
      });

      it("refuses more than is left, stock that is not there, a draft, a reversal and an import bill", async () => {
        await run(async (tx, W) => {
          const { s } = await post(tx, W);
          const [l1, l2] = await blines(tx, s.id);
          await svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", lines: [{ billLineId: l1.id, qty: 4 }] }, ACTOR, { tx });
          await rejects(tx, svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", lines: [{ billLineId: l1.id, qty: 7 }] }, ACTOR, { tx }), 409, /more than what is left to return/);
          await rejects(tx, svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", lines: [{ billLineId: l1.id, qty: 0 }] }, ACTOR, { tx }), 400, /more than zero/);
          await rejects(tx, svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-01", lines: [{ billLineId: l1.id, qty: 1 }] }, ACTOR, { tx }), 400, /before the bill/);
          await rejects(tx, svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", lines: [] }, ACTOR, { tx }), 400, /at least one line/);
          // oil already sold: only 1 on hand
          await ins(tx, "StockMovement", { companyId: W.co, branchId: W.br, productId: W.oil.id, movementDate: "2025-10-16", qty: -4, sourceType: "SALES_INVOICE", sourceId: 1, sourceLineId: 1 });
          await rejects(tx, svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", lines: [{ billLineId: l2.id, qty: 2 }] }, ACTOR, { tx }), 409, /not enough stock/);
          const draft = await svc.savePurchaseBill(billIn(W), ACTOR, { tx });
          await rejects(tx, svc.createPurchaseReturn({ companyId: W.co, billId: draft.id, lines: [{ billLineId: l1.id, qty: 1 }] }, ACTOR, { tx }), 409, /Only a posted bill/);
          const rev = await svc.reversePurchaseBill(s.id, ACTOR, { tx, date: "2025-10-25" }).catch((e: any) => e);
          expect(rev.status).toBe(409); // its return still stands
          expect(rev.message).toMatch(/Reverse this bill's purchase returns first/);
        });
      });

      it("a wrong return is reversed like any bill: stock comes back and the quantity can be returned again", async () => {
        await run(async (tx, W) => {
          const { s } = await post(tx, W);
          const [l1] = await blines(tx, s.id);
          const r = await svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", lines: [{ billLineId: l1.id, qty: 10 }] }, ACTOR, { tx });
          expect(await stock(tx, W, W.rice.id)).toBe(0);
          await rejects(tx, svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-20", lines: [{ billLineId: l1.id, qty: 1 }] }, ACTOR, { tx }), 409, /more than what is left to return/);
          await svc.reversePurchaseBill(r.returnBillId, ACTOR, { tx, date: "2025-10-21", reason: "returned by mistake" });
          expect(await stock(tx, W, W.rice.id)).toBe(10);
          expect((await svc.returnedQtyByLine(tx, [l1.id])).get(l1.id)).toBeUndefined();
          await svc.createPurchaseReturn({ companyId: W.co, billId: s.id, returnDate: "2025-10-22", lines: [{ billLineId: l1.id, qty: 10 }] }, ACTOR, { tx });
          expect(await stock(tx, W, W.rice.id)).toBe(0);
        });
      });
    });

    it("reverse and correct: the bill is reversed and a draft copy with the same lines, terms and header is ready to fix", async () => {
      await run(async (tx, W) => {
        const { s } = await post(tx, W, { vendorInvoiceNo: "CORR-1", vendorInvoiceDate: "2025-10-10", remarks: "first try" });
        const r = await svc.reverseAndCopyPurchaseBill(s.id, W.co, ACTOR, { tx, date: "2025-10-20", reason: "rate was wrong" });
        expect((await q(tx, sql`select 1 from "PurchaseBill" where "reversalOfId" = ${s.id} and "isPosted"`)).length).toBe(1);
        const d = await bill(tx, r.draft.id);
        expect(d).toMatchObject({ isPosted: false, vendorInvoiceNo: "CORR-1", remarks: "first try" });
        expect(new Date(d.invoiceDate).toISOString().slice(0, 10)).toBe("2025-10-20");
        expect(n2(d.totalAmount)).toBe("2147.00");
        expect((await blines(tx, d.id)).map((l) => [l.productId, Number(l.qty), Number(l.rate)])).toEqual([[W.rice.id, 10, 100], [W.oil.id, 5, 200]]);
        expect((await q(tx, sql`select t."termId" from "PurchaseDocumentTerm" t where t."documentId" = ${d.id} and t."documentType" = 'PURCHASE_BILL' order by t.sequence`)).map((t) => t.termId)).toEqual([W.tDisc, W.tFreight, W.tVat]);
        // a draft cannot be corrected this way, and a failed reversal leaves no stray draft
        await rejects(tx, svc.reverseAndCopyPurchaseBill(d.id, W.co, ACTOR, { tx }), 409, /Only a posted bill can be reversed/);
        const before = (await q(tx, sql`select count(*)::int as n from "PurchaseBill" where "companyId" = ${W.co}`))[0].n;
        const again = await svc.reverseAndCopyPurchaseBill(s.id, W.co, ACTOR, { tx }).catch((e: any) => e);
        expect(again.status).toBe(409);
        expect((await q(tx, sql`select count(*)::int as n from "PurchaseBill" where "companyId" = ${W.co}`))[0].n).toBe(before);
      });
    });
  });
});
