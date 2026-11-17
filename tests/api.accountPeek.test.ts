import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// GET /api/account-peek: the panel beside the voucher screens. For one ledger (or one party sub-ledger) it answers the balance on the voucher
// date and the last posted entries. The balance must be the very number /api/account-balances gives, drafts and later dates never count, the
// voucher being edited is left out, and a ledger of another company is "not found". The world is a throw-away INACTIVE company, removed afterwards.
describe.skipIf(!DB_READY)("Account peek (API)", () => {
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
  type JLine = [gl: number, sub: number | null, dr: string, cr: string, narration?: string];
  const journal = async (date: string, posted: boolean, lines: JLine[], remarks: string | null = null, branch = W.br) => {
    let id = 0;
    const no = c("J") + ++seq;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const r = (await tx.execute(sql`insert into "JournalVoucher" ("companyId","branchId","voucherNumber","voucherDate","fiscalYear","remarks","isPosted","postedAt","updatedAt") values (${W.co},${branch},${no},${date},${FY},${remarks},${posted},${posted ? sql`now()` : null},now()) returning id`)) as any[];
      id = r[0].id;
      let n = 0;
      for (const [gl, sub, dr, cr, narration] of lines) await tx.execute(sql`insert into "JournalVoucherLine" ("journalVoucherId","lineNumber","generalLedgerId","subLedgerId","debit","credit","narration") values (${id},${++n},${gl},${sub},${dr},${cr},${narration ?? null})`);
    });
    return { id, no };
  };
  const cashBank = async (date: string, posted: boolean, lines: [number, string, string][]) => {
    let id = 0;
    const no = c("C") + ++seq;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const r = (await tx.execute(sql`insert into "CashBankVoucher" ("companyId","branchId","voucherNumber","voucherDate","fiscalYear","isPosted","updatedAt") values (${W.co},${W.br},${no},${date},${FY},${posted},now()) returning id`)) as any[];
      id = r[0].id;
      let n = 0;
      for (const [gl, dr, cr] of lines) await tx.execute(sql`insert into "CashBankVoucherLine" ("cashBankVoucherId","lineNumber","generalLedgerId","debit","credit") values (${id},${++n},${gl},${dr},${cr})`);
    });
    return { id, no };
  };

  const peekUrl = (o: Record<string, string | number | undefined> = {}) => {
    const base: Record<string, string | number | undefined> = { companyId: W.co, branchId: W.br, fiscalYear: FY, date: "2025-12-31", generalLedgerId: W.a, ...o };
    const q = new URLSearchParams(Object.entries(base).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return `/api/account-peek?${q}`;
  };
  const peek = async (o: Record<string, string | number | undefined> = {}) => {
    const r = await call("GET", peekUrl(o));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body as { ledger: any; subLedger: any; balance: { debit: string; credit: string }; recent: any[] };
  };
  const paise = (b: { debit: string; credit: string }) => Math.round((Number(b.debit) - Number(b.credit)) * 100);
  // What /api/account-balances says for the same ledger / sub-ledger, as net paise (no row = zero).
  const balancesNet = async (gl: number, sub: number | null, o: Record<string, string | number> = {}) => {
    const q = new URLSearchParams({ companyId: String(W.co), branchId: String(W.br), fiscalYear: FY, date: "2025-12-31", ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
    const r = await call("GET", `/api/account-balances?${q}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const row = (r.body.rows as any[]).find((x) => x.generalLedgerId === gl && x.subLedgerId === sub);
    return row ? Math.round((Number(row.debit) - Number(row.credit)) * 100) : 0;
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    W.co = await ins("Company", { code: c("T"), name: `ZZ Peek Test ${tag}`, isActive: false, updatedAt: NOW });
    W.co2 = await ins("Company", { code: c("U"), name: `ZZ Peek Other ${tag}`, isActive: false, updatedAt: NOW });
    W.br = await ins("Branch", { companyId: W.co, code: c("B"), name: "Branch", updatedAt: NOW });
    W.br2 = await ins("Branch", { companyId: W.co, code: c("D"), name: "Other branch", updatedAt: NOW });
    W.fy = await ins("FiscalYear", { companyId: W.co, code: FY, startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins("AccountGroup", { companyId: W.co, code: c("G"), description: "Grp", type: "ASSET", updatedAt: NOW });
    const sg = await ins("AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const grp2 = await ins("AccountGroup", { companyId: W.co2, code: c("H"), description: "Grp2", type: "ASSET", updatedAt: NOW });
    const sg2 = await ins("AccountSubGroup", { code: c("R"), description: "Sub2", accountGroupId: grp2, updatedAt: NOW });
    const gl = (code: string, co: number, sub: number, extra: Record<string, unknown> = {}) => ins("GeneralLedger", { companyId: co, code: c(code), name: `${code} ${tag}`, accountSubGroupId: sub, normalBalance: "DEBIT", updatedAt: NOW, ...extra });
    W.a = await gl("A", W.co, sg);
    W.b = await gl("B", W.co, sg);
    W.party = await gl("PARTY", W.co, sg, { requiresSubLedger: true });
    W.bank = await gl("BANK", W.co, sg, { isCashOrBank: true });
    W.foreign = await gl("F", W.co2, sg2);
    W.sub = await ins("SubLedger", { code: c("SUB1"), name: "Party one", generalLedgerId: W.party, updatedAt: NOW });
    W.sub2 = await ins("SubLedger", { code: c("SUB2"), name: "Party two", generalLedgerId: W.party, updatedAt: NOW });
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
        await tx.execute(sql`delete from "SubLedger" where "generalLedgerId" in (select id from "GeneralLedger" where "companyId" in (${W.co}, ${W.co2}))`);
        await tx.execute(sql`delete from "GeneralLedger" where "companyId" in (${W.co}, ${W.co2})`);
        await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" in (${W.co}, ${W.co2}))`);
        await tx.execute(sql`delete from "AccountGroup" where "companyId" in (${W.co}, ${W.co2})`);
        await tx.execute(sql`delete from "FiscalYear" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "Branch" where "companyId" = ${W.co}`);
        await tx.execute(sql`delete from "Company" where id in (${W.co}, ${W.co2})`);
      });
    }
    await close();
  });

  it("needs a date, a fiscal year, a real date and a ledger", async () => {
    const bad = async (o: Record<string, string | number | undefined>) => expect((await call("GET", peekUrl(o))).status).toBe(400);
    await bad({ date: undefined });
    await bad({ fiscalYear: undefined });
    await bad({ generalLedgerId: undefined });
    await bad({ date: "2026-02-31" });
    await bad({ date: "not-a-date" });
    await bad({ generalLedgerId: "abc" });
    await bad({ limit: "0" });
  });

  it("answers the ledger's own details and an opening balance of Dr 500.00 with nothing yet to list", async () => {
    const r = await peek();
    expect(r.ledger).toMatchObject({ id: W.a, code: c("A"), requiresSubLedger: false });
    expect(r.subLedger).toBeNull();
    expect(r.balance).toEqual({ debit: "500.00", credit: "0.00" });
    expect(r.recent).toEqual([]);
  });

  it("a ledger of another company, or a sub-ledger of another ledger, is not found", async () => {
    expect((await call("GET", peekUrl({ generalLedgerId: W.foreign }))).status).toBe(404);
    expect((await call("GET", peekUrl({ generalLedgerId: 999_999_999 }))).status).toBe(404); // the largest id the route reads, and no such ledger
    expect((await call("GET", peekUrl({ generalLedgerId: W.a, subLedgerId: W.sub }))).status).toBe(404); // W.sub belongs to the party ledger
    expect((await call("GET", peekUrl({ companyId: W.co2, generalLedgerId: W.a }))).status).toBe(404); // right ledger, wrong company
  });

  it("gives the very balance /api/account-balances gives, and counts only posted vouchers through the date", async () => {
    const posted = await journal("2025-10-10", true, [[W.a, null, "100.00", "0"], [W.b, null, "0", "100.00"]]);
    await journal("2025-10-11", false, [[W.a, null, "7.00", "0"], [W.b, null, "0", "7.00"]]); // a draft is not a balance yet
    await journal("2026-01-05", true, [[W.a, null, "1.00", "0"], [W.b, null, "0", "1.00"]]);  // after the as-of date
    await cashBank("2025-11-01", true, [[W.bank, "40.50", "0"], [W.a, "0", "40.50"]]);
    await cashBank("2025-11-02", false, [[W.bank, "3.00", "0"], [W.a, "0", "3.00"]]);

    for (const gl of [W.a, W.b, W.bank]) expect(paise((await peek({ generalLedgerId: gl })).balance)).toBe(await balancesNet(gl, null));
    expect(paise((await peek()).balance)).toBe(50_000 + 10_000 - 4_050);
    expect(paise((await peek({ date: "2025-10-09" })).balance)).toBe(50_000);   // before any voucher: opening only
    expect(paise((await peek({ date: "2025-10-10" })).balance)).toBe(60_000);   // the voucher's own day counts
    // the voucher being edited is left out so its own lines are not counted twice
    expect(paise((await peek({ excludeJournalVoucherId: posted.id })).balance)).toBe(50_000 - 4_050);
    expect(paise((await peek({ excludeJournalVoucherId: posted.id })).balance)).toBe(await balancesNet(W.a, null, { excludeJournalVoucherId: posted.id }));
  });

  it("lists the last posted entries newest first, never drafts or later dates, and stops at the limit", async () => {
    const r = await peek();
    // posted lines of ledger A through 2025-12-31: journal 10 Oct (Dr 100.00) and cash/bank 1 Nov (Cr 40.50). The draft and the January voucher are not listed.
    expect(r.recent.map((e) => [e.kind, e.voucherDate, e.debit, e.credit])).toEqual([
      ["CASH_BANK", "2025-11-01", "0.00", "40.50"],
      ["JOURNAL", "2025-10-10", "100.00", "0.00"],
    ]);
    expect(r.recent.every((e) => typeof e.voucherId === "number" && e.voucherNumber.length > 0)).toBe(true);

    for (let i = 0; i < 6; i++) await journal(`2025-12-0${i + 1}`, true, [[W.a, null, "1.00", "0"], [W.b, null, "0", "1.00"]]);
    const five = await peek();
    expect(five.recent).toHaveLength(5);                                      // default limit
    expect(five.recent[0].voucherDate).toBe("2025-12-06");
    expect([...five.recent].map((e) => e.voucherDate)).toEqual([...five.recent].map((e) => e.voucherDate).sort().reverse());
    expect((await peek({ limit: 2 })).recent).toHaveLength(2);
    expect((await peek({ limit: 500 })).recent.length).toBeLessThanOrEqual(20); // the cap
  });

  it("uses the line's narration, else the voucher's remarks, and leaves out the voucher being edited", async () => {
    const v = await journal("2025-12-20", true, [[W.b, null, "2.00", "0", "Line note"], [W.a, null, "0", "2.00"]], "Voucher remark");
    const withNarr = (await peek({ generalLedgerId: W.b })).recent.find((e) => e.voucherId === v.id && e.kind === "JOURNAL");
    expect(withNarr?.narration).toBe("Line note");
    const fallback = (await peek()).recent.find((e) => e.voucherId === v.id && e.kind === "JOURNAL");
    expect(fallback?.narration).toBe("Voucher remark"); // ledger A's line has no narration of its own
    expect((await peek({ excludeJournalVoucherId: v.id })).recent.some((e) => e.voucherId === v.id)).toBe(false);
  });

  it("reports sub-ledger balances and entries apart from the whole ledger's", async () => {
    await journal("2025-12-01", true, [[W.party, W.sub, "25.00", "0"], [W.b, null, "0", "25.00"]]);
    await journal("2025-12-02", true, [[W.party, W.sub2, "10.00", "0"], [W.b, null, "0", "10.00"]]);
    const whole = await peek({ generalLedgerId: W.party });
    const one = await peek({ generalLedgerId: W.party, subLedgerId: W.sub });
    expect(paise(whole.balance)).toBe(3_500);
    expect(paise(one.balance)).toBe(2_500);
    expect(one.subLedger).toMatchObject({ id: W.sub, code: c("SUB1"), name: "Party one" });
    expect(one.ledger.requiresSubLedger).toBe(true);
    expect(one.recent).toHaveLength(1);
    expect(whole.recent).toHaveLength(2);
    expect(paise(one.balance)).toBe(await balancesNet(W.party, W.sub));
    expect(paise(whole.balance)).toBe(await balancesNet(W.party, null));
  });

  it("is scoped to the branch it is asked for", async () => {
    await journal("2025-12-05", true, [[W.a, null, "9.00", "0"], [W.b, null, "0", "9.00"]], null, W.br2);
    const other = await peek({ branchId: W.br2 });
    expect(other.balance).toEqual({ debit: "9.00", credit: "0.00" }); // no opening balance there, only its own voucher
    expect(other.recent).toHaveLength(1);
  });
});
