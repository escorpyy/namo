import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

describe.skipIf(!DB_READY)("sales invoice service layer", () => {
  let db: any;
  let svc: typeof import("../server/services/salesInvoice");
  class Rollback extends Error {}
  const NOW = sql`now()`;
  const ACTOR = { userId: null };

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    svc = await import("../server/services/salesInvoice");
  });

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };
  const rows = async (tx: any, query: any) => (await tx.execute(query)) as any[];

  async function world(tx: any) {
    const tag = uniq();
    const code = (s: string) => `${s}${tag}`.slice(0, 10); // the shortest code column among these tables holds 10 characters
    const companyId = await ins(tx, "Company", { code: code("CO"), name: `Sales test ${tag}`, updatedAt: NOW });
    const branchId = await ins(tx, "Branch", { companyId, code: code("BR"), name: `Branch ${tag}`, updatedAt: NOW });
    await ins(tx, "FiscalYear", { companyId, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });

    const group = async (type: string, label: string) => {
      const id = await ins(tx, "AccountGroup", { companyId, code: code(`G${label}`), description: label, type, updatedAt: NOW });
      return ins(tx, "AccountSubGroup", { code: code(`S${label}`), description: `${label} subgroup`, accountGroupId: id, updatedAt: NOW });
    };
    const assetSub = await group("ASSET", "ASSET");
    const revenueSub = await group("REVENUE", "REV");
    const liabilitySub = await group("LIABILITY", "LIAB");
    const expenseSub = await group("EXPENSE", "EXP");
    const gl = (sub: number, key: string, normal: string, glType = "OTHER") =>
      ins(tx, "GeneralLedger", { companyId, code: code(key), name: key, accountSubGroupId: sub, normalBalance: normal, glType, updatedAt: NOW });
    const customerGLId = await gl(assetSub, "CUST", "DEBIT", "CUSTOMER");
    const salesGLId = await gl(revenueSub, "SALES", "CREDIT");
    const taxGLId = await gl(liabilitySub, "TAX", "CREDIT");
    const purchaseGLId = await gl(expenseSub, "PURCH", "DEBIT");
    const unitId = await ins(tx, "ProductUnit", { companyId, code: code("UNIT"), name: "Unit", updatedAt: NOW });
    const productGroupId = await ins(tx, "ProductGroup", { companyId, code: code("PG"), name: "Products", updatedAt: NOW });
    const productSubGroupId = await ins(tx, "ProductSubGroup", { code: code("PSG"), name: "Goods", productGroupId, updatedAt: NOW });
    const productId = await ins(tx, "Product", { companyId, code: code("CONSULT"), description: "Consulting", type: "NON_STOCK", productSubGroupId, updatedAt: NOW });
    await ins(tx, "NonStockDetail", { productId, unitId, salesGLId, purchaseGLId, updatedAt: NOW });
    const termId = await ins(tx, "SalesTerm", {
      companyId, code: code("VAT10"), name: "Sales tax", category: "GENERAL", nature: "ADDITIVE", isMandatory: true,
      defaultCalcType: "PERCENT", defaultValue: 10, calcBase: "ITEM_VALUE", generalLedgerId: taxGLId, updatedAt: NOW,
    });
    return { companyId, branchId, customerGLId, salesGLId, purchaseGLId, taxGLId, productId, unitId, termId };
  }

  const run = async (body: (tx: any, w: Awaited<ReturnType<typeof world>>) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        await body(tx, await world(tx));
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  };

  it("prices a draft with a mandatory term, posts a balanced voucher, and reverses it once", async () => {
    await run(async (tx, w) => {
      const saved = await svc.saveSalesInvoice({
        companyId: w.companyId, branchId: w.branchId, invoiceDate: "2025-10-14", fiscalYear: "2082/83",
        customerGLId: w.customerGLId, dueDays: 15,
        lines: [{ productId: w.productId, qty: 2, unitId: w.unitId, rate: 100 }], terms: [{ termId: w.termId }],
      }, ACTOR, { tx });
      expect(saved).toMatchObject({ basicAmount: "200.00", termAmount: "20.00", totalAmount: "220.00", dueDate: "2025-10-29" });

      const posted = await svc.postSalesInvoice(saved.id, ACTOR, { tx });
      const ledger = await rows(tx, sql`select "generalLedgerId" as gl, sum(debit)::numeric as debit, sum(credit)::numeric as credit from "JournalVoucherLine" where "journalVoucherId" = ${posted.journalVoucherId} group by "generalLedgerId"`);
      const amountFor = (gl: number, side: "debit" | "credit") => Number(ledger.find((r) => Number(r.gl) === gl)?.[side] ?? 0);
      expect(amountFor(w.customerGLId, "debit")).toBe(220);
      expect(amountFor(w.salesGLId, "credit")).toBe(200);
      expect(amountFor(w.taxGLId, "credit")).toBe(20);
      expect(Number(ledger.reduce((n, r) => n + Number(r.debit), 0))).toBe(Number(ledger.reduce((n, r) => n + Number(r.credit), 0)));

      const reversed = await svc.reverseSalesInvoice(saved.id, ACTOR, { tx, date: "2025-10-20", reason: "Incorrect invoice" });
      const [original] = await rows(tx, sql`select i."isPosted", r.id as "reversedById" from "SalesInvoice" i left join "SalesInvoice" r on r."reversalOfId" = i.id and r."isPosted" where i.id = ${saved.id}`);
      expect(original.isPosted).toBe(true);
      expect(Number(original.reversedById)).toBe(reversed.id);
      const reverseRows = await rows(tx, sql`select sum(debit)::numeric as debit, sum(credit)::numeric as credit from "JournalVoucherLine" where "journalVoucherId" = ${reversed.journalVoucherId}`);
      expect(Number(reverseRows[0].debit)).toBe(220);
      expect(Number(reverseRows[0].credit)).toBe(220);
      await expect(svc.reverseSalesInvoice(saved.id, ACTOR, { tx, date: "2025-10-21", reason: "Second attempt" })).rejects.toMatchObject({ status: 409 });
    });
  });
  const draftInput = (w: Awaited<ReturnType<typeof world>>, extra: Record<string, unknown> = {}) => ({
    companyId: w.companyId, branchId: w.branchId, invoiceDate: "2025-10-14", fiscalYear: "2082/83",
    customerGLId: w.customerGLId, dueDays: 0,
    lines: [{ productId: w.productId, qty: 1, unitId: w.unitId, rate: 100 }], terms: [{ termId: w.termId }], ...extra,
  });
  // a statement the database refuses aborts the transaction, so each attempt runs in its own savepoint
  const refusedByDb = async (tx: any, fn: (t: any) => Promise<unknown>) => {
    let err: any;
    try { await tx.transaction(async (t: any) => { await fn(t); }); } catch (e) { err = e; }
    expect(err, "the database should have refused this").toBeTruthy();
    return String(err?.cause?.message ?? err?.message ?? err);
  };

  it("refuses to edit, re-post or delete a posted invoice, and a reversal invoice likewise", async () => {
    await run(async (tx, w) => {
      const saved = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      await svc.postSalesInvoice(saved.id, ACTOR, { tx });
      await expect(svc.saveSalesInvoice({ ...draftInput(w), id: saved.id } as any, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      await expect(svc.postSalesInvoice(saved.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      await expect(svc.deleteDraftSalesInvoice(saved.id, w.companyId, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      const rev = await svc.reverseSalesInvoice(saved.id, ACTOR, { tx, date: "2025-10-20", reason: "Wrong customer" });
      await expect(svc.saveSalesInvoice({ ...draftInput(w), id: rev.id } as any, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      await expect(svc.deleteDraftSalesInvoice(rev.id, w.companyId, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      await expect(svc.postSalesInvoice(rev.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
    });
  });

  it("deletes a draft, and keeps invoices inside their own company", async () => {
    await run(async (tx, w) => {
      const saved = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      await expect(svc.deleteDraftSalesInvoice(saved.id, w.companyId + 999_999, ACTOR, { tx })).rejects.toMatchObject({ status: 404 });
      await svc.deleteDraftSalesInvoice(saved.id, w.companyId, ACTOR, { tx });
      expect(await rows(tx, sql`select id from "SalesInvoice" where id = ${saved.id}`)).toHaveLength(0);
    });
  });

  it("needs a reason of at least 3 characters to reverse, and a draft cannot be reversed", async () => {
    await run(async (tx, w) => {
      const saved = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      await expect((async () => svc.reverseSalesInvoice(saved.id, ACTOR, { tx, date: "2025-10-20", reason: "ab" }))()).rejects.toMatchObject({ status: 400 });
      await expect((async () => svc.reverseSalesInvoice(saved.id, ACTOR, { tx, date: "2025-10-20", reason: "   " }))()).rejects.toMatchObject({ status: 400 });
      await expect((async () => svc.reverseSalesInvoice(saved.id, ACTOR, { tx, date: "2025-10-20", reason: "Not posted yet" }))()).rejects.toMatchObject({ status: 409 });
    });
  });

  it("keeps the invoice type and sales type, and refuses lines that do not belong on the chosen sales type", async () => {
    await run(async (tx, w) => {
      const tag = uniq();
      const svcId = await ins(tx, "Product", { companyId: w.companyId, code: `SV${tag}`.slice(0, 10), description: "Service", type: "SERVICE", productSubGroupId: (await tx.execute(sql`select "productSubGroupId" as id from "Product" where id = ${w.productId}`))[0].id, updatedAt: NOW });
      await ins(tx, "ServiceDetail", { productId: svcId, unitId: w.unitId, salesGLId: w.salesGLId, purchaseGLId: w.purchaseGLId, updatedAt: NOW });
      const svcLine = { productId: svcId, qty: 1, unitId: w.unitId, rate: 100 };

      const exp = await svc.saveSalesInvoice(draftInput(w, { invoiceType: "EXPORT" }), ACTOR, { tx });
      const typesOf = async (id: number) => (await rows(tx, sql`select "invoiceType", "salesType" from "SalesInvoice" where id = ${id}`))[0];
      expect(await typesOf(exp.id)).toMatchObject({ invoiceType: "EXPORT", salesType: "GOODS_SALES" });

      const sv = await svc.saveSalesInvoice(draftInput(w, { salesType: "SERVICE_SALES", lines: [svcLine] }), ACTOR, { tx });
      expect(await typesOf(sv.id)).toMatchObject({ invoiceType: "LOCAL", salesType: "SERVICE_SALES" });

      await expect(svc.saveSalesInvoice(draftInput(w, { lines: [svcLine] }), ACTOR, { tx })).rejects.toMatchObject({ status: 400 }); // a service on a goods invoice
      await expect(svc.saveSalesInvoice(draftInput(w, { invoiceType: "ABROAD" as any }), ACTOR, { tx })).rejects.toMatchObject({ status: 400 });

      // the reversal keeps the type of the invoice it reverses
      await svc.postSalesInvoice(exp.id, ACTOR, { tx });
      const rev = await svc.reverseSalesInvoice(exp.id, ACTOR, { tx, date: "2025-10-20", reason: "type check" });
      expect(await typesOf(rev.id)).toMatchObject({ invoiceType: "EXPORT", salesType: "GOODS_SALES" });
    });
  });

  it("an export invoice keeps its shipment/customs details and prices foreign-currency lines in NPR", async () => {
    await run(async (tx, w) => {
      const detail = { exportCurrency: "usd", exportExchangeRate: "133.5", customsDeclarationNo: "CDF-77", customsDeclarationDate: "2025-10-13", finalDestination: "Germany", incoterm: "FCA", incotermPlace: "Kathmandu", transportMode: "AIR", netWeight: "12.5", bankSwift: "NABBNPKA" };
      const line = { productId: w.productId, qty: 2, unitId: w.unitId, foreignRate: 10 };
      const saved = await svc.saveSalesInvoice(draftInput(w, { invoiceType: "EXPORT", exportDetail: detail, lines: [line] }), ACTOR, { tx });
      const [inv] = await rows(tx, sql`select "exportCurrency", "exportExchangeRate", "exportForeignTotal", "customsDeclarationNo", "finalDestination", "transportMode", "basicAmount" from "SalesInvoice" where id = ${saved.id}`);
      expect(inv).toMatchObject({ exportCurrency: "USD", customsDeclarationNo: "CDF-77", finalDestination: "Germany", transportMode: "AIR" });
      expect(Number(inv.exportExchangeRate)).toBe(133.5);
      expect(Number(inv.exportForeignTotal)).toBe(20); // 2 x USD 10
      expect(Number(inv.basicAmount)).toBe(2670); // 20 x 133.5, in rupees
      const [l] = await rows(tx, sql`select rate, "basicAmount", "foreignRate", "foreignAmount" from "SalesInvoiceLine" where "salesInvoiceId" = ${saved.id}`);
      expect([Number(l.rate), Number(l.basicAmount), Number(l.foreignRate), Number(l.foreignAmount)]).toEqual([1335, 2670, 10, 20]);

      // posts in rupees, and the reversal keeps the export details
      const posted = await svc.postSalesInvoice(saved.id, ACTOR, { tx });
      const [jv] = await rows(tx, sql`select sum(credit)::numeric as credit from "JournalVoucherLine" where "journalVoucherId" = ${posted.journalVoucherId}`);
      expect(Number(jv.credit)).toBe(2937); // 2670 + 10% tax
      const rev = await svc.reverseSalesInvoice(saved.id, ACTOR, { tx, date: "2025-10-20", reason: "export check" });
      const [r] = await rows(tx, sql`select "exportCurrency", "customsDeclarationNo" from "SalesInvoice" where id = ${rev.id}`);
      expect(r).toMatchObject({ exportCurrency: "USD", customsDeclarationNo: "CDF-77" });
    });
  });

  it("refuses export details on a local invoice, a foreign currency without a rate, and a foreign line without its rate", async () => {
    await run(async (tx, w) => {
      await expect(svc.saveSalesInvoice(draftInput(w, { exportDetail: { finalDestination: "India" } }), ACTOR, { tx })).rejects.toMatchObject({ status: 400 });
      await expect(svc.saveSalesInvoice(draftInput(w, { invoiceType: "EXPORT", exportDetail: { exportCurrency: "USD" } }), ACTOR, { tx })).rejects.toMatchObject({ status: 400 });
      await expect(svc.saveSalesInvoice(draftInput(w, { invoiceType: "EXPORT", exportDetail: { exportCurrency: "USD", exportExchangeRate: "133" } }), ACTOR, { tx })).rejects.toMatchObject({ status: 400 });
      await expect(svc.saveSalesInvoice(draftInput(w, { invoiceType: "EXPORT", exportDetail: { transportMode: "BOAT" } }), ACTOR, { tx })).rejects.toMatchObject({ status: 400 });
      // an export in NPR needs no rate and no foreign rates
      const npr = await svc.saveSalesInvoice(draftInput(w, { invoiceType: "EXPORT", exportDetail: { exportCurrency: "NPR", finalDestination: "India" } }), ACTOR, { tx });
      const [row] = await rows(tx, sql`select "exportCurrency", "basicAmount" from "SalesInvoice" where id = ${npr.id}`);
      expect(row.exportCurrency).toBeNull();
      expect(Number(row.basicAmount)).toBe(100);
    });
  });

  it("stock: posting takes the goods out of the location and batch named on the line, refuses what stock cannot cover, and a reversal brings them back", async () => {
    await run(async (tx, w) => {
      const tag = uniq();
      const sub = (await rows(tx, sql`select "productSubGroupId" as id from "Product" where id = ${w.productId}`))[0].id;
      const goods = async (code: string, extra: Record<string, unknown> = {}) => {
        const id = await ins(tx, "Product", { companyId: w.companyId, code: `${code}${tag}`.slice(0, 10), description: code, type: "STOCK", productSubGroupId: sub, updatedAt: NOW });
        await ins(tx, "StockDetail", { productId: id, baseUnitId: w.unitId, salesGLId: w.salesGLId, purchaseGLId: w.purchaseGLId, updatedAt: NOW, ...extra });
        return id;
      };
      const plain = await goods("PLAIN"), batchy = await goods("BATCHY", { tracksBatch: true });
      const wh = await ins(tx, "Location", { companyId: w.companyId, code: `WH${tag}`.slice(0, 10), name: "Warehouse", updatedAt: NOW });
      const shop = await ins(tx, "Location", { companyId: w.companyId, code: `SH${tag}`.slice(0, 10), name: "Shop", updatedAt: NOW });
      const stockIn = (productId: number, locationId: number | null, batchNo: string | null, qty: number) =>
        ins(tx, "StockMovement", { companyId: w.companyId, branchId: w.branchId, productId, locationId, batchNo, movementDate: "2025-10-01", qty, sourceType: "PURCHASE_BILL", sourceId: 1, sourceLineId: 1 });
      await stockIn(plain, wh, null, 10); await stockIn(batchy, wh, "B1", 5);
      const on = async (productId: number, locationId: number | null, batchNo: string | null = null) =>
        Number((await rows(tx, sql`select coalesce(sum(qty), 0) as q from "StockMovement" where "productId" = ${productId} and "locationId" ${locationId === null ? sql`is null` : sql`= ${locationId}`} and "batchNo" ${batchNo === null ? sql`is null` : sql`= ${batchNo}`}`))[0].q);
      const sell = (lines: any[]) => svc.saveSalesInvoice(draftInput(w, { lines }), ACTOR, { tx });

      const a = await sell([{ productId: plain, qty: 4, unitId: w.unitId, rate: 100, locationId: wh }]);
      await svc.postSalesInvoice(a.id, ACTOR, { tx });
      expect(await on(plain, wh)).toBe(6);

      // from the wrong place, too much, or without the batch the product tracks
      const wrong = await sell([{ productId: plain, qty: 1, unitId: w.unitId, rate: 100, locationId: shop }]);
      await expect(svc.postSalesInvoice(wrong.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      const tooMuch = await sell([{ productId: plain, qty: 7, unitId: w.unitId, rate: 100, locationId: wh }]);
      await expect(svc.postSalesInvoice(tooMuch.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      const twice = await sell([{ productId: plain, qty: 4, unitId: w.unitId, rate: 100, locationId: wh }, { productId: plain, qty: 3, unitId: w.unitId, rate: 100, locationId: wh }]);
      await expect(svc.postSalesInvoice(twice.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 }); // 4 + 3 > 6
      const noBatch = await sell([{ productId: batchy, qty: 1, unitId: w.unitId, rate: 100, locationId: wh }]);
      await expect(svc.postSalesInvoice(noBatch.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      expect(await on(plain, wh)).toBe(6); // nothing moved by the refused ones

      const b = await sell([{ productId: batchy, qty: 2, unitId: w.unitId, rate: 100, locationId: wh, batchNo: "B1" }]);
      await svc.postSalesInvoice(b.id, ACTOR, { tx });
      expect(await on(batchy, wh, "B1")).toBe(3);

      // a non-stock item never touches stock, and a reversal puts the goods back
      const n = await sell([{ productId: w.productId, qty: 1, unitId: w.unitId, rate: 100 }]);
      await svc.postSalesInvoice(n.id, ACTOR, { tx });
      expect((await rows(tx, sql`select count(*)::int as c from "StockMovement" where "sourceType" = 'SALES_INVOICE' and "sourceId" = ${n.id}`))[0].c).toBe(0);
      await svc.reverseSalesInvoice(a.id, ACTOR, { tx, date: "2025-10-20", reason: "stock back" });
      expect(await on(plain, wh)).toBe(10);
    });
  });

  it("challan: confirming takes the goods out once, and an invoice that bills it takes nothing out again", async () => {
    await run(async (tx, w) => {
      const ch = await import("../server/services/salesChallan");
      const tag = uniq();
      const sub = (await rows(tx, sql`select "productSubGroupId" as id from "Product" where id = ${w.productId}`))[0].id;
      const plain = await ins(tx, "Product", { companyId: w.companyId, code: `CH${tag}`.slice(0, 10), description: "Challan goods", type: "STOCK", productSubGroupId: sub, updatedAt: NOW });
      await ins(tx, "StockDetail", { productId: plain, baseUnitId: w.unitId, salesGLId: w.salesGLId, purchaseGLId: w.purchaseGLId, updatedAt: NOW });
      const wh = await ins(tx, "Location", { companyId: w.companyId, code: `WC${tag}`.slice(0, 10), name: "Warehouse", updatedAt: NOW });
      await ins(tx, "StockMovement", { companyId: w.companyId, branchId: w.branchId, productId: plain, locationId: wh, movementDate: "2025-10-01", qty: 10, sourceType: "PURCHASE_BILL", sourceId: 1, sourceLineId: 1 });
      const on = async () => Number((await rows(tx, sql`select coalesce(sum(qty), 0) as q from "StockMovement" where "productId" = ${plain} and "locationId" = ${wh}`))[0].q);
      const challan = (lines: any[]) => ch.saveSalesChallan({ companyId: w.companyId, branchId: w.branchId, challanDate: "2025-10-10", fiscalYear: "2082/83", customerGLId: w.customerGLId, lines }, ACTOR, { tx });
      const line = (qty: number) => ({ productId: plain, qty, unitId: w.unitId, rate: 100, locationId: wh });

      // a challan carries stock items only; a draft moves nothing
      await expect(challan([{ productId: w.productId, qty: 1, unitId: w.unitId, rate: 1 }])).rejects.toMatchObject({ status: 400 });
      const c = await challan([line(6)]);
      expect(await on()).toBe(10);
      // more than is on hand cannot go out
      const big = await challan([line(11)]);
      await expect(ch.confirmSalesChallan(big.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      // an unconfirmed challan cannot be billed
      const cl0 = (await rows(tx, sql`select id from "SalesChallanLine" where "salesChallanId" = ${c.id}`))[0].id;
      const billInput = (qty: number, extra: Record<string, unknown> = {}) => draftInput(w, { salesChallanId: c.id, lines: [{ productId: plain, qty, unitId: w.unitId, rate: 100, challanLineId: cl0 }], ...extra });
      await expect(svc.saveSalesInvoice(billInput(6), ACTOR, { tx })).rejects.toMatchObject({ status: 409 });

      await ch.confirmSalesChallan(c.id, ACTOR, { tx });
      expect(await on()).toBe(4);
      await expect(ch.confirmSalesChallan(c.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      await expect(ch.deleteSalesChallan(c.id, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });
      await expect(ch.saveSalesChallan({ id: c.id, companyId: w.companyId, branchId: w.branchId, challanDate: "2025-10-10", fiscalYear: "2082/83", customerGLId: w.customerGLId, lines: [line(1)] }, ACTOR, { tx })).rejects.toMatchObject({ status: 409 });

      // bill part, then too much; billing a challan line twice over is refused
      const first = await svc.saveSalesInvoice(billInput(4), ACTOR, { tx });
      await expect(svc.saveSalesInvoice(billInput(3), ACTOR, { tx })).rejects.toMatchObject({ status: 409 }); // 4 reserved + 3 > 6
      await svc.postSalesInvoice(first.id, ACTOR, { tx });
      expect(await on()).toBe(4); // the invoice took nothing out again
      expect((await rows(tx, sql`select count(*)::int as c from "StockMovement" where "sourceType" = 'SALES_INVOICE' and "sourceId" = ${first.id}`))[0].c).toBe(0);
      expect((await ch.getSalesChallan(c.id, w.companyId, { tx })).lines[0]).toMatchObject({ billedQty: "4.000000", pendingQty: "2.000000" });

      // the rest, with an extra line that is not on the challan: that line still takes its own stock out
      const second = await svc.saveSalesInvoice(billInput(2, { lines: [{ productId: plain, qty: 2, unitId: w.unitId, rate: 100, challanLineId: cl0 }, { productId: plain, qty: 1, unitId: w.unitId, rate: 100, locationId: wh }] }), ACTOR, { tx });
      await svc.postSalesInvoice(second.id, ACTOR, { tx });
      expect(await on()).toBe(3);

      // a different customer's challan cannot be billed
      const other = await ins(tx, "GeneralLedger", { companyId: w.companyId, code: `C2${tag}`.slice(0, 10), name: "Other customer", accountSubGroupId: (await rows(tx, sql`select "accountSubGroupId" as id from "GeneralLedger" where id = ${w.customerGLId}`))[0].id, normalBalance: "DEBIT", glType: "CUSTOMER", updatedAt: NOW });
      await expect(svc.saveSalesInvoice(billInput(1, { customerGLId: other }), ACTOR, { tx })).rejects.toMatchObject({ status: 409 });

      // reversing an invoice does not bring the delivered goods back: they are still with the customer
      await svc.reverseSalesInvoice(first.id, ACTOR, { tx, date: "2025-10-20", reason: "rebill" });
      expect(await on()).toBe(3);
      expect((await ch.getSalesChallan(c.id, w.companyId, { tx })).lines[0]).toMatchObject({ billedQty: "2.000000", pendingQty: "4.000000" });
    });
  });

  it("refuses a draft with no lines", async () => {
    await run(async (tx, w) => {
      await expect(svc.saveSalesInvoice(draftInput(w, { lines: [] }), ACTOR, { tx })).rejects.toMatchObject({ status: 400 });
    });
  });

  it("the database needs a reason to change a posted invoice, its lines or its terms", async () => {
    await run(async (tx, w) => {
      const saved = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      // drafts change freely, with no reason
      await tx.execute(sql`update "SalesInvoice" set remarks = 'draft note' where id = ${saved.id}`);
      await svc.postSalesInvoice(saved.id, ACTOR, { tx });

      const msg = await refusedByDb(tx, (t) => t.execute(sql`update "SalesInvoice" set remarks = 'sneaky' where id = ${saved.id}`));
      expect(msg).toMatch(/reason is required/i);
      await refusedByDb(tx, (t) => t.execute(sql`update "SalesInvoiceLine" set rate = 1 where "salesInvoiceId" = ${saved.id}`));
      await refusedByDb(tx, (t) => t.execute(sql`delete from "SalesDocumentTerm" where "documentType" = 'SALES_INVOICE' and "documentId" = ${saved.id}`));
      await refusedByDb(tx, (t) => t.execute(sql`delete from "SalesInvoice" where id = ${saved.id}`));

      // with a reason the same change goes through
      await tx.execute(sql`select set_config('namo.change_reason', 'Correcting a typo in the note', true)`);
      await tx.execute(sql`update "SalesInvoice" set remarks = 'corrected' where id = ${saved.id}`);
      const [after] = await rows(tx, sql`select remarks from "SalesInvoice" where id = ${saved.id}`);
      expect(after.remarks).toBe("corrected");
    });
  });

  it("lists invoices by state: draft, posted, reversed and reversal", async () => {
    await run(async (tx, w) => {
      const draft = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      const posted = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      await svc.postSalesInvoice(posted.id, ACTOR, { tx });
      const reversedOne = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      await svc.postSalesInvoice(reversedOne.id, ACTOR, { tx });
      const reversal = await svc.reverseSalesInvoice(reversedOne.id, ACTOR, { tx, date: "2025-10-20", reason: "Issued twice" });

      const idsFor = async (status: string) => {
        const res: any = await svc.listSalesInvoices({ companyId: w.companyId, status, tx } as any);
        return (Array.isArray(res) ? res : res.rows).map((r: any) => Number(r.id)).sort();
      };
      expect(await idsFor("DRAFT")).toEqual([draft.id]);
      expect(await idsFor("POSTED")).toEqual([posted.id]);
      expect(await idsFor("REVERSED")).toEqual([reversedOne.id]);
      expect(await idsFor("REVERSAL")).toEqual([reversal.id]);
      await expect(svc.listSalesInvoices({ companyId: w.companyId, status: "NOPE", tx } as any)).rejects.toMatchObject({ status: 400 });
    });
  });
  it("filters the list by customer, and the lookups carry the customer's credit limit and days", async () => {
    await run(async (tx, w) => {
      const partyId = await ins(tx, "Party", { companyId: w.companyId, generalLedgerId: w.customerGLId, updatedAt: NOW });
      await ins(tx, "CustomerDetail", { partyId, creditLimit: "50000", creditDays: 30, updatedAt: NOW });
      const lookups = await svc.salesInvoiceLookups(w.companyId, w.branchId, null, { tx } as any);
      expect(lookups.customers.find((c: any) => c.id === w.customerGLId)).toMatchObject({ creditLimit: "50000.000000", creditDays: 30 });

      const mine = await svc.saveSalesInvoice(draftInput(w), ACTOR, { tx });
      const otherGL = await ins(tx, "GeneralLedger", { companyId: w.companyId, code: `CU2${uniq()}`.slice(0, 10), name: "Other customer", accountSubGroupId: (await rows(tx, sql`select "accountSubGroupId" as id from "GeneralLedger" where id = ${w.customerGLId}`))[0].id, normalBalance: "DEBIT", glType: "CUSTOMER", updatedAt: NOW });
      await svc.saveSalesInvoice(draftInput(w, { customerGLId: otherGL }), ACTOR, { tx });
      const res: any = await svc.listSalesInvoices({ companyId: w.companyId, customerGLId: w.customerGLId, tx } as any);
      expect(res.rows.map((r: any) => Number(r.id))).toEqual([mine.id]);
    });
  });
});
