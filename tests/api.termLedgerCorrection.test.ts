import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// A term was posted to the wrong ledger on many bills: ONE correcting voucher moves the amounts; documents are not rewritten; reversal stays clean.
describe.skipIf(!DB_READY)("Term ledger correction (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  const tag = uniq();
  const c = (s: string) => `${s}${tag}`.slice(0, 20);
  const W: Record<string, number> = {};
  const NOW = sql`now()`;
  const ins = async (table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const r = await db.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`);
    return r[0].id as number;
  };
  const rows = async (q: any) => (await db.execute(q)) as any[];
  const act = (id: number, a: string, body?: unknown) => call("POST", `/api/purchase/bills/${id}/${a}?companyId=${W.co}`, body ?? {});
  const bal = async (gl: number) => {
    const [r] = await rows(sql`select coalesce(sum(l.debit - l.credit), 0) as b from "JournalVoucherLine" l join "JournalVoucher" v on v.id = l."journalVoucherId" where v."companyId" = ${W.co} and v."isPosted" and l."generalLedgerId" = ${gl}`);
    return Number(r.b);
  };
  const mkBill = async (date: string, n: number) => {
    const r = await call("POST", "/api/purchase/bills", { companyId: W.co, branchId: W.br, invoiceDate: date, vendorGLId: W.vendor, vendorInvoiceNo: `V${n}${tag}`, lines: [{ productId: W.rice, qty: 10, rate: 100 }], terms: [{ termId: W.tDisc }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await act(r.body.result.id, "post")).status).toBe(200);
    return r.body.result.id as number;
  };
  const q = (extra = "") => `companyId=${W.co}&kind=PURCHASE&termId=${W.tDisc}&fromLedgerId=${W.wrong}&toLedgerId=${W.right}${extra}`;

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    W.co = await ins("Company", { code: c("T"), name: `ZZ Term Correction ${tag}`, isActive: false, updatedAt: NOW });
    W.br = await ins("Branch", { companyId: W.co, code: c("B"), name: "Branch", updatedAt: NOW });
    await ins("FiscalYear", { companyId: W.co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins("AccountGroup", { companyId: W.co, code: c("G"), description: "Grp", type: "EXPENSE", updatedAt: NOW });
    const sg = await ins("AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, normal = "DEBIT") => ins("GeneralLedger", { companyId: W.co, code: c(code), name: code, accountSubGroupId: sg, normalBalance: normal, updatedAt: NOW });
    W.vendor = await gl("VEND", "CREDIT"); W.wrong = await gl("PURCH"); W.right = await gl("DISC", "CREDIT");
    const pg = await ins("ProductGroup", { companyId: W.co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins("ProductSubGroup", { code: c("PSG"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    W.pcs = await ins("ProductUnit", { companyId: W.co, code: c("PCS").slice(0, 10), name: `Pcs ${tag}`, updatedAt: NOW });
    W.rice = await ins("Product", { companyId: W.co, code: c("rice").slice(0, 10), description: "rice", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    await ins("StockDetail", { productId: W.rice, baseUnitId: W.pcs, purchaseGLId: W.wrong, updatedAt: NOW });
    // the junior picked the wrong ledger (Purchase) for Trade Discount
    W.tDisc = await ins("PurchaseTerm", { companyId: W.co, code: c("DISC10"), name: "Trade Discount", updatedAt: NOW, nature: "DEDUCTIVE", sequence: 10, defaultCalcType: "PERCENT", defaultValue: 10, generalLedgerId: W.wrong });
  });

  afterAll(async () => {
    if (W.co) {
      await db.transaction(async (tx: any) => {
        const co = W.co;
        await tx.execute(sql`set local session_replication_role = replica`);
        const byDoc = (child: string, fk: string, parent: string) => tx.execute(sql`delete from ${sql.identifier(child)} where ${sql.identifier(fk)} in (select id from ${sql.identifier(parent)} where "companyId" = ${co})`);
        for (const t of ["NumberCounter", "NumberSeriesUser", "NumberSeriesBranch"]) await byDoc(t, "seriesId", "NumberSeries");
        await tx.execute(sql`delete from "NumberSeries" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "TermLedgerCorrection" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "PurchaseDocumentTermAllocation" where "documentTermId" in (select id from "PurchaseDocumentTerm" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "PurchaseDocumentTerm" where "companyId" = ${co}`);
        await byDoc("PurchaseBillImportDetail", "purchaseBillId", "PurchaseBill");
        await byDoc("PurchaseBillLine", "purchaseBillId", "PurchaseBill");
        await tx.execute(sql`delete from "PurchaseBill" where "companyId" = ${co}`);
        await byDoc("JournalVoucherLine", "journalVoucherId", "JournalVoucher");
        await tx.execute(sql`delete from "JournalVoucher" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "StockDetail" where "productId" in (select id from "Product" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "Product" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "ProductSubGroup" where "productGroupId" in (select id from "ProductGroup" where "companyId" = ${co})`);
        for (const t of ["ProductGroup", "ProductUnit", "PurchaseTerm"]) await tx.execute(sql`delete from ${sql.identifier(t)} where "companyId" = ${co}`);
        await tx.execute(sql`delete from "GeneralLedger" where "companyId" = ${co}`);
        await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${co})`);
        for (const t of ["AccountGroup", "FiscalYear", "Branch"]) await tx.execute(sql`delete from ${sql.identifier(t)} where "companyId" = ${co}`);
        await tx.execute(sql`delete from "Company" where id = ${co}`);
      });
    }
    await close();
  });

  it("moves every posted bill of the term with ONE voucher, never twice, and a reversal leaves no residue", async () => {
    const b1 = await mkBill("2025-10-14", 1), b2 = await mkBill("2025-11-14", 2), b3 = await mkBill("2025-12-14", 3);
    // each bill: 10 x 100 = 1000, discount 10% = 100 on Cr of the wrong ledger
    expect(await bal(W.wrong)).toBe(3000 - 300);
    expect(await bal(W.right)).toBe(0);

    const pre = await call("GET", `/api/term-ledger-correction/preview?${q("&dateTo=2025-11-30")}`);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body).toMatchObject({ count: 2, documents: 2, total: "200.00" });
    expect(pre.body.rows.every((r: any) => r.side === "CR" && r.amount === "100.00")).toBe(true);
    expect((await call("GET", `/api/term-ledger-correction/count?companyId=${W.co}&kind=PURCHASE&termId=${W.tDisc}&ledgerId=${W.wrong}`)).body).toMatchObject({ documents: 3 });

    const apply = (extra: Record<string, unknown> = {}) => call("POST", "/api/term-ledger-correction/apply", { companyId: W.co, kind: "PURCHASE", termId: W.tDisc, fromLedgerId: W.wrong, toLedgerId: W.right, date: "2025-12-20", reason: "wrong ledger picked", ...extra });
    expect((await apply({ reason: "" })).status).toBe(400);
    expect((await apply({ toLedgerId: W.wrong })).status).toBe(400);
    const done = await apply({ dateTo: "2025-11-30" });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body).toMatchObject({ count: 2, documents: 2 });
    expect(done.body.vouchers).toHaveLength(1);
    // two bills moved: wrong ledger is back to 3000 - 100, right ledger holds 200 Cr
    expect(await bal(W.wrong)).toBe(3000 - 100);
    expect(await bal(W.right)).toBe(-200);

    // already corrected: only the third bill is still on the wrong ledger; running the same range again finds nothing
    expect((await apply({ dateTo: "2025-11-30" })).status).toBe(409);
    expect((await call("GET", `/api/term-ledger-correction/preview?${q()}`)).body).toMatchObject({ count: 1 });

    // the correction voucher is not editable or reversible by hand
    const jv = done.body.vouchers[0].journalVoucherId;
    expect((await call("POST", `/api/journal-vouchers/${jv}/reverse?companyId=${W.co}`, { reason: "x" })).status).toBe(409);

    // reversing a corrected bill cancels the original AND the correction: nothing is left on either ledger for it
    expect((await act(b1, "reverse", { date: "2025-12-21", reason: "returned" })).status).toBe(200);
    // b1: purchase Dr 1000 undone, discount Cr 100 undone, and the correction (Cr right 100) undone too -> right keeps only b2's 100
    expect(await bal(W.wrong)).toBe(2900 - 1000 + 100 - 100);
    expect(await bal(W.right)).toBe(-100);
    // a reversed bill is no longer offered for correction
    expect((await call("GET", `/api/term-ledger-correction/preview?${q()}`)).body).toMatchObject({ count: 1 });
    void b2; void b3;
  });
});
