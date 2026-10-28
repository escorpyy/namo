import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// ERP-024 (part 1): an audit trail written by the DATABASE, not by callers.
// Every INSERT / UPDATE / DELETE on the financial tables below is copied into "AuditLog" with the company, the user
// (taken from the per-transaction setting namo.actor_user_id), an optional reason (namo.change_reason), and the old and
// new row. The log can only be added to. Decisions: S9 (editing allowed in an open period, so every change is traceable)
// and S11 (AuditLog gets a companyId). Most tests run inside a transaction that is rolled back, so nothing is left behind.
describe.skipIf(!DB_READY)("audit trail (database level)", () => {
  let db: any;
  let svc: typeof import("../server/services/purchase");
  class Rollback extends Error {}
  const NOW = sql`now()`;

  // CompanyLock (ERP-025) carries a trigger of the same name, but its own function (namo.audit_company_lock): the log must not hold the hash.
  const AUDITED = [
    "CashBankVoucher", "CashBankVoucherLine", "CompanyLock", "JournalVoucher", "JournalVoucherLine", "OpeningBalance",
    "PurchaseBill", "PurchaseBillImportDetail", "PurchaseBillLine", "PurchaseDocumentTerm", "PurchaseDocumentTermAllocation",
  ];

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

  type Fx = { tag: string; user: number; user2: number; co: number; br: number; fy: number; vendor: number; purchase: number; rent: number; cash: number; product: number };

  async function fixture(tx: any): Promise<Fx> {
    const tag = uniq();
    const c = (s: string) => `${s}${tag}`.slice(0, 20);
    const user = await ins(tx, "User", { name: `Audit ${tag}`, email: `a1${tag}@test.local` });
    const user2 = await ins(tx, "User", { name: `Audit2 ${tag}`, email: `a2${tag}@test.local` });
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
    return { tag, user, user2, co, br, fy, vendor, purchase, rent, cash, product };
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

  // The statement must be refused by the database; returns the Postgres error (code + message).
  const refused = async (tx: any, fn: () => Promise<unknown>) => {
    let err: any;
    try { await tx.transaction(async () => { await fn(); }); } catch (e) { err = e; }
    expect(err, "statement should have been refused").toBeDefined();
    return (err.cause ?? err) as { code: string; message: string };
  };

  // Who is acting and why, for the rest of this transaction (what the application does through server/db/audit.ts).
  const acting = (tx: any, userId: number | null, reason = "") =>
    tx.execute(sql`select set_config('namo.actor_user_id', ${userId == null ? "" : String(userId)}, true), set_config('namo.change_reason', ${reason}, true)`);

  const voucher = (tx: any, f: Fx, n = "1") =>
    ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `J${n}${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
  const jline = (tx: any, v: number, n: number, gl: number, debit: string, credit: string) =>
    ins(tx, "JournalVoucherLine", { journalVoucherId: v, lineNumber: n, generalLedgerId: gl, debit, credit });
  const logOf = (tx: any, table: string, id: number) =>
    rows(tx, sql`select "tableName", "recordId", "action", "oldData", "newData", "changedBy", "reason", "companyId", "changedAt" from "AuditLog" where "tableName" = ${table} and "recordId" = ${String(id)} order by id`);

  // ---------------------------------------------------------------------------------------------------------------
  describe("what the database promises (catalog)", () => {
    it("AuditLog has a required companyId and a reason, and companyId is not a foreign key (history outlives a company)", async () => {
      const cols = await rows(db, sql`select column_name as c, is_nullable as n from information_schema.columns where table_schema = 'public' and table_name = 'AuditLog'`);
      const by = Object.fromEntries(cols.map((r) => [r.c, r.n]));
      expect(by.companyId, "companyId column").toBe("NO");
      expect(by.reason, "reason column").toBe("YES");
      const fks = await rows(db, sql`
        select a.attname as col from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = 'f' and c.conrelid = '"AuditLog"'::regclass`);
      expect(fks.map((r) => r.col)).toEqual(["changedBy"]);
    });

    it("a user with audit history cannot be deleted: the changedBy foreign key no longer sets null", async () => {
      const [r] = await rows(db, sql`select confdeltype as t from pg_constraint where conname = 'AuditLog_changedBy_User_id_fk'`);
      expect(r.t, "r = restrict (n would be set null)").toBe("r");
    });

    it("exactly the planned financial tables carry the audit trigger", async () => {
      const t = await rows(db, sql`select c.relname as t from pg_trigger g join pg_class c on c.oid = g.tgrelid where g.tgname = 'Audit_trail' and not g.tgisinternal order by 1`);
      expect(t.map((r) => r.t)).toEqual([...AUDITED].sort());
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("every change is copied into the log", () => {
    it("INSERT: new row, no old row, the company, the user and the reason", async () => {
      await run(async (tx, f) => {
        await acting(tx, f.user, "opening entry");
        const v = await voucher(tx, f);
        const log = await logOf(tx, "JournalVoucher", v);
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ tableName: "JournalVoucher", recordId: String(v), action: "INSERT", oldData: null, changedBy: f.user, reason: "opening entry", companyId: f.co });
        expect(log[0].newData).toMatchObject({ id: v, companyId: f.co, voucherNumber: `J1${f.tag}`.slice(0, 20) });
        expect(log[0].changedAt).toBeTruthy();
      });
    });

    it("UPDATE: old row and new row", async () => {
      await run(async (tx, f) => {
        await acting(tx, f.user);
        const v = await voucher(tx, f);
        await acting(tx, f.user2, "typo in remarks");
        await tx.execute(sql`update "JournalVoucher" set "remarks" = 'rent for Kartik' where id = ${v}`);
        const log = await logOf(tx, "JournalVoucher", v);
        expect(log.map((r) => r.action)).toEqual(["INSERT", "UPDATE"]);
        expect(log[1].oldData.remarks).toBeNull();
        expect(log[1].newData.remarks).toBe("rent for Kartik");
        expect(log[1]).toMatchObject({ changedBy: f.user2, reason: "typo in remarks", companyId: f.co });
        expect(log[0].changedBy, "the first entry keeps its own user").toBe(f.user);
      });
    });

    it("DELETE: the old row is kept, no new row", async () => {
      await run(async (tx, f) => {
        const v = await voucher(tx, f);
        await acting(tx, f.user, "entered twice");
        await tx.execute(sql`delete from "JournalVoucher" where id = ${v}`);
        const log = await logOf(tx, "JournalVoucher", v);
        expect(log.map((r) => r.action)).toEqual(["INSERT", "DELETE"]);
        expect(log[1].newData).toBeNull();
        expect(log[1].oldData).toMatchObject({ id: v, voucherNumber: `J1${f.tag}`.slice(0, 20) });
        expect(log[1]).toMatchObject({ changedBy: f.user, reason: "entered twice", companyId: f.co });
      });
    });

    it("an UPDATE that changes nothing writes nothing", async () => {
      await run(async (tx, f) => {
        const v = await voucher(tx, f);
        await tx.execute(sql`update "JournalVoucher" set "remarks" = "remarks" where id = ${v}`);
        expect((await logOf(tx, "JournalVoucher", v)).map((r) => r.action)).toEqual(["INSERT"]);
      });
    });

    it("no user and no reason set: both are recorded as empty, never as a leftover", async () => {
      await run(async (tx, f) => {
        const v = await voucher(tx, f);
        const [e] = await logOf(tx, "JournalVoucher", v);
        expect(e.changedBy).toBeNull();
        expect(e.reason).toBeNull();
      });
    });

    it("a blank reason is stored as empty", async () => {
      await run(async (tx, f) => {
        await acting(tx, f.user, "   ");
        const v = await voucher(tx, f);
        expect((await logOf(tx, "JournalVoucher", v))[0].reason).toBeNull();
      });
    });

    it("a user setting that is not a user id is refused instead of being guessed", async () => {
      await run(async (tx, f) => {
        await tx.execute(sql`select set_config('namo.actor_user_id', 'abc', true)`);
        const e = await refused(tx, () => voucher(tx, f));
        expect(e.message).toMatch(/namo\.actor_user_id/);
      });
    });

    it("an unknown user id is refused by the changedBy foreign key (same as createdBy columns)", async () => {
      await run(async (tx, f) => {
        await acting(tx, 2_000_000_000);
        const e = await refused(tx, () => voucher(tx, f));
        expect(e.code).toBe("23503");
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("the company of every entry", () => {
    it("lines take the company of their voucher (journal and cash/bank)", async () => {
      await run(async (tx, f) => {
        const v = await voucher(tx, f);
        const l = await jline(tx, v, 1, f.rent, "100", "0");
        const cv = await ins(tx, "CashBankVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `C${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
        const cl = await ins(tx, "CashBankVoucherLine", { cashBankVoucherId: cv, lineNumber: 1, generalLedgerId: f.cash, debit: "0", credit: "100" });
        for (const [t, id] of [["JournalVoucherLine", l], ["CashBankVoucher", cv], ["CashBankVoucherLine", cl]] as const) {
          const log = await logOf(tx, t, id);
          expect(log, t).toHaveLength(1);
          expect(log[0].companyId, t).toBe(f.co);
        }
      });
    });

    it("lines removed together with their voucher (cascade) are logged with the company too", async () => {
      await run(async (tx, f) => {
        const v = await voucher(tx, f);
        const l1 = await jline(tx, v, 1, f.rent, "100", "0");
        const l2 = await jline(tx, v, 2, f.cash, "0", "100");
        await acting(tx, f.user, "wrong voucher");
        await tx.execute(sql`delete from "JournalVoucher" where id = ${v}`); // the database removes the lines with it
        for (const id of [l1, l2]) {
          const log = await logOf(tx, "JournalVoucherLine", id);
          expect(log.map((r) => r.action), `line ${id}`).toEqual(["INSERT", "DELETE"]);
          expect(log[1], `line ${id}`).toMatchObject({ companyId: f.co, changedBy: f.user, reason: "wrong voucher" });
        }
      });
    });

    it("opening balances: insert, edit and delete are logged against their company", async () => {
      await run(async (tx, f) => {
        await acting(tx, f.user);
        const ob = await ins(tx, "OpeningBalance", { companyId: f.co, branchId: f.br, fiscalYearId: f.fy, generalLedgerId: f.rent, updatedAt: NOW });
        await tx.execute(sql`update "OpeningBalance" set "debit" = 500 where id = ${ob}`);
        await tx.execute(sql`delete from "OpeningBalance" where id = ${ob}`);
        const log = await logOf(tx, "OpeningBalance", ob);
        expect(log.map((r) => r.action)).toEqual(["INSERT", "UPDATE", "DELETE"]);
        expect(log.every((r) => r.companyId === f.co && r.changedBy === f.user)).toBe(true);
        expect(Number(log[1].oldData.debit)).toBe(0);
        expect(Number(log[1].newData.debit)).toBe(500);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("purchase documents written through the service (the user travels with the call)", () => {
    const billIn = (f: Fx) => ({ companyId: f.co, branchId: f.br, invoiceDate: "2025-10-14", vendorGLId: f.vendor, lines: [{ productId: f.product, qty: 10, rate: 100 }] });
    // The service writes a bill in several steps (insert, then totals, then the posting itself), so a bill has more than one
    // entry per call. What matters: everything one call wrote carries that call's user, and the user changes exactly once.
    const changeover = (log: any[], from: number | null, to: number | null) => {
      const users = log.map((r) => r.changedBy);
      expect(users[0], "first entry").toBe(from);
      expect(users[users.length - 1], "last entry").toBe(to);
      expect(users.filter((u, i) => i > 0 && u !== users[i - 1]).length, `users in order: ${users.join(",")}`).toBe(1);
    };
    const forCompany = (tx: any, f: Fx) => rows(tx, sql`select "tableName", "action", "changedBy", "companyId", "newData" from "AuditLog" where "companyId" = ${f.co} order by id`);

    it("save, post and reverse a bill: bill, lines, voucher and voucher lines are all logged with the user who did it", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        const p = await svc.postPurchaseBill(s.id, { userId: f.user2 }, { tx });
        const after = await forCompany(tx, f);
        const seen = new Set(after.map((r) => r.tableName));
        for (const t of ["PurchaseBill", "PurchaseBillLine", "JournalVoucher", "JournalVoucherLine"]) expect(seen.has(t), t).toBe(true);
        expect(after.every((r) => r.companyId === f.co)).toBe(true);

        const billLog = await logOf(tx, "PurchaseBill", s.id);
        expect(billLog[0].action).toBe("INSERT");
        changeover(billLog, f.user, f.user2); // saved by one user, posted by another
        const posting = billLog[billLog.length - 1];
        expect(posting.action).toBe("UPDATE");
        expect(posting.oldData.isPosted).toBe(false);
        expect(posting.newData.isPosted).toBe(true);
        expect((await logOf(tx, "JournalVoucher", p.journalVoucherId))[0].changedBy).toBe(f.user2);
        const voucherLines = after.filter((r) => r.tableName === "JournalVoucherLine");
        expect(voucherLines.length).toBeGreaterThanOrEqual(2);
        expect(voucherLines.every((r) => r.changedBy === f.user2)).toBe(true);

        const before = after.length;
        const rev = await svc.reversePurchaseBill(s.id, { userId: f.user }, { tx, date: "2025-10-20" });
        const added = (await forCompany(tx, f)).slice(before);
        expect(added.length).toBeGreaterThan(0);
        expect(added.every((r) => r.changedBy === f.user && r.companyId === f.co)).toBe(true);
        expect((await logOf(tx, "PurchaseBill", rev.reversalBillId))[0].action).toBe("INSERT");
        expect((await logOf(tx, "JournalVoucher", rev.reversalVoucherId))[0].action).toBe("INSERT");
      });
    });

    it("the reason given when reversing a bill is stored on every entry that reversal wrote", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        await svc.postPurchaseBill(s.id, { userId: f.user }, { tx });
        const before = (await forCompany(tx, f)).length;
        const rev = await svc.reversePurchaseBill(s.id, { userId: f.user2 }, { tx, date: "2025-10-20", reason: "wrong vendor" });
        const mine = await rows(tx, sql`select "tableName", "reason", "changedBy" from "AuditLog" where "companyId" = ${f.co} order by id offset ${before}`);
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.every((r) => r.reason === "wrong vendor" && r.changedBy === f.user2), JSON.stringify(mine)).toBe(true);
        expect((await logOf(tx, "PurchaseBill", rev.reversalBillId))[0].reason).toBe("wrong vendor");
        // the reason belongs to that call only: the next call without one is logged without one
        const s2 = await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        expect((await logOf(tx, "PurchaseBill", s2.id))[0].reason).toBeNull();
      });
    });

    it("after a service call returns, the caller's own user and reason are back (nothing leaks into later writes of the same transaction)", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        await svc.postPurchaseBill(s.id, { userId: f.user }, { tx });
        // 1) the caller set nothing: a later raw write is logged with no user and no reason
        await svc.reversePurchaseBill(s.id, { userId: f.user2 }, { tx, date: "2025-10-20", reason: "wrong vendor" });
        const v = await voucher(tx, f);
        const [e] = await logOf(tx, "JournalVoucher", v);
        expect(e.changedBy).toBeNull();
        expect(e.reason).toBeNull();
        // 2) ... and the reason of that call does not open a posted document for editing
        const [{ id: postedVoucher }] = await rows(tx, sql`select "journalVoucherId" as id from "PurchaseBill" where id = ${s.id}`);
        await refused(tx, () => tx.execute(sql`update "JournalVoucher" set remarks = 'sneaky' where id = ${postedVoucher}`));
        // 3) the caller set something of its own: it is restored, not cleared
        await acting(tx, f.user2, "outer reason");
        await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        const [s3] = await rows(tx, sql`select current_setting('namo.actor_user_id', true) as u, current_setting('namo.change_reason', true) as r`);
        expect(s3).toEqual({ u: String(f.user2), r: "outer reason" });
      });
    });

    it("a call made without a user is logged without one: the previous user does not linger", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        await svc.postPurchaseBill(s.id, { userId: null }, { tx });
        changeover(await logOf(tx, "PurchaseBill", s.id), f.user, null);
      });
    });

    it("deleting a draft bill logs the bill and its lines", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        const [line] = await rows(tx, sql`select id from "PurchaseBillLine" where "purchaseBillId" = ${s.id}`);
        await svc.deletePurchaseBill(s.id, { userId: f.user2 }, { tx });
        for (const [t, id] of [["PurchaseBill", s.id], ["PurchaseBillLine", line.id]] as const) {
          const log = await logOf(tx, t, id);
          expect(log[0].action, t).toBe("INSERT");
          expect(log[log.length - 1].action, t).toBe("DELETE");
          changeover(log, f.user, f.user2);
          expect(log.every((r) => r.companyId === f.co), t).toBe(true);
        }
      });
    });

    it("lines removed together with their bill (cascade) keep their company", async () => {
      await run(async (tx, f) => {
        const s = await svc.savePurchaseBill(billIn(f), { userId: f.user }, { tx });
        const [line] = await rows(tx, sql`select id from "PurchaseBillLine" where "purchaseBillId" = ${s.id}`);
        await acting(tx, f.user2, "cleanup");
        await tx.execute(sql`delete from "PurchaseBill" where id = ${s.id}`);
        const ll = await logOf(tx, "PurchaseBillLine", line.id);
        expect(ll[ll.length - 1]).toMatchObject({ action: "DELETE", companyId: f.co, changedBy: f.user2, reason: "cleanup" });
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  describe("the log can only be added to", () => {
    const anEntry = async (tx: any, f: Fx) => {
      const v = await voucher(tx, f);
      return (await rows(tx, sql`select id from "AuditLog" where "tableName" = 'JournalVoucher' and "recordId" = ${String(v)}`))[0].id as string;
    };

    it("an entry cannot be edited", async () => {
      await run(async (tx, f) => {
        const id = await anEntry(tx, f);
        for (const stmt of [sql`update "AuditLog" set "reason" = 'tidy' where id = ${id}`, sql`update "AuditLog" set "newData" = null where id = ${id}`, sql`update "AuditLog" set "companyId" = 1 where id = ${id}`]) {
          const e = await refused(tx, () => tx.execute(stmt));
          expect(e.code).toBe("23514");
          expect(e.message).toMatch(/audit log/i);
        }
      });
    });

    it("an entry cannot be deleted, one at a time or all together", async () => {
      await run(async (tx, f) => {
        const id = await anEntry(tx, f);
        const one = await refused(tx, () => tx.execute(sql`delete from "AuditLog" where id = ${id}`));
        expect(one.code).toBe("23514");
        const all = await refused(tx, () => tx.execute(sql`truncate "AuditLog"`));
        expect(all.code).toBe("23514");
        expect(all.message).toMatch(/audit log/i);
        expect((await rows(tx, sql`select id from "AuditLog" where id = ${id}`)).length).toBe(1);
      });
    });

    it("an entry cannot be forged by inserting it directly, complete or not (only the audit trigger writes the log)", async () => {
      await run(async (tx, f) => {
        const complete = await refused(tx, () => tx.execute(sql`insert into "AuditLog" ("companyId", "tableName", "recordId", "action", "changedBy", "reason") values (${f.co}, 'JournalVoucher', '1', 'DELETE', ${f.user}, 'made up')`));
        expect(complete.code).toBe("23514");
        expect(complete.message).toMatch(/audit log/i);
        const partial = await refused(tx, () => tx.execute(sql`insert into "AuditLog" ("tableName", "recordId", "action") values ('JournalVoucher', '1', 'INSERT')`));
        expect(partial.code).toBe("23514");
        expect((await rows(tx, sql`select id from "AuditLog" where "reason" = 'made up'`)).length).toBe(0);
      });
    });

    it("a user who appears in the log cannot be deleted; one who does not, can", async () => {
      await run(async (tx, f) => {
        await acting(tx, f.user);
        await voucher(tx, f);
        const e = await refused(tx, () => tx.execute(sql`delete from "User" where id = ${f.user}`));
        expect(e.code).toBe("23503");
        await tx.execute(sql`delete from "User" where id = ${f.user2}`);
        expect((await rows(tx, sql`select id from "User" where id = ${f.user2}`)).length).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------
  // The Opening Balance route is not a service: it takes userId from the request. It is committed here (a throw-away,
  // inactive company, so no other test sees it) because the route uses its own connection, not a test transaction.
  describe("Opening Balance route (API) records the user", () => {
    let call: (m: string, p: string, b?: unknown) => Promise<Res>;
    let close: () => Promise<void>;
    let co = 0, br = 0, fy = 0, gl = 0, grp = 0, sg = 0, actor = 0;
    const tag = uniq();
    const c = (s: string) => `${s}${tag}`.slice(0, 20);

    beforeAll(async () => {
      ({ call, close } = await startApi());
      actor = ((await call("GET", "/api/context")).body.user.id as number);
      co = await ins(db, "Company", { code: c("AO"), name: `Audit OB ${tag}`, isActive: false, updatedAt: NOW });
      br = await ins(db, "Branch", { companyId: co, code: c("B"), name: "Branch", updatedAt: NOW });
      fy = await ins(db, "FiscalYear", { companyId: co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", updatedAt: NOW });
      grp = await ins(db, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "ASSET", updatedAt: NOW });
      sg = await ins(db, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
      gl = await ins(db, "GeneralLedger", { companyId: co, code: c("L"), name: "Cash", accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW });
    });
    afterAll(async () => {
      await db.execute(sql`delete from "OpeningBalance" where "companyId" = ${co}`);
      await db.execute(sql`delete from "GeneralLedger" where "companyId" = ${co}`);
      await db.execute(sql`delete from "AccountSubGroup" where id = ${sg}`);
      await db.execute(sql`delete from "AccountGroup" where id = ${grp}`);
      await db.execute(sql`delete from "FiscalYear" where id = ${fy}`);
      await db.execute(sql`delete from "Branch" where id = ${br}`);
      await db.execute(sql`delete from "Company" where id = ${co}`);
      await close();
    });

    const put = (debit: string, extra: Record<string, unknown> = {}) =>
      call("PUT", "/api/opening-balance", { companyId: co, branchId: br, fiscalYearId: fy, items: [{ generalLedgerId: gl, debit, credit: "0" }], ...extra });
    const log = () => rows(db, sql`select "action", "changedBy", "companyId", "newData" from "AuditLog" where "tableName" = 'OpeningBalance' and "companyId" = ${co} order by id`);

    it("an unknown or inactive user is refused (400) and nothing is saved or logged", async () => {
      const inactive = await ins(db, "User", { name: `Gone ${tag}`, email: `gone${tag}@test.local`, isActive: false });
      const before = (await log()).length;
      for (const bad of [inactive, 2_000_000_000]) {
        const r = await put("77", { userId: bad });
        expect(r.status, String(bad)).toBe(400);
        expect(r.body.message).toMatch(/user/i);
      }
      expect((await rows(db, sql`select id from "OpeningBalance" where "companyId" = ${co}`)).length).toBe(0);
      expect((await log()).length).toBe(before);
      const lock = await call("POST", "/api/opening-balance/lock", { companyId: co, fiscalYearId: fy, userId: inactive });
      expect(lock.status).toBe(400);
      await db.execute(sql`delete from "User" where id = ${inactive}`);
    });

    it("save, edit and clear are logged with the user sent by the screen, and without one when none is sent", async () => {
      expect((await put("10", { userId: actor })).status).toBe(200);
      expect((await put("20", { userId: actor })).status).toBe(200);
      expect((await put("30")).status).toBe(200); // no userId in the request
      expect((await put("0", { userId: actor })).status).toBe(200); // zero removes the row
      const l = await log();
      expect(l.map((r) => [r.action, r.changedBy])).toEqual([["INSERT", actor], ["UPDATE", actor], ["UPDATE", null], ["DELETE", actor]]);
      expect(l.every((r) => r.companyId === co)).toBe(true);
    });
  });
});
