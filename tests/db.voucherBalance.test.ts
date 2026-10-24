import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, uniq } from "./helpers";

// ERP-016: every voucher must balance (total debit = total credit), enforced by the database at commit time.
// Editing is allowed (decision S9), so an edit that rewrites the lines inside one transaction must pass; only the
// state at commit matters. The check is a deferred constraint trigger, so these tests force it to run early with
// SET CONSTRAINTS ALL IMMEDIATE (which behaves exactly like the commit-time check) and always roll back.
describe.skipIf(!DB_READY)("voucher balance Dr = Cr (database level)", () => {
  let db: any;
  let pgError: (e: unknown) => { code: string; message: string } | null;
  class Rollback extends Error {}
  const NOW = sql`now()`;

  beforeAll(async () => {
    ({ db } = await import("../server/db"));
    ({ pgError } = await import("../server/routes/_util"));
  });

  const ins = async (tx: any, table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const q = sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`;
    return (await tx.execute(q))[0].id as number;
  };

  type Fx = { co: number; br: number; rent: number; cash: number; tag: string };

  async function fixture(tx: any): Promise<Fx> {
    const tag = uniq();
    const c = (s: string) => `${s}${tag}`.slice(0, 20);
    const co = await ins(tx, "Company", { code: c("T"), name: `Test ${tag}`, updatedAt: NOW });
    const br = await ins(tx, "Branch", { companyId: co, code: c("B"), name: `Branch ${tag}`, updatedAt: NOW });
    const grp = await ins(tx, "AccountGroup", { companyId: co, code: c("G"), description: "Grp", type: "LIABILITY", updatedAt: NOW });
    const sg = await ins(tx, "AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const rent = await ins(tx, "GeneralLedger", { companyId: co, code: c("L1"), name: "Rent", accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW });
    const cash = await ins(tx, "GeneralLedger", { companyId: co, code: c("L2"), name: "Cash", accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW });
    return { co, br, rent, cash, tag };
  }

  const jv = (tx: any, f: Fx) =>
    ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `J${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
  const cbv = (tx: any, f: Fx) =>
    ins(tx, "CashBankVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `C${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
  const jline = (tx: any, voucher: number, n: number, gl: number, debit: string, credit: string) =>
    ins(tx, "JournalVoucherLine", { journalVoucherId: voucher, lineNumber: n, generalLedgerId: gl, debit, credit });
  const cline = (tx: any, voucher: number, n: number, gl: number, debit: string, credit: string) =>
    ins(tx, "CashBankVoucherLine", { cashBankVoucherId: voucher, lineNumber: n, generalLedgerId: gl, debit, credit });

  // Run a body inside a transaction that is always rolled back; the body decides when to run the commit-time check.
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
  // The same check the database makes at COMMIT. IMMEDIATE runs everything queued so far; switching back to DEFERRED
  // afterwards keeps later statements of the same transaction deferred, as they are in real use.
  const check = async (tx: any) => {
    await tx.execute(sql`set constraints all immediate`);
    await tx.execute(sql`set constraints all deferred`);
  };

  // The body must be refused by the database with SQLSTATE 23514 and a message that says the voucher is out of balance.
  const refused = async (body: (tx: any, f: Fx) => Promise<void>) => {
    let caught: unknown;
    try {
      await run(async (tx, f) => {
        await body(tx, f);
        await check(tx);
      });
    } catch (e) {
      caught = e;
    }
    const pg = pgError(caught);
    expect(pg, "expected a database error, got: " + String(caught)).not.toBeNull();
    expect(pg!.code).toBe("23514");
    expect(pg!.message).toMatch(/not balanced/i);
    return pg!;
  };

  const accepted = (body: (tx: any, f: Fx) => Promise<void>) =>
    run(async (tx, f) => {
      await body(tx, f);
      await check(tx);
    });

  describe("journal voucher", () => {
    it("accepts Dr 1000 Rent = Cr 1000 Cash", () =>
      accepted(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "1000", "0");
        await jline(tx, v, 2, f.cash, "0", "1000");
      }));

    it("refuses Dr 1000 against Cr 900 and says by how much, in words a person can read", async () => {
      const pg = await refused(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "1000", "0");
        await jline(tx, v, 2, f.cash, "0", "900");
      });
      expect(pg.message).toMatch(/1000/);
      expect(pg.message).toMatch(/900/);
    });

    it("accepts several debit lines against one credit line (Dr 600 + Dr 400 = Cr 1000)", () =>
      accepted(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "600", "0");
        await jline(tx, v, 2, f.rent, "400", "0");
        await jline(tx, v, 3, f.cash, "0", "1000");
      }));

    it("is exact to the paisa and beyond: Dr 0.10 + Dr 0.20 = Cr 0.30 passes, Dr 0.30 against Cr 0.299999 fails", async () => {
      await accepted(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "0.10", "0");
        await jline(tx, v, 2, f.rent, "0.20", "0");
        await jline(tx, v, 3, f.cash, "0", "0.30");
      });
      await refused(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "0.30", "0");
        await jline(tx, v, 2, f.cash, "0", "0.299999");
      });
    });

    it("accepts a voucher with no lines yet (a draft being built) and a voucher with a single 0 / 0 line", () =>
      accepted(async (tx, f) => {
        await jv(tx, f);
        const second = await ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `K${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
        await jline(tx, second, 1, f.rent, "0", "0");
      }));

    it("lets the lines be inserted in any order inside the transaction (debit side first is not an error)", () =>
      accepted(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "250", "0");
        // Nothing is checked until commit, so the voucher may be temporarily one-sided here.
        await jline(tx, v, 2, f.cash, "0", "250");
      }));

    it("refuses an edit that unbalances a balanced voucher (UPDATE one amount)", () =>
      refused(async (tx, f) => {
        const v = await jv(tx, f);
        const a = await jline(tx, v, 1, f.rent, "1000", "0");
        await jline(tx, v, 2, f.cash, "0", "1000");
        await check(tx); // balanced up to here
        await tx.execute(sql`update "JournalVoucherLine" set debit = '1100' where id = ${a}`);
      }));

    it("accepts an edit that changes both sides in one transaction (Dr 1000 / Cr 1000 -> Dr 1500 / Cr 1500)", () =>
      accepted(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "1000", "0");
        await jline(tx, v, 2, f.cash, "0", "1000");
        await check(tx);
        await tx.execute(sql`update "JournalVoucherLine" set debit = '1500' where "journalVoucherId" = ${v} and "lineNumber" = 1`);
        await tx.execute(sql`update "JournalVoucherLine" set credit = '1500' where "journalVoucherId" = ${v} and "lineNumber" = 2`);
      }));

    it("accepts an edit that deletes every line and inserts a new balanced set in one transaction (Dr 1000 / Cr 1000 -> Dr 70 + Dr 30 / Cr 100)", () =>
      accepted(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "1000", "0");
        await jline(tx, v, 2, f.cash, "0", "1000");
        await check(tx);
        await tx.execute(sql`delete from "JournalVoucherLine" where "journalVoucherId" = ${v}`);
        await jline(tx, v, 1, f.rent, "70", "0");
        await jline(tx, v, 2, f.rent, "30", "0");
        await jline(tx, v, 3, f.cash, "0", "100");
      }));

    it("refuses an edit that rewrites the lines into an unbalanced set (Dr 70 + Dr 30 against Cr 90)", () =>
      refused(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "1000", "0");
        await jline(tx, v, 2, f.cash, "0", "1000");
        await check(tx);
        await tx.execute(sql`delete from "JournalVoucherLine" where "journalVoucherId" = ${v}`);
        await jline(tx, v, 1, f.rent, "70", "0");
        await jline(tx, v, 2, f.rent, "30", "0");
        await jline(tx, v, 3, f.cash, "0", "90");
      }));

    it("refuses deleting one line of a balanced voucher", () =>
      refused(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "1000", "0");
        const b = await jline(tx, v, 2, f.cash, "0", "1000");
        await check(tx);
        await tx.execute(sql`delete from "JournalVoucherLine" where id = ${b}`);
      }));

    it("accepts deleting the whole voucher (its lines go with it)", () =>
      accepted(async (tx, f) => {
        const v = await jv(tx, f);
        await jline(tx, v, 1, f.rent, "1000", "0");
        await jline(tx, v, 2, f.cash, "0", "1000");
        await check(tx);
        await tx.execute(sql`delete from "JournalVoucher" where id = ${v}`);
      }));

    it("refuses moving a line to another voucher when that leaves BOTH vouchers out of balance", async () => {
      await refused(async (tx, f) => {
        const v1 = await jv(tx, f);
        const v2 = await ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `M${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
        const a = await jline(tx, v1, 1, f.rent, "500", "0");
        await jline(tx, v1, 2, f.cash, "0", "500");
        await jline(tx, v2, 1, f.rent, "200", "0");
        await jline(tx, v2, 2, f.cash, "0", "200");
        await check(tx);
        await tx.execute(sql`update "JournalVoucherLine" set "journalVoucherId" = ${v2}, "lineNumber" = 3 where id = ${a}`);
      });
    });

    it("checks the voucher a line LEFT as well as the one it joined (target ends balanced, source ends with a lone credit)", () =>
      refused(async (tx, f) => {
        const v1 = await jv(tx, f);
        const v2 = await ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `N${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
        const a = await jline(tx, v1, 1, f.rent, "500", "0");
        await jline(tx, v1, 2, f.cash, "0", "500");
        await check(tx); // v1 balanced, v2 has no lines yet: nothing is wrong at this point
        // Move the debit into v2 and give v2 a matching credit: v2 is now Dr 500 = Cr 500. v1 is left with Cr 500 alone.
        await tx.execute(sql`update "JournalVoucherLine" set "journalVoucherId" = ${v2}, "lineNumber" = 1 where id = ${a}`);
        await jline(tx, v2, 2, f.cash, "0", "500");
      }));

    it("checks the voucher a line JOINED: moving a debit in while the source is made whole again leaves only the target out of balance", () =>
      refused(async (tx, f) => {
        const v1 = await jv(tx, f);
        const v2 = await ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `O${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
        await jline(tx, v1, 1, f.rent, "500", "0");
        await jline(tx, v1, 2, f.cash, "0", "600");
        const moved = await jline(tx, v1, 3, f.rent, "100", "0");
        await jline(tx, v2, 1, f.rent, "200", "0");
        await jline(tx, v2, 2, f.cash, "0", "200");
        await check(tx); // v1: Dr 600 = Cr 600, v2: Dr 200 = Cr 200
        await tx.execute(sql`update "JournalVoucherLine" set "journalVoucherId" = ${v2}, "lineNumber" = 3 where id = ${moved}`); // v2 now Dr 300 / Cr 200
        await jline(tx, v1, 3, f.rent, "100", "0"); // v1 is whole again: Dr 600 = Cr 600
      }));

    it("does not let a balanced voucher hide an unbalanced one in the same transaction", () =>
      refused(async (tx, f) => {
        const good = await jv(tx, f);
        await jline(tx, good, 1, f.rent, "100", "0");
        await jline(tx, good, 2, f.cash, "0", "100");
        const bad = await ins(tx, "JournalVoucher", { companyId: f.co, branchId: f.br, voucherNumber: `B${f.tag}`.slice(0, 20), voucherDate: "2025-08-01", fiscalYear: "2082/83", updatedAt: NOW });
        await jline(tx, bad, 1, f.rent, "5", "0");
      }));
  });

  describe("cash / bank voucher", () => {
    it("accepts Dr 2500 Cash = Cr 2500 Rent", () =>
      accepted(async (tx, f) => {
        const v = await cbv(tx, f);
        await cline(tx, v, 1, f.cash, "2500", "0");
        await cline(tx, v, 2, f.rent, "0", "2500");
      }));

    it("refuses Dr 2500 against Cr 2499.99", () =>
      refused(async (tx, f) => {
        const v = await cbv(tx, f);
        await cline(tx, v, 1, f.cash, "2500", "0");
        await cline(tx, v, 2, f.rent, "0", "2499.99");
      }));

    it("accepts an edit that rewrites the lines in one transaction and refuses one that breaks the balance", async () => {
      await accepted(async (tx, f) => {
        const v = await cbv(tx, f);
        await cline(tx, v, 1, f.cash, "2500", "0");
        await cline(tx, v, 2, f.rent, "0", "2500");
        await check(tx);
        await tx.execute(sql`delete from "CashBankVoucherLine" where "cashBankVoucherId" = ${v}`);
        await cline(tx, v, 1, f.cash, "40", "0");
        await cline(tx, v, 2, f.rent, "0", "40");
      });
      await refused(async (tx, f) => {
        const v = await cbv(tx, f);
        const a = await cline(tx, v, 1, f.cash, "2500", "0");
        await cline(tx, v, 2, f.rent, "0", "2500");
        await check(tx);
        await tx.execute(sql`update "CashBankVoucherLine" set debit = '2600' where id = ${a}`);
      });
    });

    it("refuses deleting one line of a balanced cash / bank voucher and accepts deleting the whole voucher", async () => {
      await refused(async (tx, f) => {
        const v = await cbv(tx, f);
        await cline(tx, v, 1, f.cash, "10", "0");
        const b = await cline(tx, v, 2, f.rent, "0", "10");
        await check(tx);
        await tx.execute(sql`delete from "CashBankVoucherLine" where id = ${b}`);
      });
      await accepted(async (tx, f) => {
        const v = await cbv(tx, f);
        await cline(tx, v, 1, f.cash, "10", "0");
        await cline(tx, v, 2, f.rent, "0", "10");
        await check(tx);
        await tx.execute(sql`delete from "CashBankVoucher" where id = ${v}`);
      });
    });
  });

  describe("at a real commit", () => {
    it("an unbalanced voucher that is really committed is refused, nothing is stored, and the error is the 23514 the API maps to 409", async () => {
      const tag = uniq();
      let caught: unknown;
      let voucherId = 0;
      try {
        await db.transaction(async (tx: any) => {
          const f = await fixture(tx);
          voucherId = await jv(tx, f);
          await jline(tx, voucherId, 1, f.rent, "75", "0");
          await jline(tx, voucherId, 2, f.cash, "0", "74");
          // no SET CONSTRAINTS here: the check runs when the transaction commits
        });
      } catch (e) {
        caught = e;
      }
      void tag;
      const pg = pgError(caught);
      expect(pg?.code).toBe("23514");
      expect(pg?.message).toMatch(/not balanced/i);
      const left = await db.execute(sql`select count(*)::int as n from "JournalVoucher" where id = ${voucherId}`);
      expect(left[0].n).toBe(0);
    });

    it("a balanced voucher committed for real is stored (and is removed again so the test leaves nothing behind)", async () => {
      let companyId = 0;
      let voucherId = 0;
      await db.transaction(async (tx: any) => {
        const f = await fixture(tx);
        companyId = f.co;
        voucherId = await jv(tx, f);
        await jline(tx, voucherId, 1, f.rent, "75", "0");
        await jline(tx, voucherId, 2, f.cash, "0", "75");
      });
      try {
        const rows = await db.execute(sql`select count(*)::int as n from "JournalVoucherLine" where "journalVoucherId" = ${voucherId}`);
        expect(rows[0].n).toBe(2);
      } finally {
        // Removing a balanced voucher with its lines is allowed; then the throw-away company goes too.
        await db.transaction(async (tx: any) => {
          await tx.execute(sql`delete from "JournalVoucher" where id = ${voucherId}`);
          await tx.execute(sql`delete from "GeneralLedger" where "companyId" = ${companyId}`);
          await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${companyId})`);
          await tx.execute(sql`delete from "AccountGroup" where "companyId" = ${companyId}`);
          await tx.execute(sql`delete from "Branch" where "companyId" = ${companyId}`);
          await tx.execute(sql`delete from "Company" where id = ${companyId}`);
        });
      }
    });
  });
});
