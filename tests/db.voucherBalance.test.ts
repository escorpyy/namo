import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

describe.skipIf(!DB_READY)("ERP-016: posted vouchers must balance in PostgreSQL", () => {
  let db: any;
  class Rollback extends Error {}
  const NOW = sql`now()`;

  beforeAll(async () => { ({ db } = await import("../server/db")); });

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };

  const run = async (body: (tx: any, fx: any) => Promise<void>) => {
    try {
      await db.transaction(async (tx: any) => {
        const tag = uniq();
        const co = await ins(tx, "Company", { code: "T" + tag, name: "Test " + tag, updatedAt: NOW });
        const br = await ins(tx, "Branch", { companyId: co, code: "B" + tag, name: "Branch " + tag, updatedAt: NOW });
        const grp = await ins(tx, "AccountGroup", { companyId: co, code: "G" + tag, description: "Group", type: "ASSET", updatedAt: NOW });
        const sg = await ins(tx, "AccountSubGroup", { code: "S" + tag, description: "Sub", accountGroupId: grp, updatedAt: NOW });
        const debitGL = await ins(tx, "GeneralLedger", { companyId: co, code: "D" + tag, name: "Debit", accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW });
        const creditGL = await ins(tx, "GeneralLedger", { companyId: co, code: "C" + tag, name: "Credit", accountSubGroupId: sg, normalBalance: "CREDIT", updatedAt: NOW });
        await body(tx, { co, br, debitGL, creditGL, tag });
        throw new Rollback();
      });
    } catch (e) { if (!(e instanceof Rollback)) throw e; }
  };

  const voucher = (tx: any, fx: any, kind: "journal" | "cash" = "journal", posted = false) =>
    ins(tx, kind === "journal" ? "JournalVoucher" : "CashBankVoucher", {
      companyId: fx.co, branchId: fx.br, voucherNumber: kind.toUpperCase() + fx.tag,
      voucherDate: "2025-08-01", fiscalYear: "2082/83", isPosted: posted, updatedAt: NOW,
    });

  const line = (tx: any, id: number, gl: number, debit: string, credit: string, kind: "journal" | "cash" = "journal") =>
    ins(tx, kind === "journal" ? "JournalVoucherLine" : "CashBankVoucherLine", {
      [kind === "journal" ? "journalVoucherId" : "cashBankVoucherId"]: id,
      lineNumber: Math.floor(Math.random() * 1000000) + 1,
      generalLedgerId: gl, debit, credit,
    });

  const forceChecks = (tx: any) => tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
  const rejected = async (tx: any, body: () => Promise<void>) => {
    let err: any;
    try { await tx.transaction(async (sp: any) => { await body(); await forceChecks(sp); }); } catch (e) { err = e; }
    expect(err, "PostgreSQL must reject the invalid posted voucher").toBeDefined();
    const cause = err.cause ?? err;
    expect(cause.code, cause.message).toBe("23514");
    expect(cause.message).toMatch(/posted_voucher_balanced|equal positive debit and credit/i);
  };

  it("accepts a balanced journal voucher assembled across statements", async () => run(async (tx, fx) => {
    const id = await voucher(tx, fx);
    await line(tx, id, fx.debitGL, "125.500000", "0");
    await line(tx, id, fx.creditGL, "0", "125.500000");
    await tx.execute(sql`update "JournalVoucher" set "isPosted" = true where id = ${id}`);
    await forceChecks(tx);
  }));

  it("rejects an unbalanced journal voucher at deferred-check time", async () => run(async (tx, fx) => rejected(tx, async () => {
    const id = await voucher(tx, fx);
    await line(tx, id, fx.debitGL, "100", "0");
    await line(tx, id, fx.creditGL, "0", "99");
    await tx.execute(sql`update "JournalVoucher" set "isPosted" = true where id = ${id}`);
  })));

  it("rejects an unbalanced cash/bank voucher", async () => run(async (tx, fx) => rejected(tx, async () => {
    const id = await voucher(tx, fx, "cash");
    await line(tx, id, fx.debitGL, "10", "0", "cash");
    await line(tx, id, fx.creditGL, "0", "9", "cash");
    await tx.execute(sql`update "CashBankVoucher" set "isPosted" = true where id = ${id}`);
  })));

  it("rejects edits that leave an already-posted journal voucher unbalanced", async () => run(async (tx, fx) => {
    const id = await voucher(tx, fx);
    const debitLine = await line(tx, id, fx.debitGL, "20", "0");
    await line(tx, id, fx.creditGL, "0", "20");
    await tx.execute(sql`update "JournalVoucher" set "isPosted" = true where id = ${id}`);
    await rejected(tx, async () => { await tx.execute(sql`update "JournalVoucherLine" set debit = 21 where id = ${debitLine}`); });
  }));

  it("allows incomplete, unposted drafts", async () => run(async (tx, fx) => {
    const id = await voucher(tx, fx);
    await line(tx, id, fx.debitGL, "20", "0");
    await forceChecks(tx);
  }));

  it("rejects negative amounts and a line with both debit and credit", async () => run(async (tx, fx) => {
    const id = await voucher(tx, fx);
    let negative: any;
    try { await line(tx, id, fx.debitGL, "-1", "0"); } catch (e) { negative = e; }
    expect(negative).toBeDefined();
    let both: any;
    try { await line(tx, id, fx.debitGL, "1", "1"); } catch (e) { both = e; }
    expect(both).toBeDefined();
  }));

  it("applies the line amount rule to cash/bank vouchers too", async () => run(async (tx, fx) => {
    const id = await voucher(tx, fx, "cash");
    let err: any;
    try { await line(tx, id, fx.debitGL, "0", "-1", "cash"); } catch (e) { err = e; }
    expect(err).toBeDefined();
  }));
});
