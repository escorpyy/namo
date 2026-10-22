import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

// Purchase bill rules enforced by the database itself: import switch, posting
// needs a voucher, landed/stock line rules, purchase type, and company isolation.
// Every test runs in a transaction that is always rolled back.
describe.skipIf(!DB_READY)("purchase bill (database level)", () => {
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

  type Co = { co: number; br: number; vendor: number; product: number; unit: number; loc: number; jv: number; general: number; additional: number; additionalDistr: number };

  async function company(tx: any, tag: string, side: string): Promise<Co> {
    const c = (s: string) => `${s}${side}${tag}`.slice(0, 20);
    const co = await ins(tx, "Company", { code: c("T"), name: `Test ${side}${tag}`, updatedAt: NOW });
    const br = await ins(tx, "Branch", { companyId: co, code: c("B"), name: `Branch ${side}${tag}`, updatedAt: NOW });
    const grp = await ins(tx, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "LIABILITY", updatedAt: NOW });
    const sg = await ins(tx, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const vendor = await ins(tx, "GeneralLedger", { companyId: co, code: c("L1"), name: "Vendor", accountSubGroupId: sg, normalBalance: "CREDIT", updatedAt: NOW });
    const unit = await ins(tx, "ProductUnit", { companyId: co, code: c("U"), name: "Unit", updatedAt: NOW });
    const pg = await ins(tx, "ProductGroup", { companyId: co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins(tx, "ProductSubGroup", { code: c("PS"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    const product = await ins(tx, "Product", { companyId: co, code: c("P"), description: "Prod", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    const loc = await ins(tx, "Location", { companyId: co, code: c("LC"), name: "Loc", updatedAt: NOW });
    const jv = await ins(tx, "JournalVoucher", { companyId: co, branchId: br, voucherNumber: c("JV"), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
    await ins(tx, "JournalVoucherLine", { journalVoucherId: jv, lineNumber: 1, generalLedgerId: vendor });
    // Terms: a GENERAL one, and two ADDITIONAL ones (one spreads over item lines = landed cost).
    const general = await ins(tx, "PurchaseTerm", { companyId: co, code: c("T1"), name: "Discount", nature: "DEDUCTIVE", category: "GENERAL", updatedAt: NOW });
    const additional = await ins(tx, "PurchaseTerm", { companyId: co, code: c("T2"), name: "Exchange charge", nature: "ADDITIVE", category: "ADDITIONAL", updatedAt: NOW });
    const additionalDistr = await ins(tx, "PurchaseTerm", { companyId: co, code: c("T3"), name: "Import duty", nature: "ADDITIVE", category: "ADDITIONAL", distributeToLines: true, allocationBasis: "VALUE", updatedAt: NOW });
    return { co, br, vendor, product, unit, loc, jv, general, additional, additionalDistr };
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

  const bill = (tx: any, A: Co, over: Record<string, unknown> = {}) =>
    ins(tx, "PurchaseBill", { companyId: A.co, branchId: A.br, invoiceNumber: uniq().slice(0, 12), invoiceDate: "2025-10-14", fiscalYear: "2082/83", vendorGLId: A.vendor, updatedAt: NOW, ...over });

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

  it("control: a valid bill, line and (for IMPORT) import detail are accepted", async () => {
    await run(async (tx, A) => {
      const id = await bill(tx, A);
      await ins(tx, "PurchaseBillLine", { purchaseBillId: id, lineNumber: 1, productId: A.product, qty: 5, unitId: A.unit, rate: 10, basicAmount: 50, locationId: A.loc, batchNo: "B1", manufactureDate: "2025-01-01", expiryDate: "2026-01-01" });
      const imp = await bill(tx, A, { invoiceType: "IMPORT", purchaseType: "GOODS_PURCHASE_CAPITAL" });
      await ins(tx, "PurchaseBillImportDetail", { updatedAt: NOW, purchaseBillId: imp, customsDeclarationNo: "1234/082/083", customsOffice: "Birgunj", transportMode: "ROAD" });
    });
  });

  describe("purchase type", () => {
    it("defaults to GOODS_PURCHASE_OTHERS and accepts the four values only", async () => {
      await run(async (tx, A) => {
        const id = await bill(tx, A);
        const r = (await tx.execute(sql`select "purchaseType" as t from "PurchaseBill" where id = ${id}`)) as any[];
        expect(r[0].t).toBe("GOODS_PURCHASE_OTHERS");
        for (const t of ["GOODS_PURCHASE_CAPITAL", "SERVICE_PURCHASE_OTHERS", "SERVICE_PURCHASE_CAPITAL"]) {
          await tx.execute(sql`update "PurchaseBill" set "purchaseType" = ${t}::"PurchaseType" where id = ${id}`);
        }
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "purchaseType" = 'FOO' where id = ${id}`), "22P02", /PurchaseType/);
      });
    });
  });

  describe("import switch", () => {
    it("import details are refused on a LOCAL bill", async () => {
      await run(async (tx, A) => {
        const id = await bill(tx, A, { invoiceType: "LOCAL" });
        await refused(tx, () => ins(tx, "PurchaseBillImportDetail", { updatedAt: NOW, purchaseBillId: id }), CHECK, /only allowed on an IMPORT/i);
      });
    });

    it("a bill cannot be switched away from IMPORT while it has import details, but can once they are removed", async () => {
      await run(async (tx, A) => {
        const id = await bill(tx, A, { invoiceType: "IMPORT" });
        const d = await ins(tx, "PurchaseBillImportDetail", { updatedAt: NOW, purchaseBillId: id });
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "invoiceType" = 'LOCAL' where id = ${id}`), CHECK, /has import details/i);
        await tx.execute(sql`delete from "PurchaseBillImportDetail" where id = ${d}`);
        await tx.execute(sql`update "PurchaseBill" set "invoiceType" = 'LOCAL' where id = ${id}`);
      });
    });

    it("one import detail per bill; the retired Taxable Capital type is gone", async () => {
      await run(async (tx, A) => {
        const id = await bill(tx, A, { invoiceType: "IMPORT" });
        await ins(tx, "PurchaseBillImportDetail", { updatedAt: NOW, purchaseBillId: id });
        await refused(tx, () => ins(tx, "PurchaseBillImportDetail", { updatedAt: NOW, purchaseBillId: id }), "23505", /purchaseBillId/);
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "invoiceType" = 'TAXABLE_CAPITAL' where id = ${id}`), "22P02", /PurchaseInvoiceType/);
      });
    });
  });

  describe("posting and the journal voucher (item 2)", () => {
    it("a posted bill must name its journal voucher", async () => {
      await run(async (tx, A) => {
        await refused(tx, () => bill(tx, A, { isPosted: true }), CHECK, /posted_voucher_check/);
        await bill(tx, A, { isPosted: true, journalVoucherId: A.jv });
      });
    });

    it("one voucher cannot belong to two bills", async () => {
      await run(async (tx, A) => {
        await bill(tx, A, { journalVoucherId: A.jv });
        await refused(tx, () => bill(tx, A, { journalVoucherId: A.jv }), "23505", /journalVoucherId/);
      });
    });

    it("the voucher must be the same company's", async () => {
      await run(async (tx, A, B) => {
        await refused(tx, () => bill(tx, A, { journalVoucherId: B.jv }), CHECK, /company/i);
      });
    });
  });

  describe("line stock and landed cost (items 7 and 8)", () => {
    it("expiry cannot be before manufacture; landed amount and rate cannot be negative", async () => {
      await run(async (tx, A) => {
        const id = await bill(tx, A);
        const line = (over: Record<string, unknown>) => ins(tx, "PurchaseBillLine", { purchaseBillId: id, lineNumber: Math.floor(Math.random() * 1e6) + 1, productId: A.product, qty: 1, unitId: A.unit, ...over });
        await refused(tx, () => line({ manufactureDate: "2026-02-01", expiryDate: "2026-01-01" }), CHECK, /expiry_check/);
        await refused(tx, () => line({ landedAmount: -1 }), CHECK, /landed_check/);
        await refused(tx, () => line({ landedRate: -1 }), CHECK, /landed_check/);
        await line({ allocatedTermAmount: 25, landedAmount: 75, landedRate: 15 });
      });
    });

    it("the receiving location must be the same company's", async () => {
      await run(async (tx, A, B) => {
        const id = await bill(tx, A);
        await refused(tx, () => ins(tx, "PurchaseBillLine", { purchaseBillId: id, lineNumber: 1, productId: A.product, qty: 1, unitId: A.unit, locationId: B.loc }), CHECK, /company/i);
      });
    });

    it("alt qty and alt unit come as a pair", async () => {
      await run(async (tx, A) => {
        const id = await bill(tx, A);
        await refused(tx, () => ins(tx, "PurchaseBillLine", { purchaseBillId: id, lineNumber: 1, productId: A.product, qty: 1, unitId: A.unit, altQty: 2 }), CHECK, /alt_pair_check/);
      });
    });
  });

  describe("company isolation", () => {
    it("vendor ledger and product of another company are refused; company cannot change", async () => {
      await run(async (tx, A, B) => {
        await refused(tx, () => bill(tx, A, { vendorGLId: B.vendor }), CHECK, /company/i);
        const id = await bill(tx, A);
        await refused(tx, () => ins(tx, "PurchaseBillLine", { purchaseBillId: id, lineNumber: 1, productId: B.product, qty: 1, unitId: A.unit }), CHECK, /company/i);
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "companyId" = ${B.co} where id = ${id}`), CHECK, /cannot be changed|company/i);
      });
    });
  });


  describe("additional purchase and its terms", () => {
    const term = (tx: any, A: Co, billId: number, termId: number, over: Record<string, unknown> = {}) =>
      ins(tx, "PurchaseDocumentTerm", { companyId: A.co, documentType: "PURCHASE_BILL", documentId: billId, termId, sequence: 100, nature: "ADDITIVE", calcBase: "ITEM_VALUE", calcType: "AMOUNT", inputAmount: 100, updatedAt: NOW, ...over });
    const lineOf = (tx: any, A: Co, billId: number, n = 1) =>
      ins(tx, "PurchaseBillLine", { purchaseBillId: billId, lineNumber: n, productId: A.product, qty: 10, unitId: A.unit, rate: 5, basicAmount: 50 });

    it("an additional bill must point at a main bill, one level only", async () => {
      await run(async (tx, A) => {
        const main = await bill(tx, A, { invoiceType: "IMPORT" });
        const add = await bill(tx, A, { mainBillId: main });
        await refused(tx, () => bill(tx, A, { mainBillId: add }), CHECK, /itself an additional bill/i);
        await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "mainBillId" = ${add} where id = ${main}`), CHECK, /(already has additional|itself an additional)/i);
      });
    });

    it("an ADDITIONAL term (import duty, excise, CSF...) is allowed on an additional bill, refused on a main bill", async () => {
      await run(async (tx, A) => {
        const main = await bill(tx, A, { invoiceType: "IMPORT" });
        const add = await bill(tx, A, { mainBillId: main });
        await term(tx, A, add, A.additional);
        await refused(tx, () => term(tx, A, main, A.additional), CHECK, /only be entered on an additional purchase bill/i);
        await term(tx, A, main, A.general, { nature: "DEDUCTIVE" }); // GENERAL terms stay fine on a main bill
      });
    });

    it("a PURCHASE_BILL term must point at a real bill of its own company", async () => {
      await run(async (tx, A, B) => {
        await refused(tx, () => term(tx, A, 999999, A.general), CHECK, /does not exist/i);
        const other = await bill(tx, B);
        await refused(tx, () => term(tx, A, other, A.general), CHECK, /company/i);
      });
    });

    it("a line-level term must sit on a line of that very bill", async () => {
      await run(async (tx, A) => {
        const b1 = await bill(tx, A);
        const b2 = await bill(tx, A);
        const l2 = await lineOf(tx, A, b2);
        await refused(tx, () => term(tx, A, b1, A.general, { documentLineId: l2 }), CHECK, /not a line of purchase bill/i);
      });
    });

    it("landed cost: an additional bill's term can be allocated to lines of the MAIN bill (stock valuation)", async () => {
      await run(async (tx, A) => {
        const main = await bill(tx, A, { invoiceType: "IMPORT" });
        const l1 = await lineOf(tx, A, main, 1);
        const l2 = await lineOf(tx, A, main, 2);
        const add = await bill(tx, A, { mainBillId: main });
        const t = await term(tx, A, add, A.additionalDistr, { distributeToLines: true, allocationBasis: "VALUE" });
        await ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: l1, allocatedAmount: 60 });
        await ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: l2, allocatedAmount: 40 });
      });
    });

    it("allocation to a line of an unrelated bill is refused; so is allocating a line-level term", async () => {
      await run(async (tx, A) => {
        const main = await bill(tx, A, { invoiceType: "IMPORT" });
        const add = await bill(tx, A, { mainBillId: main });
        const unrelated = await bill(tx, A);
        const lu = await lineOf(tx, A, unrelated);
        const t = await term(tx, A, add, A.additionalDistr, { distributeToLines: true, allocationBasis: "VALUE" });
        await refused(tx, () => ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: lu, allocatedAmount: 1 }), CHECK, /neither the bill of this term/i);
        await refused(tx, () => ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: 999999, allocatedAmount: 1 }), CHECK, /not a purchase bill line/i);
      });
    });

    it("a main bill line cannot be deleted while an additional bill still allocates cost to it; its own allocations go with it", async () => {
      await run(async (tx, A) => {
        const main = await bill(tx, A, { invoiceType: "IMPORT" });
        const l1 = await lineOf(tx, A, main, 1);
        const add = await bill(tx, A, { mainBillId: main });
        const t = await term(tx, A, add, A.additionalDistr, { distributeToLines: true, allocationBasis: "VALUE" });
        await ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: l1, allocatedAmount: 100 });
        await refused(tx, () => tx.execute(sql`delete from "PurchaseBillLine" where id = ${l1}`), CHECK, /additional purchase bill/i);
      });
    });

    it("deleting a bill removes its terms and their allocations", async () => {
      await run(async (tx, A) => {
        const b = await bill(tx, A);
        const l = await lineOf(tx, A, b);
        const t = await term(tx, A, b, A.general, { nature: "DEDUCTIVE", distributeToLines: true, allocationBasis: "VALUE" });
        await ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: t, documentLineId: l, allocatedAmount: 10 });
        await tx.execute(sql`delete from "PurchaseBill" where id = ${b}`);
        const n = async (q: any) => ((await tx.execute(q)) as any[])[0].n as number;
        expect(await n(sql`select count(*)::int as n from "PurchaseDocumentTerm" where "documentType" = 'PURCHASE_BILL' and "documentId" = ${b}`)).toBe(0);
        expect(await n(sql`select count(*)::int as n from "PurchaseDocumentTermAllocation" where "documentTermId" = ${t}`)).toBe(0);
      });
    });
  });

  it("duplicate invoice number in one branch and fiscal year is refused", async () => {
    await run(async (tx, A) => {
      await bill(tx, A, { invoiceNumber: "01" });
      await refused(tx, () => bill(tx, A, { invoiceNumber: "01" }), "23505", /invoiceNumber/);
    });
  });
});
