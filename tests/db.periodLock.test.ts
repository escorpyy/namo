import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withInitialPostedChildInsert } from "../server/db/audit";
import { DB_READY, uniq } from "./helpers";

// ERP-025: the company lock (closing) date, enforced by the database (migration 0011). A document dated ON OR BEFORE the lock date
// cannot be created, edited or deleted, unless the transaction carries the override (namo.lock_override_company = this company, set by the
// application after it checked the lock password) AND a non-blank reason. Every test runs in a transaction that is rolled back.
describe.skipIf(!DB_READY)("company lock date (database level)", () => {
  let db: any;
  class Rollback extends Error {}
  const NOW = sql`now()`;
  const COVERED = ["CashBankVoucher", "CashBankVoucherLine", "JournalVoucher", "JournalVoucherLine", "PurchaseBill", "PurchaseBillImportDetail", "PurchaseBillLine", "PurchaseDocumentTerm", "PurchaseDocumentTermAllocation"];
  const LOCK = "2025-09-01"; // documents dated 2025-09-01 or earlier are locked

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
  });

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };
  const rows = async (tx: any, query: any) => (await tx.execute(query)) as any[];

  type Fx = { tag: string; user: number; co: number; br: number; vendor: number; purchase: number; rent: number; product: number; pcs: number; co2: number; br2: number };
  async function fixture(tx: any): Promise<Fx> {
    const tag = uniq();
    const c = (s: string) => `${s}${tag}`.slice(0, 20);
    const user = await ins(tx, "User", { name: `Lock ${tag}`, email: `l${tag}@test.local` });
    const co = await ins(tx, "Company", { code: c("T"), name: `Test ${tag}`, updatedAt: NOW });
    const br = await ins(tx, "Branch", { companyId: co, code: c("B"), name: `Branch ${tag}`, updatedAt: NOW });
    await ins(tx, "FiscalYear", { companyId: co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const co2 = await ins(tx, "Company", { code: c("U"), name: `Other ${tag}`, updatedAt: NOW });
    const br2 = await ins(tx, "Branch", { companyId: co2, code: c("C"), name: `Branch2 ${tag}`, updatedAt: NOW });
    const grp = await ins(tx, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "EXPENSE", updatedAt: NOW });
    const sg = await ins(tx, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, normal = "DEBIT") => ins(tx, "GeneralLedger", { companyId: co, code: c(code), name: code, accountSubGroupId: sg, normalBalance: normal, updatedAt: NOW });
    const vendor = await gl("VEND", "CREDIT"), purchase = await gl("PURCH"), rent = await gl("RENT");
    const pcs = await ins(tx, "ProductUnit", { companyId: co, code: c("PCS"), name: "Pcs", updatedAt: NOW });
    const pg = await ins(tx, "ProductGroup", { companyId: co, code: c("PG"), name: "PG", updatedAt: NOW });
    const psg = await ins(tx, "ProductSubGroup", { code: c("PSG"), name: "PSG", productGroupId: pg, updatedAt: NOW });
    const product = await ins(tx, "Product", { companyId: co, code: c("RICE"), description: "Rice", type: "STOCK", productSubGroupId: psg, updatedAt: NOW });
    await ins(tx, "StockDetail", { productId: product, baseUnitId: pcs, purchaseGLId: purchase, updatedAt: NOW });
    return { tag, user, co, br, vendor, purchase, rent, product, pcs, co2, br2 };
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

  const lockCompany = (tx: any, co: number, date: string | null = LOCK) =>
    ins(tx, "CompanyLock", { companyId: co, lockDate: date, passwordHash: "scrypt$test$hash", updatedAt: NOW });
  // The error of a statement the database must refuse (inside a savepoint so the outer transaction survives).
  const refusedWith = async (tx: any, fn: () => Promise<unknown>, message: RegExp) => {
    let err: any;
    try { await tx.transaction(async () => { await fn(); }); } catch (e) { err = e; }
    expect(err, "statement should have been refused").toBeDefined();
    const cause = (err.cause ?? err) as { code: string; message: string };
    expect(cause.code, cause.message).toBe("23514");
    expect(cause.message).toMatch(message);
  };
  const LOCKED = /locked up to 2025-09-01/;
  const acting = (tx: any, userId: number | null, reason: string, overrideCo: number | null = null) =>
    tx.execute(sql`select set_config('namo.actor_user_id', ${userId == null ? "" : String(userId)}, true), set_config('namo.change_reason', ${reason}, true), set_config('namo.lock_override_company', ${overrideCo == null ? "" : String(overrideCo)}, true)`);

  const jv = (tx: any, f: Fx, date: string, posted = false, tagx = "") =>
    ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `J${tagx}${f.tag}`.slice(0, 20), voucherDate: date, fiscalYear: "2082/83", isPosted: posted, updatedAt: NOW });
  const jline = (tx: any, v: number, n: number, gl: number, debit: string, credit: string) =>
    withInitialPostedChildInsert(tx, "JournalVoucherLine", v, () => ins(tx, "JournalVoucherLine", { journalVoucherId: v, lineNumber: n, generalLedgerId: gl, debit, credit }));
  const bill = (tx: any, f: Fx, date: string, posted = false) =>
    ins(tx, "PurchaseBill", { companyId: f.co, branchId: f.br, invoiceNumber: `B${f.tag}`.slice(0, 20), invoiceDate: date, fiscalYear: "2082/83", vendorGLId: f.vendor, updatedAt: NOW, ...(posted ? {} : {}) });

  it("exactly the covered document tables carry the lock trigger (orders, challans, opening balances do not)", async () => {
    const t = await rows(db, sql`select c.relname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid where g.tgname = 'Audit_lock' and not g.tgisinternal order by 1`);
    expect(t.map((r) => r.t)).toEqual([...COVERED].sort());
  });

  describe("create / edit / delete around the lock date", () => {
    it("no lock row, or a lock row with no date: everything is allowed", async () => {
      await run(async (tx, f) => {
        await jv(tx, f, "2025-08-01", false, "a");
        await lockCompany(tx, f.co, null).catch(() => undefined);
      });
      await run(async (tx, f) => {
        await ins(tx, "CompanyLock", { companyId: f.co, updatedAt: NOW }); // no date, no password: allowed by the CHECK
        await jv(tx, f, "2025-08-01");
      });
    });

    it("a voucher dated before or ON the lock date cannot be created; the day after can", async () => {
      await run(async (tx, f) => {
        await lockCompany(tx, f.co);
        await refusedWith(tx, () => jv(tx, f, "2025-08-01", false, "a"), LOCKED);
        await refusedWith(tx, () => jv(tx, f, LOCK, false, "b"), LOCKED);
        await jv(tx, f, "2025-09-02", false, "c");
      });
    });

    it("the message names the lock date and says how to get through", async () => {
      await run(async (tx, f) => {
        await lockCompany(tx, f.co);
        await refusedWith(tx, () => jv(tx, f, "2025-08-01"), /lock password and a reason/);
      });
    });

    it("another company's lock does not affect this one", async () => {
      await run(async (tx, f) => {
        await lockCompany(tx, f.co2);
        await jv(tx, f, "2025-08-01");
      });
    });

    it("a DRAFT is covered too (not only posted documents)", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-09-10", false);
        await lockCompany(tx, f.co);
        await tx.execute(sql`update "JournalVoucher" set remarks = 'open period draft' where id = ${v}`); // dated after the lock: fine
        const old = await jv(tx, f, "2025-09-10", false, "x");
        await tx.execute(sql`update "CompanyLock" set "lockDate" = '2025-09-30' where "companyId" = ${f.co}`); // raising the date needs nothing
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'now locked' where id = ${old}`), /locked up to 2025-09-30/);
      });
    });

    it("editing or deleting a locked voucher is refused, even with a reason (the reason rule is not the lock)", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", true);
        await lockCompany(tx, f.co);
        await acting(tx, f.user, "fixing a typo");
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`), LOCKED);
        await refusedWith(tx, () => tx.execute(sql`delete from "JournalVoucher" where id = ${v}`), LOCKED);
      });
    });

    it("moving a voucher INTO or OUT OF the locked period is refused (old and new date are both checked)", async () => {
      await run(async (tx, f) => {
        const open = await jv(tx, f, "2025-10-01", false, "o");
        const locked = await jv(tx, f, "2025-08-01", false, "l");
        await lockCompany(tx, f.co);
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set "voucherDate" = '2025-08-15' where id = ${open}`), LOCKED);
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set "voucherDate" = '2025-10-15' where id = ${locked}`), LOCKED);
      });
    });

    it("an UPDATE that changes nothing is not a change", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", true);
        await lockCompany(tx, f.co);
        await tx.execute(sql`update "JournalVoucher" set remarks = remarks where id = ${v}`);
      });
    });

    it("lines are dated by their voucher: a line of a locked voucher cannot be added, changed or removed", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", false);
        const l = await jline(tx, v, 1, f.rent, "10", "0");
        const openV = await jv(tx, f, "2025-10-01", false, "o");
        await lockCompany(tx, f.co);
        await refusedWith(tx, () => jline(tx, v, 2, f.rent, "5", "0"), LOCKED);
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucherLine" set debit = 20 where id = ${l}`), LOCKED);
        await refusedWith(tx, () => tx.execute(sql`delete from "JournalVoucherLine" where id = ${l}`), LOCKED);
        // a line moved from the open voucher into the locked one is refused too
        const ol = await jline(tx, openV, 1, f.rent, "1", "0");
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucherLine" set "journalVoucherId" = ${v}, "lineNumber" = 9 where id = ${ol}`), LOCKED);
      });
    });

    it("cash/bank vouchers and purchase bills are covered the same way", async () => {
      await run(async (tx, f) => {
        await lockCompany(tx, f.co);
        await refusedWith(tx, () => ins(tx, "CashBankVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `C${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW }), LOCKED);
        await refusedWith(tx, () => bill(tx, f, "2025-08-01"), LOCKED);
        await bill(tx, f, "2025-09-02");
      });
    });

    it("a bill's own lines follow the bill's date", async () => {
      await run(async (tx, f) => {
        const b = await bill(tx, f, "2025-08-01");
        const lineVals = { purchaseBillId: b, lineNumber: 1, productId: f.product, qty: "1", unitId: f.pcs, rate: "10", basicAmount: "10" };
        const l = await ins(tx, "PurchaseBillLine", lineVals);
        await lockCompany(tx, f.co);
        await refusedWith(tx, () => ins(tx, "PurchaseBillLine", { ...lineVals, lineNumber: 2 }), LOCKED);
        await refusedWith(tx, () => tx.execute(sql`update "PurchaseBillLine" set qty = 2 where id = ${l}`), LOCKED);
        await refusedWith(tx, () => tx.execute(sql`delete from "PurchaseBill" where id = ${b}`), LOCKED);
      });
    });

    it("the landed-cost recalculation of a bill line is never refused (valuation only, same carve-out as migration 0009)", async () => {
      await run(async (tx, f) => {
        const b = await bill(tx, f, "2025-08-01");
        const l = await ins(tx, "PurchaseBillLine", { purchaseBillId: b, lineNumber: 1, productId: f.product, qty: "1", unitId: f.pcs, rate: "10", basicAmount: "10" });
        await lockCompany(tx, f.co);
        await tx.execute(sql`update "PurchaseBillLine" set "allocatedTermAmount" = 5, "landedAmount" = 15, "landedRate" = 15 where id = ${l}`);
        // ...but the same statement touching anything else is a change
        await refusedWith(tx, () => tx.execute(sql`update "PurchaseBillLine" set "landedAmount" = 16, rate = 11 where id = ${l}`), LOCKED);
      });
    });
  });

  describe("the override: lock password checked by the application, reason required, one transaction only", () => {
    it("with the override setting for THIS company and a reason, a locked voucher can be edited and deleted", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", true);
        await lockCompany(tx, f.co);
        await acting(tx, f.user, "owner approved a correction", f.co);
        await tx.execute(sql`update "JournalVoucher" set remarks = 'corrected' where id = ${v}`);
        await tx.execute(sql`delete from "JournalVoucher" where id = ${v}`);
      });
    });

    it("the override without a reason is refused, and a blank reason is no reason", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", false);
        await lockCompany(tx, f.co);
        await acting(tx, f.user, "", f.co);
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`), /reason is required/);
        await acting(tx, f.user, "   ", f.co);
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`), /reason is required/);
      });
    });

    it("an override granted for ANOTHER company does not open this one", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", false);
        await lockCompany(tx, f.co);
        await acting(tx, f.user, "some reason", f.co2);
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`), LOCKED);
      });
    });

    it("a reason alone (no override) does not open a locked period", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", false);
        await lockCompany(tx, f.co);
        await acting(tx, f.user, "a very good reason", null);
        await refusedWith(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`), LOCKED);
      });
    });

    it("a posted document in a locked period still needs its reason, so the override path is audit-logged with it", async () => {
      await run(async (tx, f) => {
        const v = await jv(tx, f, "2025-08-01", true);
        await lockCompany(tx, f.co);
        await acting(tx, f.user, "corrected the narration", f.co);
        await tx.execute(sql`update "JournalVoucher" set remarks = 'x' where id = ${v}`);
        const log = await rows(tx, sql`select "action", "reason", "changedBy", "lockOverride" from "AuditLog" where "tableName" = 'JournalVoucher' and "recordId" = ${String(v)} order by id`);
        expect(log.at(-1)).toMatchObject({ action: "UPDATE", reason: "corrected the narration", changedBy: f.user, lockOverride: true });
      });
    });

    it("lockOverride is false for ordinary changes, in a company with or without a lock", async () => {
      await run(async (tx, f) => {
        const early = await jv(tx, f, "2025-08-01", false, "e"); // before any lock exists
        const late = await jv(tx, f, "2025-10-01", false, "l");
        await lockCompany(tx, f.co);
        await tx.execute(sql`update "JournalVoucher" set remarks = 'after' where id = ${late}`);
        const log = await rows(tx, sql`select "tableName", "recordId", "lockOverride" from "AuditLog" where "tableName" = 'JournalVoucher' and "recordId" in (${String(early)}, ${String(late)})`);
        expect(log.length).toBe(3); // 2 inserts + 1 update
        expect(log.every((r) => r.lockOverride === false)).toBe(true);
      });
    });
  });

  describe("the lock settings themselves (CompanyLock)", () => {
    it("a lock date needs a password (CHECK)", async () => {
      await run(async (tx, f) => {
        await refusedWith(tx, () => ins(tx, "CompanyLock", { companyId: f.co, lockDate: LOCK, updatedAt: NOW }), /CompanyLock_date_needs_password_check|check constraint/i);
      });
    });

    it("one lock row per company, and the company can never change", async () => {
      await run(async (tx, f) => {
        const id = await lockCompany(tx, f.co);
        let err: any;
        try { await tx.transaction(async () => { await lockCompany(tx, f.co); }); } catch (e) { err = e; }
        expect((err?.cause ?? err)?.code).toBe("23505");
        await refusedWith(tx, () => tx.execute(sql`update "CompanyLock" set "companyId" = ${f.co2} where id = ${id}`), /company of a CompanyLock record cannot be changed/);
      });
    });

    it("raising the date or setting it the first time needs no override", async () => {
      await run(async (tx, f) => {
        await lockCompany(tx, f.co);
        await tx.execute(sql`update "CompanyLock" set "lockDate" = '2025-09-15' where "companyId" = ${f.co}`);
      });
    });

    it("lowering the date, clearing it, changing the password or deleting the row each need the override AND a reason", async () => {
      const attempts: [string, (co: number) => any][] = [
        ["lower", (co) => sql`update "CompanyLock" set "lockDate" = '2025-08-01' where "companyId" = ${co}`],
        ["clear", (co) => sql`update "CompanyLock" set "lockDate" = null where "companyId" = ${co}`],
        ["password", (co) => sql`update "CompanyLock" set "passwordHash" = 'scrypt$other$hash' where "companyId" = ${co}`],
        ["delete", (co) => sql`delete from "CompanyLock" where "companyId" = ${co}`],
      ];
      for (const [name, stmt] of attempts) {
        await run(async (tx, f) => {
          await lockCompany(tx, f.co);
          await acting(tx, f.user, "a reason", null);
          await refusedWith(tx, () => tx.execute(stmt(f.co)), /lock password is needed/);
          await acting(tx, f.user, "", f.co);
          await refusedWith(tx, () => tx.execute(stmt(f.co)), /reason is required/);
          await acting(tx, f.user, "year-end review finished", f.co);
          await tx.execute(stmt(f.co)); // allowed: the name of the attempt is in the failure message if this throws
          void name;
        });
      }
    });

    it("the audit entry for a lock change never contains the hash, says whether a password is set, and flags the override", async () => {
      await run(async (tx, f) => {
        await acting(tx, f.user, "first lock");
        const id = await lockCompany(tx, f.co);
        await acting(tx, f.user, "lowering after the audit", f.co);
        await tx.execute(sql`update "CompanyLock" set "lockDate" = '2025-08-01' where id = ${id}`);
        const log = await rows(tx, sql`select "action", "oldData", "newData", "reason", "lockOverride", "companyId" from "AuditLog" where "tableName" = 'CompanyLock' and "recordId" = ${String(id)} order by id`);
        expect(log.map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
        for (const r of log) {
          expect(JSON.stringify(r)).not.toMatch(/scrypt|passwordHash/);
          expect(r.companyId).toBe(f.co);
        }
        expect(log[0]).toMatchObject({ newData: expect.objectContaining({ passwordSet: true, passwordChanged: true, lockDate: LOCK }), lockOverride: false });
        expect(log[1]).toMatchObject({ oldData: expect.objectContaining({ lockDate: LOCK }), newData: expect.objectContaining({ lockDate: "2025-08-01", passwordSet: true }), reason: "lowering after the audit", lockOverride: true });
        expect(log[1].newData.passwordChanged).toBeUndefined();
      });
    });
  });
});
