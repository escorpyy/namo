import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

// Purchase order and challan (goods receipt) rules enforced by the database itself: status stamps, quantity and date
// checks, the order -> challan -> bill chain (same vendor, same product, right document), order-level billing terms,
// and company isolation. Every test runs in a transaction that is always rolled back.
describe.skipIf(!DB_READY)("purchase order and challan (database level)", () => {
  let db: any;
  class Rollback extends Error {}
  const NOW = sql`now()`;

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
  });

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };

  type Co = { co: number; br: number; vendor: number; vendor2: number; product: number; product2: number; unit: number; loc: number; general: number; additional: number };

  async function company(tx: any, tag: string, side: string): Promise<Co> {
    const c = (s: string) => `${s}${side}${tag}`.slice(0, 20);
    const co = await ins(tx, "Company", { code: c("T"), name: `Test ${side}${tag}`, updatedAt: NOW });
    const br = await ins(tx, "Branch", { companyId: co, code: c("B"), name: `Branch ${side}${tag}`, updatedAt: NOW });
    const grp = await ins(tx, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "LIABILITY", updatedAt: NOW });
    const sg = await ins(tx, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const vendor = await ins(tx, "GeneralLedger", { companyId: co, code: c("L1"), name: "Vendor", accountSubGroupId: sg, normalBalance: "CREDIT", updatedAt: NOW });
    const vendor2 = await ins(tx, "GeneralLedger", { companyId: co, code: c("L2"), name: "Other vendor", accountSubGroupId: sg, normalBalance: "CREDIT", updatedAt: NOW });
    const unit = await ins(tx, "ProductUnit", { companyId: co, code: c("U"), name: "Unit", updatedAt: NOW });
    const pg = await ins(tx, "ProductGroup", { companyId: co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins(tx, "ProductSubGroup", { code: c("PS"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    const product = await ins(tx, "Product", { companyId: co, code: c("P"), description: "Prod", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    const product2 = await ins(tx, "Product", { companyId: co, code: c("P2"), description: "Prod 2", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    const loc = await ins(tx, "Location", { companyId: co, code: c("LC"), name: "Loc", updatedAt: NOW });
    const general = await ins(tx, "PurchaseTerm", { companyId: co, code: c("T1"), name: "Discount", nature: "DEDUCTIVE", category: "GENERAL", updatedAt: NOW });
    const additional = await ins(tx, "PurchaseTerm", { companyId: co, code: c("T2"), name: "Import duty", nature: "ADDITIVE", category: "ADDITIONAL", updatedAt: NOW });
    return { co, br, vendor, vendor2, product, product2, unit, loc, general, additional };
  }

  const run = async (body: (tx: any, A: Co, B: Co) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        const tag = uniq();
        await body(tx, await company(tx, tag, "A"), await company(tx, tag, "B"));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };

  const order = (tx: any, A: Co, over: Record<string, unknown> = {}) =>
    ins(tx, "PurchaseOrder", { companyId: A.co, branchId: A.br, orderNumber: uniq().slice(0, 12), orderDate: "2025-10-01", fiscalYear: "2082/83", vendorGLId: A.vendor, updatedAt: NOW, ...over });
  const oline = (tx: any, A: Co, orderId: number, n = 1, over: Record<string, unknown> = {}) =>
    ins(tx, "PurchaseOrderLine", { purchaseOrderId: orderId, lineNumber: n, productId: A.product, qty: 10, unitId: A.unit, rate: 5, basicAmount: 50, ...over });
  const challan = (tx: any, A: Co, over: Record<string, unknown> = {}) =>
    ins(tx, "PurchaseChallan", { companyId: A.co, branchId: A.br, challanNumber: uniq().slice(0, 12), challanDate: "2025-10-10", fiscalYear: "2082/83", vendorGLId: A.vendor, updatedAt: NOW, ...over });
  const cline = (tx: any, A: Co, challanId: number, n = 1, over: Record<string, unknown> = {}) =>
    ins(tx, "PurchaseChallanLine", { purchaseChallanId: challanId, lineNumber: n, productId: A.product, qty: 10, unitId: A.unit, rate: 5, basicAmount: 50, ...over });
  const bill = (tx: any, A: Co, over: Record<string, unknown> = {}) =>
    ins(tx, "PurchaseBill", { companyId: A.co, branchId: A.br, invoiceNumber: uniq().slice(0, 12), invoiceDate: "2025-10-14", fiscalYear: "2082/83", vendorGLId: A.vendor, updatedAt: NOW, ...over });
  const bline = (tx: any, A: Co, billId: number, n = 1, over: Record<string, unknown> = {}) =>
    ins(tx, "PurchaseBillLine", { purchaseBillId: billId, lineNumber: n, productId: A.product, qty: 10, unitId: A.unit, rate: 5, basicAmount: 50, ...over });

  // The statement must be refused with this SQLSTATE and a message matching `msg`.
  const refused = async (tx: any, run: () => Promise<unknown>, code: string, msg: RegExp) => {
    let err: any;
    try { await tx.transaction(async () => { await run(); }); } catch (e) { err = e; }
    expect(err, "statement should have been refused").toBeDefined();
    const cause = err.cause ?? err;
    expect(cause.code, cause.message).toBe(code);
    expect(cause.message).toMatch(msg);
  };
  const CHECK = "23514";
  const FK = "23503";
  const UNIQUE = "23505";
  const count = async (tx: any, q: any) => ((await tx.execute(q)) as any[])[0].n as number;

  describe("purchase order", () => {
    it("control: a valid order with lines is accepted and starts as DRAFT", async () => {
      await run(async (tx, A) => {
        const id = await order(tx, A, { expectedDate: "2025-10-20" });
        await oline(tx, A, id, 1, { altQty: 2, altUnitId: A.unit, expectedDate: "2025-10-18" });
        await oline(tx, A, id, 2, { productId: A.product2 });
        const r = (await tx.execute(sql`select status from "PurchaseOrder" where id = ${id}`))[0];
        expect(r.status).toBe("DRAFT");
      });
    });

    it("an approved order needs approvedAt, a closed order needs closedAt; a cancelled draft needs neither", async () => {
      await run(async (tx, A) => {
        await refused(tx, () => order(tx, A, { status: "APPROVED" }), CHECK, /approved_check/);
        await order(tx, A, { status: "APPROVED", approvedAt: NOW });
        await refused(tx, () => order(tx, A, { status: "CLOSED", approvedAt: NOW }), CHECK, /closed_check/);
        await order(tx, A, { status: "CLOSED", approvedAt: NOW, closedAt: NOW });
        await order(tx, A, { status: "CANCELLED" });
      });
    });

    it("expected date cannot be before the order date", async () => {
      await run(async (tx, A) => {
        await refused(tx, () => order(tx, A, { expectedDate: "2025-09-30" }), CHECK, /expected_check/);
      });
    });

    it("a line must order a positive quantity; alt qty and alt unit come as a pair; line numbers are positive and unique", async () => {
      await run(async (tx, A) => {
        const id = await order(tx, A);
        await refused(tx, () => oline(tx, A, id, 1, { qty: 0 }), CHECK, /amounts_check/);
        await refused(tx, () => oline(tx, A, id, 1, { rate: -1 }), CHECK, /amounts_check/);
        await refused(tx, () => oline(tx, A, id, 1, { altQty: 2 }), CHECK, /alt_pair_check/);
        await refused(tx, () => oline(tx, A, id, 0), CHECK, /lineNumber_check/);
        await oline(tx, A, id, 1);
        await refused(tx, () => oline(tx, A, id, 1), UNIQUE, /lineNumber_key/);
      });
    });

    it("duplicate order number in one branch and fiscal year is refused", async () => {
      await run(async (tx, A) => {
        await order(tx, A, { orderNumber: "01" });
        await refused(tx, () => order(tx, A, { orderNumber: "01" }), UNIQUE, /orderNumber/);
      });
    });

    it("vendor ledger, product and unit of another company are refused; company cannot change", async () => {
      await run(async (tx, A, B) => {
        await refused(tx, () => order(tx, A, { vendorGLId: B.vendor }), CHECK, /company/i);
        const id = await order(tx, A);
        await refused(tx, () => oline(tx, A, id, 1, { productId: B.product }), CHECK, /company/i);
        await refused(tx, () => oline(tx, A, id, 1, { unitId: B.unit }), CHECK, /company/i);
        await refused(tx, () => tx.execute(sql`update "PurchaseOrder" set "companyId" = ${B.co} where id = ${id}`), CHECK, /cannot be changed|company/i);
      });
    });
  });

  describe("order-level billing terms", () => {
    const term = (tx: any, A: Co, orderId: number, termId: number, over: Record<string, unknown> = {}) =>
      ins(tx, "PurchaseDocumentTerm", { companyId: A.co, documentType: "PURCHASE_ORDER", documentId: orderId, termId, sequence: 100, nature: "ADDITIVE", calcBase: "ITEM_VALUE", calcType: "AMOUNT", inputAmount: 100, updatedAt: NOW, ...over });

    it("a GENERAL term is fine on an order; an ADDITIONAL term (actual charge) is refused", async () => {
      await run(async (tx, A) => {
        const id = await order(tx, A);
        await term(tx, A, id, A.general, { nature: "DEDUCTIVE" });
        await refused(tx, () => term(tx, A, id, A.additional), CHECK, /only be entered on an additional purchase bill/i);
      });
    });

    it("a term must point at a real order of its own company, a line term at a line of that order", async () => {
      await run(async (tx, A, B) => {
        await refused(tx, () => term(tx, A, 999999, A.general), CHECK, /does not exist/i);
        const otherCo = await order(tx, B);
        await refused(tx, () => term(tx, A, otherCo, A.general), CHECK, /company/i);
        const o1 = await order(tx, A);
        const o2 = await order(tx, A);
        const l2 = await oline(tx, A, o2);
        await refused(tx, () => term(tx, A, o1, A.general, { documentLineId: l2 }), CHECK, /not a line of purchase order/i);
        await term(tx, A, o2, A.general, { documentLineId: l2 });
      });
    });

    it("an allocation goes to a line of its own order only; a line-level term cannot be allocated", async () => {
      await run(async (tx, A) => {
        const o1 = await order(tx, A);
        const l1 = await oline(tx, A, o1);
        const o2 = await order(tx, A);
        const l2 = await oline(tx, A, o2);
        const t = await term(tx, A, o1, A.general, { distributeToLines: true, allocationBasis: "VALUE" });
        await ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: l1, allocatedAmount: 10 });
        await refused(tx, () => ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: l2, allocatedAmount: 10 }), CHECK, /not to the order of this term/i);
        await refused(tx, () => ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: 999999, allocatedAmount: 10 }), CHECK, /not a purchase order line/i);
        const lt = await term(tx, A, o1, A.general, { documentLineId: l1 });
        await refused(tx, () => ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: lt, documentLineId: l1, allocatedAmount: 1 }), CHECK, /line-level term/i);
      });
    });

    it("deleting an order line removes its terms and allocations; deleting the order removes all its terms", async () => {
      await run(async (tx, A) => {
        const o = await order(tx, A);
        const l1 = await oline(tx, A, o, 1);
        const l2 = await oline(tx, A, o, 2);
        const header = await term(tx, A, o, A.general, { distributeToLines: true, allocationBasis: "VALUE" });
        await ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: header, documentLineId: l1, allocatedAmount: 5 });
        const lineTerm = await term(tx, A, o, A.general, { documentLineId: l2 });
        await tx.execute(sql`delete from "PurchaseOrderLine" where id = ${l1}`);
        expect(await count(tx, sql`select count(*)::int as n from "PurchaseDocumentTermAllocation" where "documentTermId" = ${header}`)).toBe(0);
        await tx.execute(sql`delete from "PurchaseOrderLine" where id = ${l2}`);
        expect(await count(tx, sql`select count(*)::int as n from "PurchaseDocumentTerm" where id = ${lineTerm}`)).toBe(0);
        await tx.execute(sql`delete from "PurchaseOrder" where id = ${o}`);
        expect(await count(tx, sql`select count(*)::int as n from "PurchaseDocumentTerm" where "documentType" = 'PURCHASE_ORDER' and "documentId" = ${o}`)).toBe(0);
      });
    });
  });

  describe("purchase challan", () => {
    it("control: a challan with no order, and one received against an order, are accepted", async () => {
      await run(async (tx, A) => {
        const loose = await challan(tx, A, { vendorChallanNo: "VC-1", transporterName: "Ram Cargo", vehicleNo: "Na 1 Kha 2345" });
        await cline(tx, A, loose, 1, { locationId: A.loc, batchNo: "B1", manufactureDate: "2025-01-01", expiryDate: "2026-01-01" });
        const o = await order(tx, A);
        const ol = await oline(tx, A, o);
        const ch = await challan(tx, A, { purchaseOrderId: o });
        await cline(tx, A, ch, 1, { purchaseOrderLineId: ol, qty: 4 });
        await cline(tx, A, ch, 2, { purchaseOrderLineId: ol, qty: 6 }); // one order line can be received in parts
      });
    });

    it("a confirmed challan must say when it was confirmed", async () => {
      await run(async (tx, A) => {
        await refused(tx, () => challan(tx, A, { isConfirmed: true }), CHECK, /confirmed_check/);
        await challan(tx, A, { isConfirmed: true, confirmedAt: NOW });
      });
    });

    it("a line must receive a positive quantity; alt pair; expiry not before manufacture", async () => {
      await run(async (tx, A) => {
        const ch = await challan(tx, A);
        await refused(tx, () => cline(tx, A, ch, 1, { qty: 0 }), CHECK, /amounts_check/);
        await refused(tx, () => cline(tx, A, ch, 1, { altQty: 2 }), CHECK, /alt_pair_check/);
        await refused(tx, () => cline(tx, A, ch, 1, { manufactureDate: "2025-06-01", expiryDate: "2025-01-01" }), CHECK, /expiry_check/);
        await refused(tx, () => cline(tx, A, ch, 0), CHECK, /lineNumber_check/);
      });
    });

    it("duplicate challan number per branch + fiscal year, and the same vendor challan keyed twice, are refused", async () => {
      await run(async (tx, A) => {
        await challan(tx, A, { challanNumber: "01", vendorChallanNo: "V9" });
        await refused(tx, () => challan(tx, A, { challanNumber: "01" }), UNIQUE, /challanNumber/);
        await refused(tx, () => challan(tx, A, { vendorChallanNo: "V9" }), UNIQUE, /vendorChallanNo/);
        await challan(tx, A, { vendorChallanNo: "V9", vendorGLId: A.vendor2 }); // same number from another vendor is fine
      });
    });

    it("a challan must come from the order's vendor", async () => {
      await run(async (tx, A) => {
        const o = await order(tx, A);
        await refused(tx, () => challan(tx, A, { purchaseOrderId: o, vendorGLId: A.vendor2 }), CHECK, /Vendor mismatch/i);
        const ch = await challan(tx, A, { purchaseOrderId: o });
        await refused(tx, () => tx.execute(sql`update "PurchaseChallan" set "vendorGLId" = ${A.vendor2} where id = ${ch}`), CHECK, /Vendor mismatch/i);
      });
    });

    it("a challan line can only fulfil a line of ITS order, for the same product", async () => {
      await run(async (tx, A) => {
        const o1 = await order(tx, A);
        const o1l = await oline(tx, A, o1);
        const o2 = await order(tx, A);
        const o2l = await oline(tx, A, o2);
        const ch = await challan(tx, A, { purchaseOrderId: o1 });
        await refused(tx, () => cline(tx, A, ch, 1, { purchaseOrderLineId: o2l }), CHECK, /not to the challan's order/i);
        await refused(tx, () => cline(tx, A, ch, 1, { purchaseOrderLineId: o1l, productId: A.product2 }), CHECK, /Product mismatch/i);
        const loose = await challan(tx, A);
        await refused(tx, () => cline(tx, A, loose, 1, { purchaseOrderLineId: o1l }), CHECK, /has no purchase order/i);
      });
    });

    it("a challan cannot be moved to another order, or detached, while its lines fulfil order lines", async () => {
      await run(async (tx, A) => {
        const o1 = await order(tx, A);
        const o1l = await oline(tx, A, o1);
        const o2 = await order(tx, A);
        const ch = await challan(tx, A, { purchaseOrderId: o1 });
        const l = await cline(tx, A, ch, 1, { purchaseOrderLineId: o1l });
        await refused(tx, () => tx.execute(sql`update "PurchaseChallan" set "purchaseOrderId" = ${o2} where id = ${ch}`), CHECK, /another purchase order/i);
        await refused(tx, () => tx.execute(sql`update "PurchaseChallan" set "purchaseOrderId" = null where id = ${ch}`), CHECK, /cannot be detached/i);
        await tx.execute(sql`update "PurchaseChallanLine" set "purchaseOrderLineId" = null where id = ${l}`);
        await tx.execute(sql`update "PurchaseChallan" set "purchaseOrderId" = ${o2} where id = ${ch}`); // fine once no line depends on it
      });
    });

    it("an order or order line that has been received against cannot be deleted", async () => {
      await run(async (tx, A) => {
        const o = await order(tx, A);
        const ol = await oline(tx, A, o);
        const ch = await challan(tx, A, { purchaseOrderId: o });
        await cline(tx, A, ch, 1, { purchaseOrderLineId: ol });
        await refused(tx, () => tx.execute(sql`delete from "PurchaseOrderLine" where id = ${ol}`), FK, /ChallanLine/);
        await refused(tx, () => tx.execute(sql`delete from "PurchaseOrder" where id = ${o}`), FK, /Challan/);
      });
    });

    it("order, vendor, product, unit and location of another company are refused", async () => {
      await run(async (tx, A, B) => {
        // The vendor / document checks may fire before the company check (triggers run alphabetically); either way it is refused.
        const orderB = await order(tx, B);
        await refused(tx, () => challan(tx, A, { purchaseOrderId: orderB }), CHECK, /(company|Vendor mismatch)/i);
        await refused(tx, () => challan(tx, A, { vendorGLId: B.vendor }), CHECK, /company/i);
        const ch = await challan(tx, A);
        await refused(tx, () => cline(tx, A, ch, 1, { productId: B.product }), CHECK, /company/i);
        await refused(tx, () => cline(tx, A, ch, 1, { locationId: B.loc }), CHECK, /company/i);
        await refused(tx, () => cline(tx, A, ch, 1, { unitId: B.unit }), CHECK, /company/i);
      });
    });
  });

  describe("bill closing a challan / order", () => {
    // order(10) -> challan received against it (10) -> bill closing the challan
    async function chain(tx: any, A: Co) {
      const o = await order(tx, A);
      const ol = await oline(tx, A, o);
      const ch = await challan(tx, A, { purchaseOrderId: o });
      const cl = await cline(tx, A, ch, 1, { purchaseOrderLineId: ol });
      return { o, ol, ch, cl };
    }

    it("control: a bill that closes a challan (and, through it, the order) is accepted, line by line", async () => {
      await run(async (tx, A) => {
        const { o, ol, ch, cl } = await chain(tx, A);
        const b = await bill(tx, A, { purchaseChallanId: ch, purchaseOrderId: o });
        await bline(tx, A, b, 1, { challanLineId: cl, purchaseOrderLineId: ol });
        const b2 = await bill(tx, A, { purchaseChallanId: ch }); // order reached through the challan
        await bline(tx, A, b2, 1, { challanLineId: cl, purchaseOrderLineId: ol, qty: 3 }); // partial billing: a challan line can be billed in parts
        const b3 = await bill(tx, A, { purchaseOrderId: o }); // straight against the order, no challan
        await bline(tx, A, b3, 1, { purchaseOrderLineId: ol });
      });
    });

    it("the bill must come from the vendor of its challan and its order", async () => {
      await run(async (tx, A) => {
        const { o, ch } = await chain(tx, A);
        await refused(tx, () => bill(tx, A, { purchaseChallanId: ch, vendorGLId: A.vendor2 }), CHECK, /Vendor mismatch/i);
        await refused(tx, () => bill(tx, A, { purchaseOrderId: o, vendorGLId: A.vendor2 }), CHECK, /Vendor mismatch/i);
      });
    });

    it("a bill cannot name an order the challan was not received against", async () => {
      await run(async (tx, A) => {
        const { ch } = await chain(tx, A);
        const other = await order(tx, A);
        await refused(tx, () => bill(tx, A, { purchaseChallanId: ch, purchaseOrderId: other }), CHECK, /not order/i);
      });
    });

    it("a bill line can only bill a line of its own challan / order, for the same product", async () => {
      await run(async (tx, A) => {
        const { ch, cl, ol } = await chain(tx, A);
        const ch2 = await challan(tx, A);
        const cl2 = await cline(tx, A, ch2);
        const b = await bill(tx, A, { purchaseChallanId: ch });
        await refused(tx, () => bline(tx, A, b, 1, { challanLineId: cl2 }), CHECK, /not a line of the challan this bill closes/i);
        await refused(tx, () => bline(tx, A, b, 1, { challanLineId: cl, productId: A.product2 }), CHECK, /Product mismatch/i);
        const noChallan = await bill(tx, A);
        await refused(tx, () => bline(tx, A, noChallan, 1, { challanLineId: cl }), CHECK, /not a line of the challan this bill closes/i);
        await refused(tx, () => bline(tx, A, noChallan, 1, { purchaseOrderLineId: ol }), CHECK, /not a line of the purchase order/i);
        const other = await order(tx, A);
        const otherLine = await oline(tx, A, other);
        await refused(tx, () => bline(tx, A, b, 1, { challanLineId: cl, purchaseOrderLineId: otherLine }), CHECK, /(fulfils order line|not a line of the purchase order)/i);
      });
    });

    it("a bill cannot be re-pointed at another challan or order while its lines bill the old one", async () => {
      await run(async (tx, A) => {
        const { o, ol, ch, cl } = await chain(tx, A);
        // lines bill a challan line: the challan cannot be swapped
        const b = await bill(tx, A, { purchaseChallanId: ch });
        await bline(tx, A, b, 1, { challanLineId: cl, purchaseOrderLineId: ol });
        const ch2 = await challan(tx, A, { purchaseOrderId: o });
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "purchaseChallanId" = ${ch2} where id = ${b}`), CHECK, /another challan/i);
        // lines bill an order line (no challan): the order cannot be swapped
        const b2 = await bill(tx, A, { purchaseOrderId: o });
        await bline(tx, A, b2, 1, { purchaseOrderLineId: ol });
        const o2 = await order(tx, A);
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "purchaseOrderId" = ${o2} where id = ${b2}`), CHECK, /another purchase order/i);
        // a bill tied to a challan cannot be moved to an order that challan was not received against
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "purchaseOrderId" = ${o2} where id = ${b}`), CHECK, /not order/i);
      });
    });

    it("a challan or order that has been billed cannot be deleted", async () => {
      await run(async (tx, A) => {
        const { o, ch, cl } = await chain(tx, A);
        const b = await bill(tx, A, { purchaseChallanId: ch, purchaseOrderId: o });
        await bline(tx, A, b, 1, { challanLineId: cl });
        await refused(tx, () => tx.execute(sql`delete from "PurchaseChallanLine" where id = ${cl}`), FK, /BillLine/);
        await refused(tx, () => tx.execute(sql`delete from "PurchaseChallan" where id = ${ch}`), FK, /PurchaseBill/);
        await refused(tx, () => tx.execute(sql`delete from "PurchaseOrder" where id = ${o}`), FK, /(PurchaseBill|Challan)/);
      });
    });

    it("challan and order of another company are refused on a bill", async () => {
      await run(async (tx, A, B) => {
        const { ch: chB } = await chain(tx, B);
        const orderB = await order(tx, B);
        await refused(tx, () => bill(tx, A, { purchaseChallanId: chB }), CHECK, /(company|Vendor mismatch)/i);
        await refused(tx, () => bill(tx, A, { purchaseOrderId: orderB }), CHECK, /(company|Vendor mismatch)/i);
      });
    });
  });
});
