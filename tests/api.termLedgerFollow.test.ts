import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// A term was posted to the wrong ledger on many bills: ONE correcting voucher moves the amounts; documents are not rewritten; reversal stays clean.
describe.skipIf(!DB_READY)("Changing a term's ledger in the master moves posted vouchers (API)", () => {
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
        await tx.execute(sql`delete from "LedgerReassignItem" where "jobId" in (select id from "LedgerReassignJob" where "companyId" = ${co})`);
        await tx.execute(sql`delete from "LedgerReassignJob" where "companyId" = ${co}`);
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

  it("moves every posted bill of the term (and a reversed one stays at zero), with no extra voucher", async () => {
    const b1 = await mkBill("2025-10-14", 1), b2 = await mkBill("2025-11-14", 2), b3 = await mkBill("2025-12-14", 3);
    // each bill: purchase Dr 1000, discount Cr 100 - both on the wrong ledger (the junior picked Purchase for Trade Discount)
    expect(await bal(W.wrong)).toBe(3000 - 300);
    const vouchersBefore = (await rows(sql`select count(*)::int as n from "JournalVoucher" where "companyId" = ${W.co}`))[0].n;
    // b2 is reversed BEFORE the master is fixed: its pair must stay at zero afterwards
    expect((await act(b2, "reverse", { date: "2025-12-15", reason: "returned" })).status).toBe(200);

    // "Upcoming only": the master changes, posted bills keep the old ledger
    const body = { code: c("DISC10"), name: "Trade Discount", category: "GENERAL", nature: "DEDUCTIVE", isProductwise: false, isMandatory: false, isEditable: true, sequence: 10, defaultCalcType: "PERCENT", defaultValue: 10, calcBase: "ITEM_VALUE", baseTermId: null, distributeToLines: false, affectsStockValue: false, defaultAgainstLedgerId: null, isActive: true };
    const imp = await call("GET", `/api/ledger-reassign/impact?companyId=${W.co}&kind=PURCHASE_TERM&masterId=${W.tDisc}`);
    expect(imp.body).toMatchObject({ ledgerId: W.wrong, documents: 4, posted: 4 }); // b1, b2, b3 and b2's reversal bill
    const upcoming = await call("PUT", `/api/masters/purchase-terms/${W.tDisc}?companyId=${W.co}&userId=1`, { ...body, generalLedgerId: W.right });
    expect(upcoming.status, JSON.stringify(upcoming.body)).toBe(200);
    expect(upcoming.body.ledgerJob).toBeUndefined();
    expect(await bal(W.right)).toBe(0);
    expect(await bal(W.wrong)).toBe(2 * (1000 - 100)); // b1 and b3; b2 and its reversal net to zero
    // back to the old ledger, then "All till date"
    expect((await call("PUT", `/api/masters/purchase-terms/${W.tDisc}?companyId=${W.co}&userId=1`, { ...body, generalLedgerId: W.wrong })).status).toBe(200);
    const fix = await call("PUT", `/api/masters/purchase-terms/${W.tDisc}?companyId=${W.co}&userId=1&reassign=ALL`, { ...body, generalLedgerId: W.right });
    expect(fix.status, JSON.stringify(fix.body)).toBe(200);
    expect(fix.body.ledgerJob).toMatchObject({ total: 4 });
    // the move runs in the background: wait for the job, then look
    let job: any;
    for (let i = 0; i < 100; i++) {
      job = (await call("GET", `/api/ledger-reassign/jobs?companyId=${W.co}`)).body.find((j: any) => j.id === fix.body.ledgerJob.id);
      if (job?.status === "DONE" || job?.status === "FAILED") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(job).toMatchObject({ status: "DONE", processed: 4, skipped: 0 });
    expect((await call("POST", `/api/ledger-reassign/jobs/${job.id}/seen?companyId=${W.co}`)).status).toBe(200);
    expect((await call("GET", `/api/ledger-reassign/jobs?companyId=${W.co}`)).body.find((j: any) => j.id === job.id)).toBeUndefined();

    // b1 and b3 discount (Cr 100 each) moved to the right ledger; b2 and its reversal netted to zero on both
    expect(await bal(W.right)).toBe(-200);
    expect(await bal(W.wrong)).toBe(2000);
    // the bills now remember the new ledger, and no correcting voucher was created (only b2's own reversal voucher exists)
    expect((await rows(sql`select count(*)::int as n from "PurchaseDocumentTerm" where "companyId" = ${W.co} and "generalLedgerId" = ${W.wrong}`))[0].n).toBe(0);
    expect((await rows(sql`select count(*)::int as n from "JournalVoucher" where "companyId" = ${W.co}`))[0].n).toBe(vouchersBefore + 1);
    // every voucher still balances
    expect((await rows(sql`select v.id from "JournalVoucher" v join "JournalVoucherLine" l on l."journalVoucherId" = v.id where v."companyId" = ${W.co} group by v.id having sum(l.debit) <> sum(l.credit)`)).length).toBe(0);
    // the old and new lines are in the audit trail with the reason
    const au = await rows(sql`select count(*)::int as n from "AuditLog" where "tableName" = 'JournalVoucherLine' and reason like 'Ledger of term%'`);
    expect(au[0].n).toBeGreaterThan(0);

    // a bill posted afterwards, and the reversal of b1, both use the new ledger consistently
    await mkBill("2025-12-20", 4);
    expect((await act(b1, "reverse", { date: "2025-12-21", reason: "returned" })).status).toBe(200);
    expect(await bal(W.right)).toBe(-200 + 100 - 100); // b4 adds -100, b1's reversal gives +100 back
    void b3;
  });

  it("a product's purchase ledger: changing it moves the bills posted with the old one, not the ones posted after", async () => {
    // fresh bills with the product (the term is not used here); the product posts to W.wrong (Purchase) and should post to W.purch2
    W.purch2 = await ins("GeneralLedger", { companyId: W.co, code: c("PUR2"), name: "Purchase 2", accountSubGroupId: (await rows(sql`select "accountSubGroupId" as g from "GeneralLedger" where id = ${W.wrong}`))[0].g, normalBalance: "DEBIT", updatedAt: NOW });
    const mk = async (date: string, n: number) => {
      const r = await call("POST", "/api/purchase/bills", { companyId: W.co, branchId: W.br, invoiceDate: date, vendorGLId: W.vendor, vendorInvoiceNo: `P${n}${tag}`, lines: [{ productId: W.rice, qty: 10, rate: 100 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((await act(r.body.result.id, "post")).status).toBe(200);
      return r.body.result.id as number;
    };
    const wrongBefore = await bal(W.wrong);
    const p1 = await mk("2025-10-20", 11), p2 = await mk("2025-10-21", 12);
    expect((await act(p2, "reverse", { date: "2025-10-22", reason: "returned" })).status).toBe(200);
    expect(await bal(W.wrong)).toBe(wrongBefore + 1000); // p1 only; p2 and its reversal net to zero
    const imp = await call("GET", `/api/ledger-reassign/impact?companyId=${W.co}&kind=PRODUCT_PURCHASE&masterId=${W.rice}`);
    expect(imp.body).toMatchObject({ ledgerId: W.wrong });
    expect(imp.body.documents).toBeGreaterThanOrEqual(2);

    const cur = (await call("GET", `/api/masters/products?companyId=${W.co}`)).body.find((x: any) => x.id === W.rice);
    const put = (extra: string, gl: number) => call("PUT", `/api/masters/products/${W.rice}?companyId=${W.co}&userId=1${extra}`, { ...cur, purchaseGLId: gl });
    // "Upcoming only": nothing already posted moves
    expect((await put("", W.purch2)).status).toBe(200);
    expect(await bal(W.purch2)).toBe(0);
    const p3 = await mk("2025-10-23", 13); // posted with the new ledger
    expect(await bal(W.purch2)).toBe(1000);
    // back, then "All till date"
    expect((await put("", W.wrong)).status).toBe(200);
    const wrongNow = await bal(W.wrong);
    const r = await put("&reassign=ALL", W.purch2);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    let job: any;
    for (let i = 0; i < 100; i++) {
      job = (await call("GET", `/api/ledger-reassign/jobs?companyId=${W.co}`)).body.find((j: any) => j.id === r.body.ledgerJob.id);
      if (job?.status === "DONE" || job?.status === "FAILED") break;
      await new Promise((x) => setTimeout(x, 100));
    }
    expect(job, JSON.stringify(job)).toMatchObject({ status: "DONE" });
    expect(job.skipped).toBe(0);
    // every bill posted before the change moved (p1, p2 and p2's reversal net to its own zero); p3 was already on the new ledger and is not moved again
    expect((await rows(sql`select count(*)::int as n from "LedgerReassignItem" where "jobId" = ${job.id} and "documentId" = ${p3}`))[0].n).toBe(0);
    // everything that was ever posted with the old ledger moved (also the bills of the first period, before the ledger was switched away and back);
    // live purchases: b3, b4 (first test), p1, p3 = 4000; every reversed pair nets to zero
    expect(job.processed).toBeGreaterThanOrEqual(6);
    expect(await bal(W.wrong)).toBe(0);
    expect(await bal(W.purch2)).toBe(4000);
    expect((await rows(sql`select v.id from "JournalVoucher" v join "JournalVoucherLine" l on l."journalVoucherId" = v.id where v."companyId" = ${W.co} group by v.id having sum(l.debit) <> sum(l.credit)`)).length).toBe(0);
    void p1; void wrongNow;
  });
});
