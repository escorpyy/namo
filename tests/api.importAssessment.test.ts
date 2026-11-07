import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

describe.skipIf(!DB_READY)("Import cost assessment (API)", () => {
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
  // Additional bills can no longer be entered through the API (it answers 400); the service still posts and reverses any that already exist,
  // so the tests create them there to keep covering how an import assessment treats them.
  const createLegacyAdditional = async (mainBillId: number, terms: Record<string, unknown>[]) => {
    const svc = await import("../server/services/purchase");
    return await svc.savePurchaseBill({ companyId: W.co, branchId: W.br, fiscalYear: "2082/83", invoiceDate: "2025-10-15", vendorGLId: W.vendor, invoiceType: "LOCAL", mainBillId, lines: [], terms } as any, { userId }) as { id: number; invoiceNumber: string };
  };
  const action = async (id: number, name: string, body: Record<string, unknown> = {}) => call("POST", `${api("bills")}/${id}/${name}?companyId=${W.co}`, { userId, ...body });
  const assessmentTerms = () => [
    { termId: W.duty, calcType: "PERCENT", rate: "10", allocationBasis: "VALUE", capitalizable: true, againstLedgerId: W.bank },
    { termId: W.excise, calcType: "AMOUNT", inputAmount: "50", allocationBasis: "QUANTITY", capitalizable: true, againstLedgerId: W.bank },
  ];

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
    W.duty = await ins("PurchaseTerm", { companyId: W.co, code: c("DUTY"), name: "Import duty", category: "ADDITIONAL", nature: "ADDITIVE", sequence: 10, defaultCalcType: "PERCENT", defaultValue: "10", distributeToLines: true, allocationBasis: "QUANTITY", generalLedgerId: W.purchase, updatedAt: NOW });
    W.excise = await ins("PurchaseTerm", { companyId: W.co, code: c("EXCISE"), name: "Excise", category: "ADDITIONAL", nature: "ADDITIVE", sequence: 20, defaultCalcType: "AMOUNT", defaultValue: "50", generalLedgerId: W.exciseGL, updatedAt: NOW });
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

  it("previews CIF and assessed charges, applies product-wise valuation, posts Dr own ledger / Cr against ledger, and reverses with a mirror voucher", async () => {
    const goods = await createBill({ invoiceType: "IMPORT", purchaseType: "GOODS_PURCHASE_OTHERS", importDetail: { customsDeclarationNo: "CUS-1" }, lines: [
      { productId: W.goods, qty: 10, rate: 100 }, { productId: W.goods, qty: 1, rate: 500 },
    ] });
    expect((await action(goods.id, "post")).status).toBe(200);
    const service = await createBill({ invoiceType: "LOCAL", purchaseType: "SERVICE_PURCHASE_OTHERS", importCostForBillId: goods.id, importCostAllocationBasis: "VALUE", importCostTreatment: "CIF",
      lines: [{ productId: W.service, qty: 1, rate: 300 }], terms: [{ termId: W.vat }] });
    expect((await action(service.id, "post")).status).toBe(200);
    const legacyAdditional = await createLegacyAdditional(goods.id, [{ termId: W.duty, calcType: "AMOUNT", inputAmount: "75" }]);
    expect((await action(legacyAdditional.id, "post")).status).toBe(200);

    const termInput = assessmentTerms();
    const preview = await call("POST", `${api("import-assessments")}/preview`, { companyId: W.co, branchId: W.br, importBillId: goods.id, terms: termInput });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.preview).toMatchObject({ goodsValue: "1500.00", customsValueFromSources: "300.00", cifValue: "1800.00", invoicedCapitalizedCosts: "300.00", existingPurchaseTermCosts: "75.00", assessedNet: "230.00", capitalizedAssessments: "230.00", totalLandedValue: "2105.00" });
    expect(preview.body.preview.terms.map((t: any) => t.finalAmount)).toEqual(["180.00", "50.00"]);
    expect(preview.body.preview.lines.map((l: any) => l.customsValue)).toEqual(["1200.00", "600.00"]);
    expect(preview.body.preview.lines.map((l: any) => l.existingPurchaseTermCosts)).toEqual(["68.18", "6.82"]);

    const saved = await call("POST", api("import-assessments"), { companyId: W.co, branchId: W.br, fiscalYear: "2082/83", importBillId: goods.id, assessmentDate: "2025-10-16", referenceNo: "CUS-ASSESS-1", userId, terms: termInput });
    expect(saved.status, JSON.stringify(saved.body)).toBe(201);
    const assessmentId = saved.body.document.id as number;
    const updated = await call("PUT", `${api("import-assessments")}/${assessmentId}?companyId=${W.co}`, { companyId: W.co, branchId: W.br, fiscalYear: "2082/83", importBillId: goods.id, assessmentDate: "2025-10-16", referenceNo: "CUS-ASSESS-UPDATED", remarks: "Draft revision", userId, terms: termInput });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.document).toMatchObject({ referenceNo: "CUS-ASSESS-UPDATED", remarks: "Draft revision", state: "DRAFT" });
    const listed = await call("GET", `${api("import-assessments")}?companyId=${W.co}&branchId=${W.br}&fiscalYear=2082%2F83`);
    expect(listed.status).toBe(200);
    expect(listed.body.rows).toMatchObject([{ id: assessmentId, state: "DRAFT", referenceNo: "CUS-ASSESS-UPDATED" }]);
    const duplicate = await call("POST", api("import-assessments"), { companyId: W.co, branchId: W.br, fiscalYear: "2082/83", importBillId: goods.id, assessmentDate: "2025-10-16", userId, terms: termInput });
    expect(duplicate.status).toBe(409);
    expect((await call("GET", `${api("import-assessments")}/eligible-imports?companyId=${W.co}&branchId=${W.br}&fiscalYear=2082%2F83`)).body.rows).toHaveLength(0);
    const beforeVoucherCount = Number((await rows(sql`select count(*)::int as n from "JournalVoucher" where "companyId" = ${W.co}`))[0].n);

    const applied = await call("POST", `${api("import-assessments")}/${assessmentId}/apply?companyId=${W.co}`, { userId });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect(applied.body.document).toMatchObject({ isPosted: true, state: "APPLIED" });
    expect(Number(applied.body.document.cifValue)).toBe(1800);
    expect(Number(applied.body.document.totalLandedValue)).toBe(2105);
    const appliedLines = await rows(sql`select "landedAmount", "landedRate" from "PurchaseBillLine" where "purchaseBillId" = ${goods.id} order by "lineNumber"`);
    expect(appliedLines.map((l) => Number(l.landedAmount).toFixed(2))).toEqual(["1433.63", "671.37"]);
    expect(appliedLines.map((l) => l.landedRate)).toEqual(["143.363000", "671.370000"]);
    expect(Number(appliedLines.reduce((total, l) => total + Number(l.landedAmount), 0).toFixed(2))).toBe(Number(applied.body.document.totalLandedValue));
    // Applying posted exactly one voucher: Dr duty ledger 180 + Dr excise ledger 50 / Cr Bank 230.
    expect(Number((await rows(sql`select count(*)::int as n from "JournalVoucher" where "companyId" = ${W.co}`))[0].n)).toBe(beforeVoucherCount + 1);
    expect(applied.body.document).toMatchObject({ glPosted: true });
    expect(applied.body.document.voucherNumber).toMatch(/^CA-/);
    const voucherLines = (voucherId: number) => rows(sql`select "generalLedgerId" as gl, debit::text as dr, credit::text as cr from "JournalVoucherLine" where "journalVoucherId" = ${voucherId} order by "lineNumber"`);
    const postedLines = await voucherLines(applied.body.document.journalVoucherId);
    const amountOf = (lines: any[], gl: number, side: "dr" | "cr") => Number(lines.filter((l) => l.gl === gl).reduce((a, l) => a + Number(l[side]), 0).toFixed(2));
    expect(amountOf(postedLines, W.purchase, "dr")).toBe(180);
    expect(amountOf(postedLines, W.exciseGL, "dr")).toBe(50);
    expect(amountOf(postedLines, W.bank, "cr")).toBe(230);
    expect(postedLines.reduce((a, l) => a + Number(l.dr), 0)).toBe(postedLines.reduce((a, l) => a + Number(l.cr), 0));

    const lateAdditional = await createLegacyAdditional(goods.id, [{ termId: W.duty, calcType: "AMOUNT", inputAmount: "10" }]);
    let directPostError: any;
    try { await db.execute(sql`update "PurchaseBill" set "isPosted" = true where id = ${lateAdditional.id}`); } catch (error) { directPostError = error; }
    expect(directPostError, "the database guard must refuse a direct post").toBeTruthy();
    expect(String(directPostError?.cause?.message ?? directPostError?.message)).toMatch(/reverse the applied import assessment before changing the posted status/i);
    const directReasonedUpdate = async (update: (tx: any) => Promise<unknown>) => {
      let directError: any;
      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('namo.change_reason', 'Import assessment basis guard test', true)`);
          await update(tx);
        });
      } catch (error) { directError = error; }
      expect(directError, "the database guard must refuse a posted-bill basis change").toBeTruthy();
      return String(directError?.cause?.message ?? directError?.message);
    };
    expect(await directReasonedUpdate((tx) => tx.execute(sql`
      insert into "PurchaseBill" ("companyId", "branchId", "invoiceNumber", "invoiceDate", "fiscalYear", "invoiceType", "purchaseType", "vendorGLId", "journalVoucherId", "importCostForBillId", "importCostAllocationBasis", "importCostTreatment", "isPosted")
      select "companyId", "branchId", 'DIRECT-SVC-BLOCK', "invoiceDate", "fiscalYear", 'LOCAL', 'SERVICE_PURCHASE_OTHERS', "vendorGLId", "journalVoucherId", ${goods.id}, 'VALUE', 'CIF', true
        from "PurchaseBill" where id = ${service.id}
    `))).toMatch(/reverse the applied import assessment before inserting a posted linked service invoice/i);
    expect(await directReasonedUpdate((tx) => tx.execute(sql`
      insert into "PurchaseBill" ("companyId", "branchId", "invoiceNumber", "invoiceDate", "fiscalYear", "invoiceType", "purchaseType", "vendorGLId", "journalVoucherId", "mainBillId", "isPosted")
      select "companyId", "branchId", 'DIRECT-ADD-BLOCK', "invoiceDate", "fiscalYear", 'LOCAL', "purchaseType", "vendorGLId", "journalVoucherId", ${goods.id}, true
        from "PurchaseBill" where id = ${legacyAdditional.id}
    `))).toMatch(/reverse the applied import assessment before inserting a posted additional bill/i);
    expect(await directReasonedUpdate((tx) => tx.execute(sql`update "PurchaseBill" set "isPosted" = false where id = ${legacyAdditional.id}`))).toMatch(/reverse the applied import assessment before changing the posted status/i);
    expect(await directReasonedUpdate((tx) => tx.execute(sql`update "PurchaseBill" set "isPosted" = false where id = ${service.id}`))).toMatch(/reverse the applied import assessment before changing the posted status/i);
    expect(await directReasonedUpdate((tx) => tx.execute(sql`update "PurchaseBill" set "importCostTreatment" = 'LANDED_ONLY' where id = ${service.id}`))).toMatch(/reverse the active import assessment before changing a posted cost-basis bill or source link/i);
    const blockedAdditionalPost = await action(lateAdditional.id, "post");
    expect(blockedAdditionalPost.status).toBe(409);
    expect(blockedAdditionalPost.body.message).toMatch(/reverse the applied import-cost assessment before posting an additional bill/i);
    const blockedAdditionalReverse = await action(legacyAdditional.id, "reverse", { date: "2025-10-16", reason: "Correct additional bill" });
    expect(blockedAdditionalReverse.status).toBe(409);
    expect(blockedAdditionalReverse.body.message).toMatch(/active import-cost assessment before reversing this linked bill/i);

    const lateSource = await createBill({ invoiceType: "LOCAL", purchaseType: "SERVICE_PURCHASE_OTHERS", importCostForBillId: goods.id, importCostAllocationBasis: "VALUE", importCostTreatment: "CIF", lines: [{ productId: W.service, qty: 1, rate: 50 }] });
    const blockedPost = await action(lateSource.id, "post");
    expect(blockedPost.status).toBe(409);
    expect(blockedPost.body.message).toMatch(/reverse the applied import-cost assessment/i);

    const vouchersBeforeReverse = Number((await rows(sql`select count(*)::int as n from "JournalVoucher" where "companyId" = ${W.co}`))[0].n);
    const reversed = await call("POST", `${api("import-assessments")}/${assessmentId}/reverse?companyId=${W.co}`, { userId, reason: "Correct assessed charge basis", date: "2025-10-20" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
    expect(Number((await rows(sql`select count(*)::int as n from "JournalVoucher" where "companyId" = ${W.co}`))[0].n)).toBe(vouchersBeforeReverse + 1);
    expect(reversed.body.document.reversalVoucherNumber).toMatch(/^R-CA-/);
    const mirrorLines = await voucherLines(reversed.body.document.reversalVoucherId);
    expect(amountOf(mirrorLines, W.bank, "dr")).toBe(230);
    expect(amountOf(mirrorLines, W.purchase, "cr")).toBe(180);
    expect(amountOf(mirrorLines, W.exciseGL, "cr")).toBe(50);
    expect(reversed.body.document).toMatchObject({ isPosted: true, state: "REVERSED", reversalReason: "Correct assessed charge basis" });
    expect(Number(reversed.body.document.totalLandedValue)).toBe(2105);
    const rolledBackLines = await rows(sql`select "landedAmount" from "PurchaseBillLine" where "purchaseBillId" = ${goods.id} order by "lineNumber"`);
    expect(rolledBackLines.map((l) => Number(l.landedAmount).toFixed(2))).toEqual(["1268.18", "606.82"]);
    expect((await rows(sql`select count(*)::int as n from "PurchaseImportAssessmentLine" where "assessmentId" = ${assessmentId}`))[0].n).toBe(2);
    expect((await rows(sql`select "existingPurchaseTermCosts" from "PurchaseImportAssessmentLine" where "assessmentId" = ${assessmentId} order by "purchaseBillLineId"`)).map((l) => Number(l.existingPurchaseTermCosts).toFixed(2))).toEqual(["68.18", "6.82"]);
    expect((await rows(sql`select count(*)::int as n from "PurchaseImportAssessmentAllocation" where "assessmentId" = ${assessmentId}`))[0].n).toBe(4);

    expect((await action(lateSource.id, "post")).status).toBe(200);
    const afterSourcePost = await rows(sql`select "landedAmount" from "PurchaseBillLine" where "purchaseBillId" = ${goods.id} order by "lineNumber"`);
    expect(afterSourcePost.map((l) => Number(l.landedAmount).toFixed(2))).toEqual(["1301.51", "623.49"]);
    const loaded = await call("GET", `${api("import-assessments")}/${assessmentId}?companyId=${W.co}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.document.preview.lines.map((l: any) => Number(l.landedValue).toFixed(2))).toEqual(["1433.63", "671.37"]);
  });
});
