import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

describe.skipIf(!DB_READY)("Cost assessment: local and import, against ledgers, stock-value flag (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  let userId = 0;
  const tag = uniq();
  const c = (s: string) => `${s}${tag}`.slice(0, 20);
  const W: Record<string, number> = {};
  const NOW = sql`now()`;
  const ins = async (table: string, values: Record<string, unknown>) => {
    const keys = Object.keys(values);
    const rows = await db.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${values[k]}`), sql`, `)}) returning id`);
    return rows[0].id as number;
  };
  const rows = async (query: any) => await db.execute(query) as any[];
  const api = (kind: string) => `/api/purchase/${kind}`;
  const billBody = (extra: Record<string, unknown>) => ({ companyId: W.co, branchId: W.br, fiscalYear: "2082/83", invoiceDate: "2025-10-15", vendorGLId: W.vendor, userId, ...extra });
  const createBill = async (extra: Record<string, unknown>) => {
    const response = await call("POST", api("bills"), billBody(extra));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.result as { id: number; invoiceNumber: string };
  };
  const action = async (id: number, name: string, body: Record<string, unknown> = {}) => call("POST", `${api("bills")}/${id}/${name}?companyId=${W.co}`, { userId, ...body });

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    userId = (await call("GET", "/api/context")).body.user.id;
    W.co = await ins("Company", { code: c("T"), name: `Import assessment ${tag}`, isActive: false, updatedAt: NOW });
    W.br = await ins("Branch", { companyId: W.co, code: c("BR"), name: "Import branch", updatedAt: NOW });
    await ins("FiscalYear", { companyId: W.co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins("AccountGroup", { companyId: W.co, code: c("G"), description: "Test", type: "EXPENSE", updatedAt: NOW });
    const sub = await ins("AccountSubGroup", { code: c("SG"), description: "Test", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, normalBalance = "DEBIT") => ins("GeneralLedger", { companyId: W.co, code: c(code), name: code, accountSubGroupId: sub, normalBalance, updatedAt: NOW });
    W.vendor = await gl("VENDOR", "CREDIT");
    W.purchase = await gl("PURCH");
    W.inputTax = await gl("INPUTVAT");
    W.bank = await gl("BANK");
    W.exciseGL = await gl("EXCISEGL");
    W.unit = await ins("ProductUnit", { companyId: W.co, code: c("PCS").slice(0, 10), name: "Piece", updatedAt: NOW });
    const group = await ins("ProductGroup", { companyId: W.co, code: c("PG"), name: "Stock", updatedAt: NOW });
    const subGroup = await ins("ProductSubGroup", { code: c("PSG"), name: "Stock", productGroupId: group, updatedAt: NOW });
    W.goods = await ins("Product", { companyId: W.co, code: c("GOODS").slice(0, 10), description: "Imported goods", type: "STOCK", productSubGroupId: subGroup, updatedAt: NOW });
    await ins("StockDetail", { productId: W.goods, baseUnitId: W.unit, purchaseGLId: W.purchase, updatedAt: NOW });
    W.service = await ins("Product", { companyId: W.co, code: c("SERVICE").slice(0, 10), description: "Insurance service", type: "NON_STOCK", productSubGroupId: subGroup, updatedAt: NOW });
    await ins("NonStockDetail", { productId: W.service, unitId: W.unit, purchaseGLId: W.purchase, salesGLId: W.purchase, updatedAt: NOW });
    W.vat = await ins("PurchaseTerm", { companyId: W.co, code: c("VAT"), name: "Input VAT", nature: "ADDITIVE", sequence: 90, defaultCalcType: "PERCENT", defaultValue: "13", generalLedgerId: W.inputTax, updatedAt: NOW });
    W.duty = await ins("PurchaseTerm", { companyId: W.co, code: c("DUTY"), name: "Import duty", category: "COSTING", nature: "ADDITIVE", sequence: 10, defaultCalcType: "PERCENT", defaultValue: "10", distributeToLines: true, allocationBasis: "QUANTITY", generalLedgerId: W.purchase, updatedAt: NOW });
    W.excise = await ins("PurchaseTerm", { companyId: W.co, code: c("EXCISE"), name: "Excise", category: "COSTING", nature: "ADDITIVE", sequence: 20, defaultCalcType: "AMOUNT", defaultValue: "50", generalLedgerId: W.exciseGL, updatedAt: NOW });
    W.cash = await gl("CASH");
    W.ram = await gl("RAMTRANS", "CREDIT");
    W.seraj = await gl("SERAJ", "CREDIT");
    W.forwarder = await gl("FORWARDER", "CREDIT");
    W.labourGL = await gl("LABOUR");
    W.dutyGL = await gl("IMPDUTY");
    W.vatGL = await gl("IMPVAT");
    W.rebateGL = await gl("REBATE");
    // Terms as the owner described them: own ledger fixed in the master, the against ledger chosen per case (a default may exist).
    W.labour = await ins("PurchaseTerm", { companyId: W.co, code: c("LABOUR"), name: "Unloading labour", category: "COSTING", nature: "ADDITIVE", sequence: 5, defaultCalcType: "AMOUNT", defaultValue: "200", generalLedgerId: W.labourGL, affectsStockValue: true, updatedAt: NOW });
    W.idty = await ins("PurchaseTerm", { companyId: W.co, code: c("IDUTY"), name: "Customs duty", category: "COSTING", nature: "ADDITIVE", sequence: 10, defaultCalcType: "PERCENT", defaultValue: "10", generalLedgerId: W.dutyGL, defaultAgainstLedgerId: W.bank, affectsStockValue: true, updatedAt: NOW });
    W.ivat = await ins("PurchaseTerm", { companyId: W.co, code: c("IVAT"), name: "Import VAT", category: "COSTING", nature: "ADDITIVE", sequence: 20, defaultCalcType: "PERCENT", defaultValue: "13", calcBase: "RUNNING_TOTAL", generalLedgerId: W.vatGL, defaultAgainstLedgerId: W.bank, affectsStockValue: false, updatedAt: NOW });
    W.rebate = await ins("PurchaseTerm", { companyId: W.co, code: c("REBATE"), name: "Supplier rebate", category: "COSTING", nature: "DEDUCTIVE", sequence: 30, defaultCalcType: "AMOUNT", defaultValue: "20", generalLedgerId: W.rebateGL, affectsStockValue: true, updatedAt: NOW });
  });

  afterAll(async () => {
    if (W.co) await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const table of ["PurchaseImportAssessmentAllocation", "PurchaseImportAssessmentLine", "PurchaseImportAssessmentTerm", "PurchaseImportAssessment"]) await tx.execute(sql`delete from ${sql.identifier(table)} where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "PurchaseDocumentTermAllocation" where "documentTermId" in (select id from "PurchaseDocumentTerm" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "PurchaseDocumentTerm" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "PurchaseBillImportDetail" where "purchaseBillId" in (select id from "PurchaseBill" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "PurchaseBillLine" where "purchaseBillId" in (select id from "PurchaseBill" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "PurchaseBill" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "JournalVoucherLine" where "journalVoucherId" in (select id from "JournalVoucher" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "JournalVoucher" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "NonStockDetail" where "productId" in (select id from "Product" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "StockDetail" where "productId" in (select id from "Product" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "PurchaseTerm" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "Product" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "ProductSubGroup" where "productGroupId" in (select id from "ProductGroup" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "ProductGroup" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "ProductUnit" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "GeneralLedger" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${W.co})`);
      await tx.execute(sql`delete from "AccountGroup" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "FiscalYear" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "Branch" where "companyId" = ${W.co}`);
      await tx.execute(sql`delete from "Company" where id = ${W.co}`);
    });
    await close();
  });


  const goodsLines = () => [{ productId: W.goods, qty: 30, rate: 100 }, { productId: W.goods, qty: 10, rate: 200 }]; // 3,000 + 2,000
  const landedOf = (billId: number) => rows(sql`select "landedAmount"::text as amount, "landedRate"::text as rate from "PurchaseBillLine" where "purchaseBillId" = ${billId} order by "lineNumber"`);
  const voucherLines = (voucherId: number) => rows(sql`select "generalLedgerId" as gl, debit::text as dr, credit::text as cr from "JournalVoucherLine" where "journalVoucherId" = ${voucherId} order by "lineNumber"`);
  const side = (lines: any[], gl: number, which: "dr" | "cr") => Number(lines.filter((l) => l.gl === gl).reduce((a, l) => a + Number(l[which]), 0).toFixed(2));
  const makeAssessment = async (billId: number, terms: unknown[]) => {
    const r = await call("POST", api("import-assessments"), { companyId: W.co, branchId: W.br, fiscalYear: "2082/83", importBillId: billId, assessmentDate: "2025-10-16", userId, terms });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.document;
  };
  const applyAssessment = (id: number) => call("POST", `${api("import-assessments")}/${id}/apply?companyId=${W.co}`, { userId });
  const postedService = async (goodsId: number, vendorGLId: number, rate: number, treatment: "CIF" | "LANDED_ONLY") => {
    const bill = await createBill({ invoiceType: "LOCAL", purchaseType: "SERVICE_PURCHASE_OTHERS", vendorGLId, importCostForBillId: goodsId, importCostAllocationBasis: "VALUE", importCostTreatment: treatment, lines: [{ productId: W.service, qty: 1, rate }] });
    expect((await action(bill.id, "post")).status).toBe(200);
    return bill;
  };

  it("LOCAL example: goods 5,000 + VAT, two linked service bills (500, 1,000), a cash-paid labour charge -> landed 6,700; labour posts Dr Labour / Cr Cash", async () => {
    const goods = await createBill({ invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", lines: goodsLines(), terms: [{ termId: W.vat }] });
    expect((await action(goods.id, "post")).status).toBe(200);
    const head = (await rows(sql`select "basicAmount"::text as basic, "termAmount"::text as terms, "totalAmount"::text as total from "PurchaseBill" where id = ${goods.id}`))[0];
    expect([Number(head.basic), Number(head.terms), Number(head.total)]).toEqual([5000, 650, 5650]); // VAT is a GENERAL term on the bill

    // A local goods bill can now be costed: it is offered for assessment, and service bills can be linked to it.
    const eligible = (await call("GET", `${api("import-assessments")}/eligible-imports?companyId=${W.co}&branchId=${W.br}&fiscalYear=2082%2F83`)).body.rows;
    expect(eligible.find((r: any) => r.id === goods.id)).toMatchObject({ invoiceType: "LOCAL" });
    await postedService(goods.id, W.ram, 500, "LANDED_ONLY");   // transport
    await postedService(goods.id, W.seraj, 1000, "LANDED_ONLY"); // agent commission, owed to Seraj

    const doc = await makeAssessment(goods.id, [{ termId: W.labour, allocationBasis: "VALUE", againstLedgerId: W.cash }]);
    expect(doc.terms[0]).toMatchObject({ capitalizable: true, generalLedgerId: W.labourGL, againstLedgerId: W.cash, againstLedgerName: "CASH" });
    const applied = await applyAssessment(doc.id);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);

    const posted = await voucherLines(applied.body.document.journalVoucherId);
    expect([side(posted, W.labourGL, "dr"), side(posted, W.cash, "cr"), posted.length]).toEqual([200, 200, 2]);
    expect(Number(applied.body.document.totalLandedValue)).toBe(6700); // 5,000 + 500 + 1,000 + 200; the claimable VAT is not in it
    const landed = await landedOf(goods.id);
    expect(landed.map((l) => Number(l.amount))).toEqual([4020, 2680]); // split 60/40 by value
    expect(landed.map((l) => Number(l.rate))).toEqual([134, 268]);
  });

  it("IMPORT example: freight (CIF) + clearing agent (landed only), duty and import VAT assessed -> landed 7,050; VAT posts but is not stock value", async () => {
    const goods = await createBill({ invoiceType: "IMPORT", purchaseType: "GOODS_PURCHASE_OTHERS", importDetail: { customsDeclarationNo: "CUS-EX" }, lines: goodsLines() });
    expect((await action(goods.id, "post")).status).toBe(200);
    await postedService(goods.id, W.forwarder, 500, "CIF");       // international freight: part of the customs value
    await postedService(goods.id, W.seraj, 1000, "LANDED_ONLY");  // clearing agent: cost, but not customs value

    const doc = await makeAssessment(goods.id, [{ termId: W.idty, allocationBasis: "VALUE" }, { termId: W.ivat, allocationBasis: "VALUE" }]);
    const duty = doc.terms.find((t: any) => t.termId === W.idty), vat = doc.terms.find((t: any) => t.termId === W.ivat);
    expect(duty).toMatchObject({ capitalizable: true, againstLedgerId: W.bank });   // both defaults came from the term master
    expect(vat).toMatchObject({ capitalizable: false, againstLedgerId: W.bank });
    expect(doc.preview).toMatchObject({ cifValue: "5500.00", assessedNet: "1336.50", capitalizedAssessments: "550.00", totalLandedValue: "7050.00" });

    const applied = await applyAssessment(doc.id);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const posted = await voucherLines(applied.body.document.journalVoucherId);
    expect([side(posted, W.dutyGL, "dr"), side(posted, W.vatGL, "dr"), side(posted, W.bank, "cr")]).toEqual([550, 786.5, 1336.5]);
    expect(Number(applied.body.document.totalLandedValue)).toBe(7050); // VAT 786.50 posted to its ledger but is not in the stock value
    const landed = await landedOf(goods.id);
    expect(landed.map((l) => Number(l.amount))).toEqual([4230, 2820]);
    expect(landed.map((l) => Number(l.rate))).toEqual([141, 282]);
  });

  it("a deductive charge posts the other way round and lowers the landed value", async () => {
    const goods = await createBill({ invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", lines: goodsLines() });
    expect((await action(goods.id, "post")).status).toBe(200);
    const doc = await makeAssessment(goods.id, [{ termId: W.labour, allocationBasis: "VALUE", againstLedgerId: W.cash }, { termId: W.rebate, allocationBasis: "VALUE", againstLedgerId: W.bank }]);
    const applied = await applyAssessment(doc.id);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const posted = await voucherLines(applied.body.document.journalVoucherId);
    expect([side(posted, W.labourGL, "dr"), side(posted, W.cash, "cr"), side(posted, W.bank, "dr"), side(posted, W.rebateGL, "cr")]).toEqual([200, 200, 20, 20]);
    expect(Number(applied.body.document.totalLandedValue)).toBe(5180); // 5,000 + 200 - 20
  });

  it("every charge needs an against ledger different from its own ledger; the database also refuses an applied assessment without them", async () => {
    const goods = await createBill({ invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", lines: goodsLines() });
    expect((await action(goods.id, "post")).status).toBe(200);

    const same = await call("POST", api("import-assessments"), { companyId: W.co, branchId: W.br, fiscalYear: "2082/83", importBillId: goods.id, assessmentDate: "2025-10-16", userId, terms: [{ termId: W.labour, allocationBasis: "VALUE", againstLedgerId: W.labourGL }] });
    expect(same.status).toBe(400);
    expect(same.body.message).toMatch(/must differ from the term's own ledger/i);

    const doc = await makeAssessment(goods.id, [{ termId: W.labour, allocationBasis: "VALUE" }]); // labour has no default against ledger
    expect(doc.terms[0].againstLedgerId).toBeNull();
    const refused = await applyAssessment(doc.id);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/choose the against ledger/i);

    // Straight to the database: an applied assessment with an amount but no ledgers, then with ledgers but no voucher.
    const dbError = async (statement: any) => { try { await db.execute(statement); } catch (error: any) { return String(error?.cause?.message ?? error?.message); } return ""; };
    await db.execute(sql`update "PurchaseImportAssessmentTerm" set "finalAmount" = 200 where "assessmentId" = ${doc.id}`);
    expect(await dbError(sql`update "PurchaseImportAssessment" set "isPosted" = true where id = ${doc.id}`)).toMatch(/own ledger and an against ledger/i);
    await db.execute(sql`update "PurchaseImportAssessmentTerm" set "againstLedgerId" = ${W.cash} where "assessmentId" = ${doc.id}`);
    expect(await dbError(sql`update "PurchaseImportAssessment" set "isPosted" = true where id = ${doc.id}`)).toMatch(/must post its journal voucher/i);
  });
  it("a charge can be split product-wise by hand: the typed amounts must add up to the charge, and they drive the landed value", async () => {
    const lineIds = async (billId: number) => (await rows(sql`select id from "PurchaseBillLine" where "purchaseBillId" = ${billId} order by "lineNumber"`)).map((r) => r.id as number);
    const manualDuty = (ids: number[], a: number, b: number) => [{ termId: W.idty, allocationBasis: "VALUE", againstLedgerId: W.bank, allocationMode: "MANUAL", manualAmounts: [{ purchaseBillLineId: ids[0], amount: a }, { purchaseBillLineId: ids[1], amount: b }] }];

    // Duty is 10% of 5,000 = 500. Automatic by value would be 300 / 200; the user wants 350 / 150.
    const short = await createBill({ invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", lines: goodsLines() });
    expect((await action(short.id, "post")).status).toBe(200);
    const shortIds = await lineIds(short.id);
    const bad = await makeAssessment(short.id, manualDuty(shortIds, 350, 100));
    expect(bad.terms[0]).toMatchObject({ allocationMode: "MANUAL" });
    const refused = await applyAssessment(bad.id);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/add up before applying/i);

    const goods = await createBill({ invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", lines: goodsLines() });
    expect((await action(goods.id, "post")).status).toBe(200);
    const ids = await lineIds(goods.id);
    const doc = await makeAssessment(goods.id, manualDuty(ids, 350, 150));
    const applied = await applyAssessment(doc.id);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(Number(applied.body.document.totalLandedValue)).toBe(5500);
    const landed = await landedOf(goods.id);
    expect(landed.map((l) => Number(l.amount))).toEqual([3350, 2150]); // 3,000 + 350 and 2,000 + 150, not the 300 / 200 split
    const posted = await voucherLines(applied.body.document.journalVoucherId);
    expect([side(posted, W.dutyGL, "dr"), side(posted, W.bank, "cr")]).toEqual([500, 500]);

    // A line that is not on the bill, and a manual split of a charge that does not affect stock value, are refused.
    const fresh = await createBill({ invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", lines: goodsLines() });
    expect((await action(fresh.id, "post")).status).toBe(200);
    const foreign = await call("POST", api("import-assessments"), { companyId: W.co, branchId: W.br, fiscalYear: "2082/83", importBillId: fresh.id, assessmentDate: "2025-10-16", userId, terms: manualDuty(ids, 350, 150) });
    expect(foreign.status).toBe(400);
    const noStock = await call("POST", api("import-assessments"), { companyId: W.co, branchId: W.br, fiscalYear: "2082/83", importBillId: fresh.id, assessmentDate: "2025-10-16", userId, terms: [{ termId: W.ivat, allocationBasis: "VALUE", againstLedgerId: W.bank, allocationMode: "MANUAL", manualAmounts: [] }] });
    expect(noStock.status).toBe(400);
  });
  it("an import bill can optionally carry a foreign currency and exchange rate; the last against ledger used for a charge is offered next time", async () => {
    // each valid bill needs its own customs declaration number (one declaration belongs to one live bill)
    let fx = 0;
    const imp = (extra: Record<string, unknown>) => call("POST", api("bills"), billBody({ invoiceType: "IMPORT", purchaseType: "GOODS_PURCHASE_OTHERS", importDetail: { customsDeclarationNo: `CUS-FX-${++fx}`, ...extra }, lines: goodsLines() }));
    const plain = await imp({});
    expect(plain.status, JSON.stringify(plain.body)).toBe(201); // currency stays optional
    expect((await imp({ currencyCode: "USD" })).status).toBe(400);               // a currency needs its rate
    expect((await imp({ exchangeRate: 133.5 })).status).toBe(400);               // a rate needs its currency
    expect((await imp({ currencyCode: "usd1", exchangeRate: 133.5 })).status).toBe(400);
    const ok = await imp({ currencyCode: "usd", exchangeRate: 133.5, foreignInvoiceAmount: 1000 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const saved = (await call("GET", `${api("bills")}/${ok.body.result.id}?companyId=${W.co}`)).body.importDetail;
    expect([saved.currencyCode, Number(saved.exchangeRate), Number(saved.foreignInvoiceAmount)]).toEqual(["USD", 133.5, 1000]);

    // Remembered against ledger: after a charge was assessed against Seraj, the term lookup offers Seraj.
    const goods = await createBill({ invoiceType: "LOCAL", purchaseType: "GOODS_PURCHASE_OTHERS", lines: goodsLines() });
    expect((await action(goods.id, "post")).status).toBe(200);
    await makeAssessment(goods.id, [{ termId: W.labour, allocationBasis: "VALUE", againstLedgerId: W.seraj }]);
    const lookups = (await call("GET", `/api/purchase/lookups?companyId=${W.co}`)).body;
    expect(lookups.terms.find((t: any) => t.id === W.labour)).toMatchObject({ lastAgainstLedgerId: W.seraj, defaultAgainstLedgerId: null });
    expect(lookups.terms.find((t: any) => t.id === W.idty)).toMatchObject({ defaultAgainstLedgerId: W.bank });
  });
});
