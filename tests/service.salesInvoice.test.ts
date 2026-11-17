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
    const code = (s: string) => `${s}${tag}`.slice(0, 20);
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
    return { companyId, branchId, customerGLId, salesGLId, taxGLId, productId, unitId, termId };
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
});
