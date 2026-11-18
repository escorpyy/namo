import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

// Bill-wise adjustment: a receipt pays off sales invoices, outstanding = total - settlements of posted, not-reversed vouchers.
describe.skipIf(!DB_READY)("bill-wise settlement", () => {
  let db: any;
  let inv: typeof import("../server/services/salesInvoice");
  let cb: typeof import("../server/services/cashBankVoucher");
  let bs: typeof import("../server/services/billSettlement");
  class Rollback extends Error {}
  const NOW = sql`now()`;
  const ACTOR = { userId: null };
  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    inv = await import("../server/services/salesInvoice");
    cb = await import("../server/services/cashBankVoucher");
    bs = await import("../server/services/billSettlement");
  });
  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    return (await tx.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`))[0].id as number;
  };

  async function world(tx: any) {
    const tag = uniq(), code = (s: string) => `${s}${tag}`.slice(0, 10);
    const companyId = await ins(tx, "Company", { code: code("CO"), name: `Settle ${tag}`, updatedAt: NOW });
    const branchId = await ins(tx, "Branch", { companyId, code: code("BR"), name: `Branch ${tag}`, updatedAt: NOW });
    await ins(tx, "FiscalYear", { companyId, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const group = async (type: string, label: string) => {
      const id = await ins(tx, "AccountGroup", { companyId, code: code(`G${label}`), description: label, type, updatedAt: NOW });
      return ins(tx, "AccountSubGroup", { code: code(`S${label}`), description: label, accountGroupId: id, updatedAt: NOW });
    };
    const assetSub = await group("ASSET", "ASSET"), revenueSub = await group("REVENUE", "REV");
    const gl = (sub: number, key: string, normal: string, glType = "OTHER", extra: Record<string, unknown> = {}) =>
      ins(tx, "GeneralLedger", { companyId, code: code(key), name: key, accountSubGroupId: sub, normalBalance: normal, glType, updatedAt: NOW, ...extra });
    const customerGLId = await gl(assetSub, "CUST", "DEBIT", "CUSTOMER"), otherCustomerGLId = await gl(assetSub, "CUST2", "DEBIT", "CUSTOMER");
    const salesGLId = await gl(revenueSub, "SALES", "CREDIT"), cashGLId = await gl(assetSub, "CASH", "DEBIT", "OTHER", { isCashOrBank: true });
    const unitId = await ins(tx, "ProductUnit", { companyId, code: code("UNIT"), name: "Unit", updatedAt: NOW });
    const pg = await ins(tx, "ProductGroup", { companyId, code: code("PG"), name: "Products", updatedAt: NOW });
    const psg = await ins(tx, "ProductSubGroup", { code: code("PSG"), name: "Goods", productGroupId: pg, updatedAt: NOW });
    const productId = await ins(tx, "Product", { companyId, code: code("CONSULT"), description: "Consulting", type: "NON_STOCK", productSubGroupId: psg, updatedAt: NOW });
    await ins(tx, "NonStockDetail", { productId, unitId, salesGLId, purchaseGLId: salesGLId, updatedAt: NOW });
    return { companyId, branchId, customerGLId, otherCustomerGLId, cashGLId, productId, unitId };
  }
  const run = async (body: (tx: any, w: Awaited<ReturnType<typeof world>>) => Promise<void>) => {
    try { await db.transaction(async (tx: any) => { await body(tx, await world(tx)); throw new Rollback(); }); } catch (e) { if (!(e instanceof Rollback)) throw e; }
  };
  const postedInvoice = async (tx: any, w: Awaited<ReturnType<typeof world>>, amount: number, customerGLId = w.customerGLId, date = "2025-10-10") => {
    const saved = await inv.saveSalesInvoice({ companyId: w.companyId, branchId: w.branchId, invoiceDate: date, fiscalYear: "2082/83", customerGLId, dueDays: 0,
      lines: [{ productId: w.productId, qty: 1, unitId: w.unitId, rate: amount }], terms: [] }, ACTOR, { tx });
    await inv.postSalesInvoice(saved.id, ACTOR, { tx });
    return saved.id as number;
  };
  const receipt = (w: Awaited<ReturnType<typeof world>>, amount: number, settlements: any[], extra: Record<string, unknown> = {}, customerGLId = w.customerGLId) => ({
    companyId: w.companyId, branchId: w.branchId, voucherDate: "2025-11-01", fiscalYear: "2082/83", cashBankLedgerId: w.cashGLId,
    lines: [{ generalLedgerId: customerGLId, receipt: amount }], settlements, ...extra,
  });
  const open = (tx: any, w: Awaited<ReturnType<typeof world>>, all = false) => bs.openDocuments(tx, { companyId: w.companyId, kind: "SALES_INVOICE", generalLedgerId: w.customerGLId, all });

  it("lists unpaid invoices, and only a POSTED voucher reduces what is outstanding", async () => {
    await run(async (tx, w) => {
      const a = await postedInvoice(tx, w, 100), b = await postedInvoice(tx, w, 250, w.customerGLId, "2025-10-12");
      expect((await open(tx, w)).map((d) => [d.id, d.outstanding])).toEqual([[a, "100.00"], [b, "250.00"]]);
      const draft = await cb.createVoucher(receipt(w, 150, [{ kind: "SALES_INVOICE", documentId: a, amount: 100 }, { kind: "SALES_INVOICE", documentId: b, amount: 50 }]), ACTOR, { tx });
      expect((await open(tx, w)).map((d) => d.outstanding)).toEqual(["100.00", "250.00"]); // a draft settles nothing yet
      await cb.postVoucher(draft.id, w.companyId, ACTOR, { tx });
      const after = await open(tx, w, true);
      expect(after.map((d) => [d.settled, d.outstanding])).toEqual([["100.00", "0.00"], ["50.00", "200.00"]]);
      expect((await open(tx, w)).map((d) => d.id)).toEqual([b]);
      expect((await bs.settlementsOf(tx, draft.id)).map((s) => [s.number.length > 0, s.amount])).toEqual([[true, "100.00"], [true, "50.00"]]);
      expect(await bs.outstandingTotal(tx, { companyId: w.companyId, kind: "SALES_INVOICE", generalLedgerId: w.customerGLId })).toEqual({ count: 1, total: "200.00" });
    });
  });

  it("reversing the voucher gives the money back to the invoice", async () => {
    await run(async (tx, w) => {
      const a = await postedInvoice(tx, w, 100);
      const v = await cb.createVoucher(receipt(w, 100, [{ kind: "SALES_INVOICE", documentId: a, amount: 100 }]), ACTOR, { tx, post: true });
      expect(await open(tx, w)).toHaveLength(0);
      await cb.reverseVoucher(v.id, w.companyId, ACTOR, { tx, date: "2025-11-05", reason: "Cheque bounced" });
      expect((await open(tx, w)).map((d) => d.outstanding)).toEqual(["100.00"]);
    });
  });

  it("refuses settlements the voucher or the invoice cannot carry", async () => {
    await run(async (tx, w) => {
      const a = await postedInvoice(tx, w, 100), other = await postedInvoice(tx, w, 80, w.otherCustomerGLId);
      const draftInvoice = (await inv.saveSalesInvoice({ companyId: w.companyId, branchId: w.branchId, invoiceDate: "2025-10-10", fiscalYear: "2082/83", customerGLId: w.customerGLId, dueDays: 0,
        lines: [{ productId: w.productId, qty: 1, unitId: w.unitId, rate: 10 }], terms: [] }, ACTOR, { tx })).id;
      const attempt = async (r: any) => { await tx.execute(sql`savepoint s`); try { await cb.createVoucher(r, ACTOR, { tx }); } catch (e) { await tx.execute(sql`rollback to savepoint s`); throw e; } };
      await expect(attempt(receipt(w, 100, [{ kind: "SALES_INVOICE", documentId: a, amount: 100.01 }]))).rejects.toMatchObject({ status: 409 }); // more than outstanding
      await expect(attempt(receipt(w, 50, [{ kind: "SALES_INVOICE", documentId: a, amount: 60 }]))).rejects.toMatchObject({ status: 409 }); // more than received
      await expect(attempt(receipt(w, 80, [{ kind: "SALES_INVOICE", documentId: other, amount: 80 }]))).rejects.toMatchObject({ status: 400 }); // another customer
      await expect(attempt(receipt(w, 10, [{ kind: "SALES_INVOICE", documentId: draftInvoice, amount: 10 }]))).rejects.toMatchObject({ status: 409 }); // not posted
      await expect(attempt(receipt(w, 50, [{ kind: "SALES_INVOICE", documentId: a, amount: 0 }]))).rejects.toMatchObject({ status: 400 });
      await expect(attempt(receipt(w, 50, [{ kind: "SALES_INVOICE", documentId: a, amount: 20 }, { kind: "SALES_INVOICE", documentId: a, amount: 20 }]))).rejects.toMatchObject({ status: 400 }); // twice
      await expect(attempt(receipt(w, 50, [{ kind: "SALES_INVOICE", documentId: 999999999, amount: 20 }]))).rejects.toMatchObject({ status: 404 });
      await expect(attempt(receipt(w, 50, [{ kind: "PURCHASE_BILL", documentId: a, amount: 20 }]))).rejects.toMatchObject({ status: 404 }); // wrong kind
    });
  });

  it("two vouchers cannot both use the same outstanding amount (checked again at posting)", async () => {
    await run(async (tx, w) => {
      const a = await postedInvoice(tx, w, 100);
      const v1 = await cb.createVoucher(receipt(w, 80, [{ kind: "SALES_INVOICE", documentId: a, amount: 80 }]), ACTOR, { tx });
      const v2 = await cb.createVoucher(receipt(w, 80, [{ kind: "SALES_INVOICE", documentId: a, amount: 80 }]), ACTOR, { tx }); // both drafts are fine
      await cb.postVoucher(v1.id, w.companyId, ACTOR, { tx });
      await tx.execute(sql`savepoint p`);
      await expect(cb.postVoucher(v2.id, w.companyId, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      await tx.execute(sql`rollback to savepoint p`);
    });
  });

  it("a draft's settlements are rewritten with it; a posted voucher's settlements are frozen by the database", async () => {
    await run(async (tx, w) => {
      const a = await postedInvoice(tx, w, 100);
      const v = await cb.createVoucher(receipt(w, 100, [{ kind: "SALES_INVOICE", documentId: a, amount: 100 }]), ACTOR, { tx });
      await cb.updateVoucher(v.id, receipt(w, 100, [{ kind: "SALES_INVOICE", documentId: a, amount: 40 }]), ACTOR, { tx });
      expect((await bs.settlementsOf(tx, v.id)).map((s) => s.amount)).toEqual(["40.00"]);
      await cb.updateVoucher(v.id, receipt(w, 100, []), ACTOR, { tx });
      expect(await bs.settlementsOf(tx, v.id)).toHaveLength(0);
      await cb.updateVoucher(v.id, receipt(w, 100, [{ kind: "SALES_INVOICE", documentId: a, amount: 100 }]), ACTOR, { tx });
      await cb.postVoucher(v.id, w.companyId, ACTOR, { tx });
      await tx.execute(sql`savepoint f`);
      await expect(tx.execute(sql`delete from "BillSettlement" where "cashBankVoucherId" = ${v.id}`)).rejects.toThrow();
      await tx.execute(sql`rollback to savepoint f`);
    });
  });

  it("an advance (receipt beyond the settled invoices) can be applied to a later invoice, and undone with a reason", async () => {
    await run(async (tx, w) => {
      const a = await postedInvoice(tx, w, 100);
      const r = await cb.createVoucher(receipt(w, 500, [{ kind: "SALES_INVOICE", documentId: a, amount: 100 }]), ACTOR, { tx, post: true });
      const key = { companyId: w.companyId, kind: "SALES_INVOICE" as const, generalLedgerId: w.customerGLId };
      expect(await bs.openAdvances(tx, key)).toEqual([expect.objectContaining({ voucherId: r.id, amount: "500.00", used: "100.00", available: "400.00" })]);
      expect(await bs.advanceTotal(tx, key)).toEqual({ count: 1, total: "400.00" });
      const b = await postedInvoice(tx, w, 250, w.customerGLId, "2025-12-01");
      const apply = (items: any[], id = b) => bs.applyAdvancesFor(ACTOR, { companyId: w.companyId, kind: "SALES_INVOICE", documentId: id, date: "2025-12-05", items }, { tx });
      const attempt = async (fn: () => Promise<unknown>) => { await tx.execute(sql`savepoint s`); try { await fn(); } catch (e) { await tx.execute(sql`rollback to savepoint s`); throw e; } };
      await expect(attempt(() => apply([{ voucherId: r.id, amount: 400.01 }]))).rejects.toMatchObject({ status: 409 }); // more than the advance
      await expect(attempt(() => apply([{ voucherId: r.id, amount: 300 }]))).rejects.toMatchObject({ status: 409 }); // more than the invoice owes
      await expect(attempt(() => apply([{ voucherId: 999999999, amount: 10 }]))).rejects.toMatchObject({ status: 409 });
      await expect(attempt(() => apply([]))).rejects.toMatchObject({ status: 400 });
      expect(await apply([{ voucherId: r.id, amount: 250 }])).toMatchObject({ applied: "250.00" });
      expect((await bs.openAdvances(tx, key))[0].available).toBe("150.00");
      expect((await open(tx, w, true)).map((d) => [d.id, d.outstanding])).toEqual([[a, "0.00"], [b, "0.00"]]);
      const apps = await bs.applicationsOf(tx, { kind: "SALES_INVOICE", documentId: b });
      expect(apps.map((x) => x.amount)).toEqual(["250.00"]);
      await expect(attempt(() => bs.undoApplicationFor(ACTOR, { companyId: w.companyId, id: apps[0].id, reason: "x" }, { tx }))).rejects.toMatchObject({ status: 400 });
      await tx.execute(sql`savepoint u`);
      await expect(tx.execute(sql`delete from "AdvanceApplication" where id = ${apps[0].id}`)).rejects.toThrow(); // the database wants a reason
      await tx.execute(sql`rollback to savepoint u`);
      await bs.undoApplicationFor(ACTOR, { companyId: w.companyId, id: apps[0].id, reason: "Applied to the wrong invoice" }, { tx });
      expect((await open(tx, w)).map((d) => [d.id, d.outstanding])).toEqual([[b, "250.00"]]);
      expect((await bs.openAdvances(tx, key))[0].available).toBe("400.00");
    });
  });

  it("reversing the receipt takes the advance away from the invoice it was applied to", async () => {
    await run(async (tx, w) => {
      const r = await cb.createVoucher(receipt(w, 200, []), ACTOR, { tx, post: true });
      const b = await postedInvoice(tx, w, 150);
      await bs.applyAdvancesFor(ACTOR, { companyId: w.companyId, kind: "SALES_INVOICE", documentId: b, date: "2025-12-05", items: [{ voucherId: r.id, amount: 150 }] }, { tx });
      expect(await open(tx, w)).toHaveLength(0);
      await cb.reverseVoucher(r.id, w.companyId, ACTOR, { tx, date: "2025-12-06", reason: "Wrong customer" });
      expect((await open(tx, w)).map((d) => d.outstanding)).toEqual(["150.00"]);
      expect(await bs.openAdvances(tx, { companyId: w.companyId, kind: "SALES_INVOICE", generalLedgerId: w.customerGLId })).toHaveLength(0);
    });
  });

  it("vendor advances: a payment with no bill settled is an advance on the vendor ledger", async () => {
    await run(async (tx, w) => {
      const pay = await cb.createVoucher({ companyId: w.companyId, branchId: w.branchId, voucherDate: "2025-11-01", fiscalYear: "2082/83", cashBankLedgerId: w.cashGLId,
        lines: [{ generalLedgerId: w.otherCustomerGLId, payment: 700 }], settlements: [] }, ACTOR, { tx, post: true });
      const key = { companyId: w.companyId, kind: "PURCHASE_BILL" as const, generalLedgerId: w.otherCustomerGLId };
      expect(await bs.openAdvances(tx, key)).toEqual([expect.objectContaining({ voucherId: pay.id, available: "700.00" })]);
      expect(await bs.advanceTotal(tx, key)).toEqual({ count: 1, total: "700.00" });
      // a payment is never a customer advance
      expect(await bs.openAdvances(tx, { ...key, kind: "SALES_INVOICE" })).toHaveLength(0);
    });
  });
});
