import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withInitialPostedChildInsert } from "../server/db/audit";
import { DB_READY, uniq } from "./helpers";

// ERP-024 part 2: decision S9 says a reason is REQUIRED to edit or delete a posted document. The database enforces it:
// a BEFORE trigger ("Audit_reason") on the posted-document tables refuses an UPDATE or DELETE of a posted row unless the
// per-transaction setting namo.change_reason holds a non-blank text (the same text the audit trail then stores).
// Never gated: drafts, the moment of posting itself, the system's own landed-cost recalculation of a bill line, and
// opening balances (they have their own lock). Every test runs inside a transaction that is rolled back.
describe.skipIf(!DB_READY)("reason required to change a posted document (database level)", () => {
  let db: any;
  let svc: typeof import("../server/services/purchase");
  class Rollback extends Error {}
  const NOW = sql`now()`;
  const GATED = ["CashBankVoucher", "CashBankVoucherLine", "JournalVoucher", "JournalVoucherLine", "PurchaseBill", "PurchaseBillImportDetail", "PurchaseBillLine", "PurchaseDocumentTerm", "PurchaseDocumentTermAllocation"];

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    svc = await import("../server/services/purchase");
  });

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };
  const rows = async (tx: any, query: any) => (await tx.execute(query)) as any[];

  type Fx = { tag: string; user: number; co: number; br: number; fy: number; vendor: number; purchase: number; rent: number; cash: number; product: number };
  async function fixture(tx: any): Promise<Fx> {
    const tag = uniq();
    const c = (s: string) => `${s}${tag}`.slice(0, 20);
    const user = await ins(tx, "User", { name: `Reason ${tag}`, email: `r${tag}@test.local` });
    const co = await ins(tx, "Company", { code: c("T"), name: `Test ${tag}`, updatedAt: NOW });
    const br = await ins(tx, "Branch", { companyId: co, code: c("B"), name: `Branch ${tag}`, updatedAt: NOW });
    const fy = await ins(tx, "FiscalYear", { companyId: co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins(tx, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "EXPENSE", updatedAt: NOW });
    const sg = await ins(tx, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, normal = "DEBIT") => ins(tx, "GeneralLedger", { companyId: co, code: c(code), name: code, accountSubGroupId: sg, normalBalance: normal, updatedAt: NOW });
    const vendor = await gl("VEND", "CREDIT"), purchase = await gl("PURCH"), rent = await gl("RENT"), cash = await gl("CASH");
    const pcs = await ins(tx, "ProductUnit", { companyId: co, code: c("PCS"), name: "Pcs", updatedAt: NOW });
    const pg = await ins(tx, "ProductGroup", { companyId: co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins(tx, "ProductSubGroup", { code: c("PSG"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    const product = await ins(tx, "Product", { companyId: co, code: c("RICE"), description: "Rice", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    await ins(tx, "StockDetail", { productId: product, baseUnitId: pcs, purchaseGLId: purchase, updatedAt: NOW });
    return { tag, user, co, br, fy, vendor, purchase, rent, cash, product };
  }
  const run = async (body: (tx: any, f: Fx) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        await body(tx, await fixture(tx));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };
  const refused = async (tx: any, fn: () => Promise<unknown>) => {
    let err: any;
    try { await tx.transaction(async () => { await fn(); }); } catch (e) { err = e; }
    expect(err, "statement should have been refused").toBeDefined();
    const cause = (err.cause ?? err) as { code: string; message: string };
    expect(cause.code, cause.message).toBe("23514");
    expect(cause.message).toMatch(/reason/i);
    return cause;
  };
  const acting = (tx: any, userId: number | null, reason: string) =>
    tx.execute(sql`select set_config('namo.actor_user_id', ${userId == null ? "" : String(userId)}, true), set_config('namo.change_reason', ${reason}, true)`);
  const logOf = (tx: any, table: string, id: number) =>
    rows(tx, sql`select "action", "reason", "changedBy" from "AuditLog" where "tableName" = ${table} and "recordId" = ${String(id)} order by id`);

  const jv = (tx: any, f: Fx, posted: boolean) =>
    ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `J${posted ? "P" : "D"}${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", isPosted: posted, updatedAt: NOW });
  const jline = (tx: any, v: number, n: number, gl: number, debit: string, credit: string) =>
    withInitialPostedChildInsert(tx, "JournalVoucherLine", v, () => ins(tx, "JournalVoucherLine", { journalVoucherId: v, lineNumber: n, generalLedgerId: gl, debit, credit }));
  const cbv = (tx: any, f: Fx, posted: boolean) =>
    ins(tx, "CashBankVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `C${posted ? "P" : "D"}${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", isPosted: posted, updatedAt: NOW });
  const cline = (tx: any, v: number, n: number, gl: number, debit: string, credit: string) =>
    withInitialPostedChildInsert(tx, "CashBankVoucherLine", v, () => ins(tx, "CashBankVoucherLine", { cashBankVoucherId: v, lineNumber: n, generalLedgerId: gl, debit, credit }));

  it("exactly the posted-document tables carry the reason trigger (opening balances do not)", async () => {
    const t = await rows(db, sql`select c.relname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid where g.tgname = 'Audit_reason' and not g.tgisinternal order by 1`);
    expect(t.map((r) => r.t)).toEqual([...GATED].sort());
  });

  describe("journal voucher", () => {
    it("a DRAFT can be edited and deleted with no reason", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, false);
        const l = await jline(tx, v, 1, f.rent, "10", "0");
        await tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`);
        await tx.execute(sql`update "JournalVoucherLine" set debit = 20 where id = ${l}`);
        await tx.execute(sql`delete from "JournalVoucherLine" where id = ${l}`);
        await tx.execute(sql`delete from "JournalVoucher" where id = ${v}`);
      });
    });

    it("a POSTED voucher cannot be edited or deleted without a reason, and the message says so", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, true);
        const m = await refused(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`));
        expect(m.message).toMatch(/posted/i);
        await refused(tx, () => tx.execute(sql`delete from "JournalVoucher" where id = ${v}`));
        expect((await rows(tx, sql`select remarks from "JournalVoucher" where id = ${v}`))[0].remarks).toBeNull();
      });
    });

    it("an UPDATE that changes nothing on a posted voucher needs no reason (it is not a change)", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, true);
        await tx.execute(sql`update "JournalVoucher" set remarks = remarks where id = ${v}`);
      });
    });

    it("a blank reason is no reason", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, true);
        await acting(tx, f.user, "   ");
        await refused(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`));
        await acting(tx, f.user, "");
        await refused(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`));
      });
    });

    it("with a reason the edit goes through and the audit entry carries that reason and user", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, true);
        await acting(tx, f.user, "amount keyed wrongly");
        await tx.execute(sql`update "JournalVoucher" set remarks = 'corrected' where id = ${v}`);
        const log = await logOf(tx, "JournalVoucher", v);
        expect(log.map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
        expect(log[1]).toMatchObject({ reason: "amount keyed wrongly", changedBy: f.user });
        await tx.execute(sql`delete from "JournalVoucher" where id = ${v}`);
        expect((await logOf(tx, "JournalVoucher", v)).pop()).toMatchObject({ action: "DELETE", reason: "amount keyed wrongly" });
      });
    });

    it("lines of a posted voucher are gated too: edit, delete, and moving a line off the voucher", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, true);
        const l1 = await jline(tx, v, 1, f.rent, "10", "0");
        const l2 = await jline(tx, v, 2, f.cash, "0", "10");
        await refused(tx, () => tx.execute(sql`update "JournalVoucherLine" set debit = 20 where id = ${l1}`));
        await refused(tx, () => tx.execute(sql`delete from "JournalVoucherLine" where id = ${l2}`));
        const other = await jv(tx, f, false);
        await refused(tx, () => tx.execute(sql`update "JournalVoucherLine" set "journalVoucherId" = ${other} where id = ${l1}`));
        await acting(tx, f.user, "rewrite lines");
        await tx.execute(sql`update "JournalVoucherLine" set debit = 20 where id = ${l1}`);
        await tx.execute(sql`delete from "JournalVoucherLine" where id = ${l2}`);
      });
    });

    it("a new line may still be added to a draft, and posting a voucher (draft -> posted) needs no reason", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, false);
        await jline(tx, v, 1, f.rent, "10", "0");
        await tx.execute(sql`update "JournalVoucher" set "isPosted" = true where id = ${v}`);
        await refused(tx, () => tx.execute(sql`update "JournalVoucher" set "isPosted" = false where id = ${v}`)); // un-posting is a change of a posted document
      });
    });

    it("existing posted vouchers require a reason for added or inbound lines; initial creation remains allowed", async () => {
      await run(async (tx, f) => {
        const jPosted = await jv(tx, f, true);
        await jline(tx, jPosted, 1, f.rent, "10", "0");
        await jline(tx, jPosted, 2, f.cash, "0", "10");
        const jDraft = await jv(tx, f, false);
        const jDraftLine = await jline(tx, jDraft, 1, f.rent, "0", "0");

        const cPosted = await cbv(tx, f, true);
        await cline(tx, cPosted, 1, f.rent, "10", "0");
        await cline(tx, cPosted, 2, f.cash, "0", "10");
        const cDraft = await cbv(tx, f, false);
        const cDraftLine = await cline(tx, cDraft, 1, f.rent, "0", "0");

        await refused(tx, () => tx.execute(sql`insert into "JournalVoucherLine" ("journalVoucherId", "lineNumber", "generalLedgerId", "debit", "credit") values (${jPosted}, 3, ${f.rent}, 1, 0)`));
        await refused(tx, () => tx.execute(sql`update "JournalVoucherLine" set "journalVoucherId" = ${jPosted}, "lineNumber" = 3 where id = ${jDraftLine}`));
        await refused(tx, () => tx.execute(sql`insert into "CashBankVoucherLine" ("cashBankVoucherId", "lineNumber", "generalLedgerId", "debit", "credit") values (${cPosted}, 3, ${f.rent}, 1, 0)`));
        await refused(tx, () => tx.execute(sql`update "CashBankVoucherLine" set "cashBankVoucherId" = ${cPosted}, "lineNumber" = 3 where id = ${cDraftLine}`));

        await acting(tx, f.user, "add approved voucher lines");
        await jline(tx, jPosted, 3, f.rent, "1", "0");
        await jline(tx, jPosted, 4, f.cash, "0", "1");
        await cline(tx, cPosted, 3, f.rent, "1", "0");
        await cline(tx, cPosted, 4, f.cash, "0", "1");
      });
    });

    it("a company deleted with its posted vouchers is not blocked on their lines (the voucher itself is the gate)", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, true);
        await jline(tx, v, 1, f.rent, "10", "0");
        await acting(tx, f.user, "company clean-up");
        await tx.execute(sql`delete from "JournalVoucher" where id = ${v}`); // the database removes the line with it
        expect((await rows(tx, sql`select id from "JournalVoucherLine" where "journalVoucherId" = ${v}`)).length).toBe(0);
      });
    });
  });

  describe("cash / bank voucher", () => {
    it("header and lines of a posted voucher need a reason; a draft does not", async () => {
      await run(async (tx, f) => {
        const draft = await cbv(tx, f, false);
        await tx.execute(sql`update "CashBankVoucher" set remarks = 'x' where id = ${draft}`);
        const v = await cbv(tx, f, true);
        const l = await cline(tx, v, 1, f.cash, "0", "5");
        await refused(tx, () => tx.execute(sql`update "CashBankVoucher" set remarks = 'x' where id = ${v}`));
        await refused(tx, () => tx.execute(sql`update "CashBankVoucherLine" set credit = 6 where id = ${l}`));
        await refused(tx, () => tx.execute(sql`delete from "CashBankVoucherLine" where id = ${l}`));
        await refused(tx, () => tx.execute(sql`delete from "CashBankVoucher" where id = ${v}`));
        await acting(tx, f.user, "wrong cheque");
        await tx.execute(sql`update "CashBankVoucherLine" set credit = 6 where id = ${l}`);
        await tx.execute(sql`update "CashBankVoucher" set remarks = 'fixed' where id = ${v}`);
      });
    });
  });

  describe("purchase bill (through the service)", () => {
    const billIn = (f: Fx) => ({ companyId: f.co, branchId: f.br, invoiceDate: "2025-10-14", vendorGLId: f.vendor, lines: [{ productId: f.product, qty: 10, rate: 100 }] });
    const ACTOR = (f: Fx) => ({ userId: f.user });

    it("saving and posting a bill needs no reason (posting is the transition itself)", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), ACTOR(f), { tx });
        const p = await svc.postPurchaseBill(s.id, ACTOR(f), { tx });
        expect(p.isPosted).toBe(true);
        await svc.reversePurchaseBill(s.id, ACTOR(f), { tx, date: "2025-10-20" }); // a reversal adds documents, it edits none
      });
    });

    it("a posted bill: header, line and delete need a reason; the landed-cost recalculation does not", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), ACTOR(f), { tx });
        await svc.postPurchaseBill(s.id, ACTOR(f), { tx });
        const [line] = await rows(tx, sql`select id from "PurchaseBillLine" where "purchaseBillId" = ${s.id}`);

        // the system's own recalculation of landed cost on a posted line is not an edit of the document
        await tx.execute(sql`update "PurchaseBillLine" set "allocatedTermAmount" = 5, "landedAmount" = "landedAmount" + 5, "landedRate" = "landedRate" + 0.5 where id = ${line.id}`);

        const m = await refused(tx, () => tx.execute(sql`update "PurchaseBill" set "vendorInvoiceNo" = 'V-2' where id = ${s.id}`));
        expect(m.message).toMatch(/posted/i);
        await refused(tx, () => tx.execute(sql`update "PurchaseBillLine" set qty = 11 where id = ${line.id}`));
        await refused(tx, () => tx.execute(sql`update "PurchaseBillLine" set qty = 11, "landedAmount" = 1 where id = ${line.id}`)); // mixed with a real edit
        await refused(tx, () => tx.execute(sql`delete from "PurchaseBillLine" where id = ${line.id}`));
        await refused(tx, () => tx.execute(sql`delete from "PurchaseBill" where id = ${s.id}`));

        await acting(tx, f.user, "vendor invoice number corrected");
        await tx.execute(sql`update "PurchaseBill" set "vendorInvoiceNo" = 'V-2' where id = ${s.id}`);
        const log = await rows(tx, sql`select "reason" from "AuditLog" where "tableName" = 'PurchaseBill' and "recordId" = ${String(s.id)} order by id desc limit 1`);
        expect(log[0].reason).toBe("vendor invoice number corrected");
      });
    });

    it("existing posted bills require a reason for added or inbound lines, import details, terms and allocations", async () => {
      const importBillIn = (fx: Fx) => ({
        ...billIn(fx),
        invoiceType: "IMPORT" as const,
        importDetail: { customsDeclarationNo: `CD-${fx.tag}` },
      });
      await run(async (tx, f) => {
        const termId = await ins(tx, "PurchaseTerm", {
          companyId: f.co, code: `F${f.tag}`.slice(0, 20), name: "Freight", category: "GENERAL", nature: "ADDITIVE",
          isProductwise: false, isMandatory: false, sequence: 10, defaultCalcType: "AMOUNT", defaultValue: "1",
          calcBase: "ITEM_VALUE", distributeToLines: true, allocationBasis: "VALUE", generalLedgerId: f.purchase, updatedAt: NOW,
        });
        const docTerm = (billId: number) => ins(tx, "PurchaseDocumentTerm", {
          companyId: f.co, documentType: "PURCHASE_BILL", documentId: billId, termId,
          sequence: 10, nature: "ADDITIVE", calcBase: "ITEM_VALUE", generalLedgerId: f.purchase,
          distributeToLines: true, allocationBasis: "VALUE", calcType: "AMOUNT", inputAmount: "1",
          baseAmount: "100", calculatedAmount: "1", isOverridden: false, finalAmount: "1", updatedAt: NOW,
        });
        const p = await svc.savePurchaseBill(importBillIn(f), ACTOR(f), { tx });
        await svc.postPurchaseBill(p.id, ACTOR(f), { tx });
        const postedBill = p.id;
        const [{ id: postedLine }] = await rows(tx, sql`select id from "PurchaseBillLine" where "purchaseBillId" = ${postedBill}`);

        const d = await svc.savePurchaseBill(billIn(f), ACTOR(f), { tx });
        const [{ id: draftLine }] = await rows(tx, sql`select id from "PurchaseBillLine" where "purchaseBillId" = ${d.id}`);
        const draftTerm = await docTerm(d.id);
        const draftAllocation = await ins(tx, "PurchaseDocumentTermAllocation", { documentTermId: draftTerm, documentLineId: draftLine, allocatedAmount: "1" });

        await refused(tx, () => tx.execute(sql`update "PurchaseBillLine" set "purchaseBillId" = ${postedBill}, "lineNumber" = 2 where id = ${draftLine}`));
        await refused(tx, () => tx.execute(sql`
          insert into "PurchaseBillLine" ("purchaseBillId", "lineNumber", "productId", "qty", "unitId", "rate", "basicAmount")
          select ${postedBill}, 99, "productId", "qty", "unitId", "rate", "basicAmount" from "PurchaseBillLine" where id = ${draftLine}
        `));
        await refused(tx, () => tx.execute(sql`insert into "PurchaseBillImportDetail" ("purchaseBillId") values (${postedBill})`));
        await refused(tx, () => tx.execute(sql`update "PurchaseDocumentTerm" set "documentId" = ${postedBill} where id = ${draftTerm}`));
        await refused(tx, () => docTerm(postedBill));

        await acting(tx, f.user, "add an approved posted-bill charge");
        const postedTerm = await docTerm(postedBill);
        await acting(tx, null, "");
        await refused(tx, () => tx.execute(sql`update "PurchaseDocumentTermAllocation" set "documentTermId" = ${postedTerm}, "documentLineId" = ${postedLine} where id = ${draftAllocation}`));
        await refused(tx, () => tx.execute(sql`insert into "PurchaseDocumentTermAllocation" ("documentTermId", "documentLineId", "allocatedAmount") values (${postedTerm}, ${postedLine}, '1')`));
      });
    });

    it("a DRAFT bill is edited and deleted freely", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), ACTOR(f), { tx });
        const again = await svc.savePurchaseBill({ ...billIn(f), id: s.id, vendorInvoiceNo: "V-9" }, ACTOR(f), { tx });
        expect(again.id).toBe(s.id);
        await svc.deletePurchaseBill(s.id, ACTOR(f), { tx });
      });
    });
  });

  describe("not gated", () => {
    it("opening balances are changed and deleted with no reason (they have their own lock)", async () => {
      await run(async (tx, f) => {
        const ob = await ins(tx, "OpeningBalance", { companyId: f.co, branchId: f.br, fiscalYearId: f.fy, generalLedgerId: f.rent, updatedAt: NOW });
        await tx.execute(sql`update "OpeningBalance" set debit = 5 where id = ${ob}`);
        await tx.execute(sql`delete from "OpeningBalance" where id = ${ob}`);
      });
    });
  });
});
