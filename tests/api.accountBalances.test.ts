import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// GET /api/account-balances: the "Balance · Dr / Cr" shown beside ledgers on the voucher screens.
// Opening balance plus posted journal and cash/bank movements count through the as-of date; drafts, later dates and the voucher being
// edited do not. The world is a throw-away INACTIVE company (never in the header switcher), removed afterwards, so the seeded data
// that other test files rely on is not touched.
describe.skipIf(!DB_READY)("Account balances (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  const tag = uniq();
  const c = (s: string) => `${s}${tag}`.slice(0, 20);
  const W: Record<string, number> = {};
  const NOW = sql`now()`;
  let seq = 0; // voucher numbers are unique per branch
  const FY = "2082/83";

  const ins = async (table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const r = (await db.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`)) as any[];
    return r[0].id as number;
  };
  // Fixture vouchers straight in the database (the guards are switched off for this one transaction).
  const journal = async (date: string, posted: boolean, lines: [number, number | null, string, string][]) => {
    let id = 0;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const r = (await tx.execute(sql`insert into "JournalVoucher" ("companyId","branchId","voucherNumber","voucherDate","fiscalYear","isPosted","postedAt","updatedAt") values (${W.co},${W.br},${c("J") + ++seq},${date},${FY},${posted},${posted ? sql`now()` : null},now()) returning id`)) as any[];
      id = r[0].id;
      let n = 0;
      for (const [gl, sub, dr, cr] of lines) await tx.execute(sql`insert into "JournalVoucherLine" ("journalVoucherId","lineNumber","generalLedgerId","subLedgerId","debit","credit") values (${id},${++n},${gl},${sub},${dr},${cr})`);
    });
    return id;
  };
  const cashBank = async (date: string, posted: boolean, lines: [number, string, string][]) => {
    let id = 0;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const r = (await tx.execute(sql`insert into "CashBankVoucher" ("companyId","branchId","voucherNumber","voucherDate","fiscalYear","isPosted","updatedAt") values (${W.co},${W.br},${c("C") + ++seq},${date},${FY},${posted},now()) returning id`)) as any[];
      id = r[0].id;
      let n = 0;
      for (const [gl, dr, cr] of lines) await tx.execute(sql`insert into "CashBankVoucherLine" ("cashBankVoucherId","lineNumber","generalLedgerId","debit","credit") values (${id},${++n},${gl},${dr},${cr})`);
    });
    return id;
  };

  const url = (o: Record<string, string | number> = {}) => {
    const q = new URLSearchParams({ companyId: String(W.co), branchId: String(W.br), fiscalYear: FY, date: "2025-12-31", ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    return `/api/account-balances?${q}`;
  };
  // Net balance in paise (debit minus credit) of one row; a ledger with no movement has no row, which is a zero balance.
  const net = async (gl: number, sub: number | null = null, o: Record<string, string | number> = {}) => {
    const r = await call("GET", url(o));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (r.body.rows as any[]).find((x) => x.generalLedgerId === gl && x.subLedgerId === sub);
    return row ? Math.round((Number(row.debit) - Number(row.credit)) * 100) : 0;
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    W.co = await ins("Company", { code: c("T"), name: `ZZ Bal Test ${tag}`, isActive: false, updatedAt: NOW });
    W.br = await ins("Branch", { companyId: W.co, code: c("B"), name: "Branch", updatedAt: NOW });
    W.br2 = await ins("Branch", { companyId: W.co, code: c("D"), name: "Other branch", updatedAt: NOW });
    W.fy = await ins("FiscalYear", { companyId: W.co, code: FY, startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins("AccountGroup", { companyId: W.co, code: c("G"), description: "Grp", type: "ASSET", updatedAt: NOW });
    const sg = await ins("AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, extra: Record<string, unknown> = {}) => ins("GeneralLedger", { companyId: W.co, code: c(code), name: `${code} ${tag}`, accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW, ...extra });
    W.a = await gl("A");
    W.b = await gl("B");
    W.party = await gl("PARTY", { requiresSubLedger: true });
    W.bank = await gl("BANK", { isCashOrBank: true });
    W.sub = await ins("SubLedger", { code: c("SUB1"), name: "Party one", generalLedgerId: W.party, updatedAt: NOW });
    // opening balance of ledger A: 500.00 (the database sums it as "500.000000", six decimals)
    await ins("OpeningBalance", { companyId: W.co, branchId: W.br, fiscalYearId: W.fy, generalLedgerId: W.a, debit: "500", credit: 0, updatedAt: NOW });
  });

  afterAll(async () => {
    if (W.co) {
      await db.transaction(async (tx: any) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`delete from "CashBankVoucherLine" where "cashBankVoucherId" in (select id from "CashBankVoucher" where "companyId" = ${W.co})`);
        await tx.execute(sql`delete from "CashBankVoucher" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "JournalVoucherLine" where "journalVoucherId" in (select id from "JournalVoucher" where "companyId" = ${W.co})`);
        await tx.execute(sql`delete from "JournalVoucher" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "OpeningBalance" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "SubLedger" where "generalLedgerId" in (select id from "GeneralLedger" where "companyId" = ${W.co})`);
        await tx.execute(sql`delete from "GeneralLedger" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${W.co})`);
        await tx.execute(sql`delete from "AccountGroup" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "FiscalYear" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "Branch" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "Company" where id = ${W.co}`);
      });
    }
    await close();
  });

  it("needs a date and a fiscal year, and a real date", async () => {
    const base = `companyId=${W.co}&branchId=${W.br}`;
    expect((await call("GET", `/api/account-balances?${base}&fiscalYear=${FY}`)).status).toBe(400);
    expect((await call("GET", `/api/account-balances?${base}&date=2025-12-31`)).status).toBe(400);
    expect((await call("GET", url({ date: "2026-02-31" }))).status).toBe(400);
    expect((await call("GET", url({ date: "not-a-date" }))).status).toBe(400);
  });

  it("reads an opening balance (the database returns it with six decimals) as Dr 500.00 / Cr 0.00", async () => {
    const r = await call("GET", url());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.rows).toEqual([{ generalLedgerId: W.a, subLedgerId: null, debit: "500.00", credit: "0.00" }]);
  });

  it("counts posted journal and cash/bank vouchers through the as-of date, never drafts or later dates", async () => {
    const posted = await journal("2025-10-10", true, [[W.a, null, "100.00", "0"], [W.b, null, "0", "100.00"]]);
    await journal("2025-10-11", false, [[W.a, null, "7.00", "0"], [W.b, null, "0", "7.00"]]); // a draft is not a balance yet
    await journal("2026-01-05", true, [[W.a, null, "1.00", "0"], [W.b, null, "0", "1.00"]]);  // after the as-of date
    await cashBank("2025-11-01", true, [[W.bank, "40.50", "0"], [W.a, "0", "40.50"]]);
    await cashBank("2025-11-02", false, [[W.bank, "3.00", "0"], [W.a, "0", "3.00"]]);

    expect(await net(W.a)).toBe(50_000 + 10_000 - 4_050);          // opening + journal - cash/bank
    expect(await net(W.b)).toBe(-10_000);
    expect(await net(W.bank)).toBe(4_050);
    expect(await net(W.a, null, { date: "2025-10-09" })).toBe(50_000); // before any voucher: opening only
    expect(await net(W.a, null, { date: "2025-10-10" })).toBe(60_000); // the voucher's own day counts
    expect(await net(W.a, null, { date: "2026-01-05" })).toBe(50_000 + 10_000 + 100 - 4_050);

    // the voucher being edited is left out so its own lines are not counted twice
    expect(await net(W.a, null, { excludeJournalVoucherId: posted })).toBe(50_000 - 4_050);
  });

  it("leaves out the cash/bank voucher being edited", async () => {
    const id = await cashBank("2025-11-20", true, [[W.bank, "9.00", "0"], [W.b, "0", "9.00"]]);
    const withIt = await net(W.bank);
    expect(await net(W.bank, null, { excludeCashBankVoucherId: id })).toBe(withIt - 900);
  });

  it("reports sub-ledger balances beside the whole-ledger one", async () => {
    await journal("2025-12-01", true, [[W.party, W.sub, "25.00", "0"], [W.b, null, "0", "25.00"]]);
    expect(await net(W.party, W.sub)).toBe(2_500);
    expect(await net(W.party, null)).toBe(2_500);
  });

  it("is scoped to the branch it is asked for", async () => {
    const r = await call("GET", url({ branchId: W.br2 }));
    expect(r.status).toBe(200);
    expect(r.body.rows).toEqual([]);
  });
});
