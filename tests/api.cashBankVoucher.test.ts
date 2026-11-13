import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { DB_READY, startApi, uniq, type Res } from "./helpers";

// ERP-006 over HTTP: /api/cash-bank-vouchers (lookups, list, get, create, edit, delete, post, reverse, balance) against the real database,
// so the triggers (Dr = Cr at commit, company consistency, audit, lock date) are exercised exactly as in production.
// The world is a throw-away INACTIVE company (never in the header switcher), removed afterwards.
describe.skipIf(!DB_READY)("Cash / Bank Voucher (API)", () => {
  let call: (m: string, p: string, b?: unknown) => Promise<Res>;
  let close: () => Promise<void>;
  let db: any;
  let hashLockPassword: (p: string) => Promise<string>;
  let userId = 0;
  const tag = uniq();
  const c = (s: string) => `${s}${tag}`.slice(0, 20);
  const W: Record<string, number> = {};
  const NOW = sql`now()`;
  const PW = "correct-horse";

  const ins = async (table: string, vals: Record<string, unknown>) => {
    const keys = Object.keys(vals);
    const r = (await db.execute(sql`insert into ${sql.identifier(table)} (${sql.join(keys.map((k) => sql.identifier(k)), sql`, `)}) values (${sql.join(keys.map((k) => sql`${vals[k]}`), sql`, `)}) returning id`)) as any[];
    return r[0].id as number;
  };
  const rowsOf = async (q: any) => (await db.execute(q)) as any[];
  const base = "/api/cash-bank-vouchers";

  // The design screen's example: 18,500.00 received from a customer and 12,000.00 paid as rent through the bank.
  const body = (over: Record<string, unknown> = {}) => ({
    companyId: W.co, branchId: W.br, voucherDate: "2025-10-14", cashBankLedgerId: W.bank, userId,
    lines: [
      { generalLedgerId: W.cust, receipt: "18500.00", narration: "Receipt against invoice INV-2082-041" },
      { generalLedgerId: W.rent, payment: "12000.00", narration: "Monthly office rent" },
    ],
    ...over,
  });
  const mk = async (over: Record<string, unknown> = {}) => {
    const r = await call("POST", base, body(over));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body as { result: { id: number }; document: any };
  };
  const get = (id: number, co = W.co) => call("GET", `${base}/${id}?companyId=${co}`);
  const put = (id: number, b: unknown) => call("PUT", `${base}/${id}?companyId=${W.co}`, b);
  const del = (id: number) => call("DELETE", `${base}/${id}?companyId=${W.co}&userId=${userId}`);
  const post = (id: number, b: unknown = {}) => call("POST", `${base}/${id}/post?companyId=${W.co}`, { userId, ...(b as object) });
  const reverse = (id: number, b: unknown = {}) => call("POST", `${base}/${id}/reverse?companyId=${W.co}`, { userId, ...(b as object) });
  const stored = (id: number) => rowsOf(sql`select "lineNumber", "generalLedgerId" as gl, "subLedgerId" as sub, "debit"::text as d, "credit"::text as c, "isCashBankLine" as bank, "instrumentType" as inst, "chequeNumber" as cheque, to_char("chequeDate", 'YYYY-MM-DD') as cdate from "CashBankVoucherLine" where "cashBankVoucherId" = ${id} order by "lineNumber"`);
  const balance = (ledger: number, date: string, extra = "") => call("GET", `${base}/balance?companyId=${W.co}&branchId=${W.br}&fiscalYear=${encodeURIComponent("2082/83")}&generalLedgerId=${ledger}&date=${date}${extra}`);
  const bad = (r: Res, status: number, field?: string, msg?: RegExp) => {
    expect(r.status, JSON.stringify(r.body)).toBe(status);
    if (field) expect(r.body.field).toBe(field);
    if (msg) expect(r.body.message).toMatch(msg);
  };

  // A posted journal voucher straight in the database (fixture only: the guards are switched off for this one transaction).
  const postedJournal = async (date: string, num: string, dr: number, cr: number, amount: string) => {
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      const r = (await tx.execute(sql`insert into "JournalVoucher" ("companyId","branchId","voucherNumber","voucherDate","fiscalYear","isPosted","postedAt","updatedAt") values (${W.co},${W.br},${num},${date},'2082/83',true,now(),now()) returning id`)) as any[];
      await tx.execute(sql`insert into "JournalVoucherLine" ("journalVoucherId","lineNumber","generalLedgerId","debit","credit") values (${r[0].id},1,${dr},${amount},0),(${r[0].id},2,${cr},0,${amount})`);
    });
  };
  const setLock = async (date: string | null) => {
    const hash = date ? await hashLockPassword(PW) : null;
    await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`delete from "CompanyLock" where "companyId" = ${W.co}`);
      if (date) await tx.execute(sql`insert into "CompanyLock" ("companyId", "lockDate", "passwordHash", "updatedAt") values (${W.co}, ${date}, ${hash}, now())`);
    });
  };

  beforeAll(async () => {
    ({ call, close } = await startApi());
    ({ db } = await import("../server/db"));
    ({ hashLockPassword } = await import("../server/services/periodLock"));
    userId = (await call("GET", "/api/context")).body.user.id;

    W.co = await ins("Company", { code: c("T"), name: `ZZ CBV Test ${tag}`, isActive: false, updatedAt: NOW });
    W.br = await ins("Branch", { companyId: W.co, code: c("B"), name: "Branch", updatedAt: NOW });
    W.fy = await ins("FiscalYear", { companyId: W.co, code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16", isCurrent: true, updatedAt: NOW });
    const grp = await ins("AccountGroup", { companyId: W.co, code: c("G"), description: "Grp", type: "ASSET", updatedAt: NOW });
    const sg = await ins("AccountSubGroup", { code: c("S"), description: "Sub", accountGroupId: grp, updatedAt: NOW });
    const gl = (code: string, extra: Record<string, unknown> = {}) => ins("GeneralLedger", { companyId: W.co, code: c(code), name: `${code} ${tag}`, accountSubGroupId: sg, normalBalance: "DEBIT", updatedAt: NOW, ...extra });
    W.bank = await gl("BANK", { isCashOrBank: true });
    W.bank2 = await gl("BANK2", { isCashOrBank: true });
    W.bankSubLed = await gl("BANKSUB", { isCashOrBank: true, requiresSubLedger: true }); // a bank ledger with one sub-ledger per account
    W.cust = await gl("CUST", { glType: "CUSTOMER" });
    W.rent = await gl("RENT");
    W.off = await gl("OFF", { isActive: false });
    W.needSub = await gl("NEEDSUB", { requiresSubLedger: true });
    const sub = (code: string, glId: number) => ins("SubLedger", { code: c(code), name: code, generalLedgerId: glId, updatedAt: NOW });
    W.sub1 = await sub("SUB1", W.needSub);
    W.bankAcct = await sub("BACCT", W.bankSubLed);
    W.subOfRent = await sub("SUBR", W.rent);
    // a second company with one ledger, to prove another company's ledger is refused
    const co2 = await ins("Company", { code: c("U"), name: `ZZ CBV Other ${tag}`, isActive: false, updatedAt: NOW });
    const grp2 = await ins("AccountGroup", { companyId: co2, code: c("H"), description: "Grp2", type: "ASSET", updatedAt: NOW });
    const sg2 = await ins("AccountSubGroup", { code: c("T2"), description: "Sub2", accountGroupId: grp2, updatedAt: NOW });
    W.co2 = co2;
    W.foreign = await ins("GeneralLedger", { companyId: co2, code: c("F"), name: `Foreign ${tag}`, accountSubGroupId: sg2, normalBalance: "DEBIT", updatedAt: NOW });
    // opening balance of the bank: 12,84,500.00 (as on the design screen)
    await ins("OpeningBalance", { companyId: W.co, branchId: W.br, fiscalYearId: W.fy, generalLedgerId: W.bank, debit: "1284500", credit: 0, updatedAt: NOW });
  });

  afterAll(async () => {
    if (W.co) {
      await db.transaction(async (tx: any) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        for (const co of [W.co, W.co2]) {
          await tx.execute(sql`delete from "CashBankVoucherLine" where "cashBankVoucherId" in (select id from "CashBankVoucher" where "companyId" = ${co})`);
          await tx.execute(sql`delete from "CashBankVoucher" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "JournalVoucherLine" where "journalVoucherId" in (select id from "JournalVoucher" where "companyId" = ${co})`);
          await tx.execute(sql`delete from "JournalVoucher" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "OpeningBalance" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "CompanyLock" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "SubLedger" where "generalLedgerId" in (select id from "GeneralLedger" where "companyId" = ${co})`);
          await tx.execute(sql`delete from "GeneralLedger" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "AccountSubGroup" where "accountGroupId" in (select id from "AccountGroup" where "companyId" = ${co})`);
          await tx.execute(sql`delete from "AccountGroup" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "FiscalYear" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "Branch" where "companyId" = ${co}`);
          await tx.execute(sql`delete from "Company" where id = ${co}`);
        }
      });
    }
    await close();
  });

  describe("lookups", () => {
    it("offers the cash/bank ledgers apart, every ledger with its flags, the sub-ledgers and the fiscal years", async () => {
      const r = await call("GET", `${base}/lookups?companyId=${W.co}`);
      expect(r.status).toBe(200);
      expect(r.body.cashBankLedgers.map((l: any) => l.id).sort()).toEqual([W.bank, W.bank2, W.bankSubLed].sort());
      const need = r.body.ledgers.find((l: any) => l.id === W.needSub);
      expect(need).toMatchObject({ requiresSubLedger: true, isCashOrBank: false, isActive: true });
      expect(r.body.ledgers.find((l: any) => l.id === W.cust).glType).toBe("CUSTOMER");
      expect(r.body.subLedgers.map((s: any) => s.id).sort()).toEqual([W.sub1, W.subOfRent, W.bankAcct].sort());
      expect(r.body.fiscalYears).toEqual([expect.objectContaining({ code: "2082/83", startDate: "2025-07-17", endDate: "2026-07-16" })]);
      expect(r.body.ledgers.some((l: any) => l.id === W.foreign)).toBe(false); // another company's ledger is never offered
    });
    it("needs a company", async () => bad(await call("GET", `${base}/lookups`), 400, "companyId"));
  });

  describe("create a draft", () => {
    it("stores the design screen's example as a balanced journal: entries first, then the bank movement", async () => {
      const { result, document: d } = await mk();
      expect(d).toMatchObject({ status: "DRAFT", isPosted: false, voucherDate: "2025-10-14", fiscalYear: "2082/83", cashBankLedgerId: W.bank, totalReceipts: "18500.00", totalPayments: "12000.00" });
      expect(d.voucherNumber).toMatch(/^CBV-2082-83-\d{4}$/);
      expect(d.entries.map((e: any) => [e.generalLedgerId, e.receipt, e.payment, e.narration])).toEqual([
        [W.cust, "18500.00", "", "Receipt against invoice INV-2082-041"],
        [W.rent, "", "12000.00", "Monthly office rent"],
      ]);
      const s = await stored(result.id);
      expect(s.map((l) => [l.gl, Number(l.d), Number(l.c), l.bank])).toEqual([
        [W.cust, 0, 18500, false], [W.rent, 12000, 0, false], [W.bank, 18500, 0, true], [W.bank, 0, 12000, true],
      ]);
      expect(s.reduce((a, l) => a + Number(l.d) - Number(l.c), 0)).toBe(0);
    });
    it("opening 12,84,500.00 + receipts - payments = closing 12,91,000.00", async () => {
      const { document: d } = await mk({ voucherDate: "2025-10-15" });
      expect([d.openingBalance, d.closingBalance]).toEqual(["1284500.00", "1291000.00"]);
    });
    it("a receipts-only voucher writes no credit to the bank; a payments-only one writes no debit", async () => {
      const a = await mk({ lines: [{ generalLedgerId: W.cust, receipt: "500" }] });
      expect((await stored(a.result.id)).filter((l) => l.bank).map((l) => [Number(l.d), Number(l.c)])).toEqual([[500, 0]]);
      const b = await mk({ lines: [{ generalLedgerId: W.rent, payment: "75.5" }] });
      expect((await stored(b.result.id)).filter((l) => l.bank).map((l) => [Number(l.d), Number(l.c)])).toEqual([[0, 75.5]]);
    });
    it("keeps the instrument on the bank lines and the payee / reference on the voucher, and gives them back", async () => {
      const { result, document: d } = await mk({ instrumentType: "CHEQUE", chequeNumber: "008421", chequeDate: "2025-10-20", payeeReference: "Himalayan Retail", remarks: "October" });
      expect(d).toMatchObject({ instrumentType: "CHEQUE", chequeNumber: "008421", chequeDate: "2025-10-20", payeeReference: "Himalayan Retail", remarks: "October" });
      const s = await stored(result.id);
      expect(s.filter((l) => l.bank).every((l) => l.inst === "CHEQUE" && l.cheque === "008421" && l.cdate === "2025-10-20")).toBe(true);
      expect(s.filter((l) => !l.bank).every((l) => l.inst === null && l.cheque === null)).toBe(true);
    });
    it("a line may carry the sub-ledger of its ledger", async () => {
      const { document: d } = await mk({ lines: [{ generalLedgerId: W.needSub, subLedgerId: W.sub1, payment: "10" }] });
      expect(d.entries[0]).toMatchObject({ subLedgerId: W.sub1, subLedgerCode: expect.stringContaining("SUB1") });
    });
    it("numbers vouchers one after another in the branch and fiscal year", async () => {
      const a = await mk(), b = await mk();
      const n = (d: any) => Number(d.voucherNumber.split("-").pop());
      expect(n(b.document)).toBe(n(a.document) + 1);
    });
    it("records who made it in the audit trail (database trigger)", async () => {
      const { result } = await mk();
      const log = await rowsOf(sql`select "action", "changedBy" from "AuditLog" where "tableName" = 'CashBankVoucher' and "recordId" = ${String(result.id)}`);
      expect(log).toEqual([expect.objectContaining({ action: "INSERT", changedBy: userId })]);
    });
  });

  describe("what is refused", () => {
    it("needs a real date, a cash/bank ledger and at least one line", async () => {
      bad(await call("POST", base, body({ voucherDate: "2025-02-30" })), 400, "voucherDate");
      bad(await call("POST", base, body({ voucherDate: undefined })), 400, "voucherDate");
      bad(await call("POST", base, body({ cashBankLedgerId: undefined })), 400, "cashBankLedgerId");
      bad(await call("POST", base, body({ lines: [] })), 400, "lines");
    });
    it("a line has exactly one of receipt and payment, in plain amounts of at most 2 decimals", async () => {
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.cust, receipt: "5", payment: "5" }] })), 400, "lines.0.amount", /either a receipt or a payment/);
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.cust }] })), 400, "lines.0.amount");
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.cust, receipt: "1.234" }] })), 400, "lines.0.amount");
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.cust, receipt: "-5" }] })), 400, "lines.0.amount");
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.cust, receipt: { a: 1 } }] })), 400, "receipt");
    });
    it("the cash/bank ledger must be a cash/bank ledger of this company and active", async () => {
      const onlyCust = [{ generalLedgerId: W.cust, receipt: "5" }];
      bad(await call("POST", base, body({ cashBankLedgerId: W.rent, lines: onlyCust })), 400, "cashBankLedgerId", /not a cash \/ bank ledger/);
      bad(await call("POST", base, body({ cashBankLedgerId: W.foreign })), 400, "cashBankLedgerId", /not found in this company/);
      bad(await call("POST", base, body({ cashBankLedgerId: 2_000_000_000 })), 400, "cashBankLedgerId");
    });
    it("an entry cannot be the cash/bank ledger itself, an inactive ledger, or another company's ledger", async () => {
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.bank, receipt: "5" }] })), 400, "lines.0.account", /cannot also be an entry line/);
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.off, receipt: "5" }] })), 409, "lines.0.account", /not active/);
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.foreign, receipt: "5" }] })), 400, "lines.0.account", /not found in this company/);
    });
    it("a ledger that requires a sub-ledger needs one, and it must belong to that ledger", async () => {
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.needSub, payment: "5" }] })), 400, "lines.0.subLedger", /needs a sub-ledger/);
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.needSub, subLedgerId: W.subOfRent, payment: "5" }] })), 400, "lines.0.subLedger", /does not belong/);
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: W.rent, subLedgerId: W.sub1, payment: "5" }] })), 400, "lines.0.subLedger", /does not belong/);
    });
    it("a cheque needs its number and date", async () => {
      bad(await call("POST", base, body({ instrumentType: "CHEQUE" })), 400, "chequeNumber");
      bad(await call("POST", base, body({ instrumentType: "CHEQUE", chequeNumber: "1" })), 400, "chequeDate");
      bad(await call("POST", base, body({ instrumentType: "RTGS" })).then((r) => r), 201); // other instruments need nothing more
    });
    it("the date must fall inside an open fiscal year of the company, and the branch must be its own", async () => {
      bad(await call("POST", base, body({ voucherDate: "2024-01-01" })), 400, undefined, /fiscal year/i);
      bad(await call("POST", base, body({ branchId: 2_000_000_000 })), 404, "branchId");
    });
    it("refuses a body that is not an object of the right types with a 400, never a server error", async () => {
      bad(await call("POST", base, body({ lines: "nope" })), 400, "lines");
      bad(await call("POST", base, body({ lines: [{ generalLedgerId: "abc", receipt: "5" }] })), 400);
      bad(await call("POST", base, body({ instrumentType: "CARRIER_PIGEON" })), 400, "instrumentType");
      bad(await call("POST", base, body({ userId: 2_000_000_000 })), 400, "userId", /Unknown or inactive user/);
      bad(await call("POST", base, body({ companyId: undefined })), 400, "companyId");
    });
    it("the database still refuses an unbalanced voucher whatever the service does (safety net, migration 0007)", async () => {
      const { result } = await mk();
      await expect(db.transaction(async (tx: any) => {
        await tx.execute(sql`update "CashBankVoucherLine" set "debit" = "debit" + 1 where "cashBankVoucherId" = ${result.id} and "isCashBankLine" and "debit" > 0`);
      })).rejects.toThrow();
    });
  });

  describe("a bank ledger that needs a sub-ledger", () => {
    it("is refused without one, or with another ledger's sub-ledger", async () => {
      bad(await call("POST", base, body({ cashBankLedgerId: W.bankSubLed, lines: [{ generalLedgerId: W.cust, receipt: "40" }] })), 400, "cashBankSubLedgerId", /needs a sub-ledger/);
      bad(await call("POST", base, body({ cashBankLedgerId: W.bankSubLed, cashBankSubLedgerId: W.sub1, lines: [{ generalLedgerId: W.cust, receipt: "40" }] })), 400, "cashBankSubLedgerId", /does not belong/);
      bad(await call("POST", base, body({ cashBankLedgerId: W.bank, cashBankSubLedgerId: W.bankAcct })), 400, "cashBankSubLedgerId", /does not belong/); // a ledger with no such sub-ledger
    });
    it("keeps it on the two bank lines (not on the entries), gives it back, and a reversal keeps it too", async () => {
      const { result, document: d } = await mk({ cashBankLedgerId: W.bankSubLed, cashBankSubLedgerId: W.bankAcct, post: true });
      expect(d.cashBankSubLedgerId).toBe(W.bankAcct);
      const s = await stored(result.id);
      expect(s.filter((l) => l.bank).map((l) => l.sub)).toEqual([W.bankAcct, W.bankAcct]);
      expect(s.filter((l) => !l.bank).map((l) => l.sub)).toEqual([null, null]);
      const r = await reverse(result.id, { date: "2025-11-20" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect((await stored(r.body.result.id)).filter((l) => l.bank).map((l) => l.sub)).toEqual([W.bankAcct, W.bankAcct]);
    });
    it("a ledger that needs none leaves it empty", async () => {
      const { document: d } = await mk();
      expect(d.cashBankSubLedgerId).toBeNull();
    });
  });

  describe("edit and delete a draft", () => {
    it("rewrites the lines and recomputes the bank movement, keeping the number", async () => {
      const { result, document: d } = await mk();
      const r = await put(result.id, { ...body(), lines: [{ generalLedgerId: W.rent, payment: "300.25", narration: "changed" }], payeeReference: "Landlord" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.document).toMatchObject({ voucherNumber: d.voucherNumber, totalReceipts: "0.00", totalPayments: "300.25", payeeReference: "Landlord", status: "DRAFT" });
      expect((await stored(result.id)).map((l) => [l.gl, Number(l.d), Number(l.c), l.bank])).toEqual([[W.rent, 300.25, 0, false], [W.bank, 0, 300.25, true]]);
    });
    it("a company cannot edit another company's voucher: it is simply not found", async () => {
      const { result } = await mk();
      const r = await call("PUT", `${base}/${result.id}?companyId=${W.co2}`, body({ companyId: W.co2 }));
      bad(r, 404);
      bad(await get(result.id, W.co2), 404);
    });
    it("the same rules apply on edit", async () => {
      const { result } = await mk();
      bad(await put(result.id, { ...body(), lines: [{ generalLedgerId: W.cust, receipt: "5", payment: "5" }] }), 400, "lines.0.amount");
      bad(await put(result.id, { ...body(), cashBankLedgerId: W.rent, lines: [{ generalLedgerId: W.cust, receipt: "5" }] }), 400, "cashBankLedgerId");
    });
    it("deletes a draft with its lines", async () => {
      const { result } = await mk();
      expect((await del(result.id)).status).toBe(200);
      bad(await get(result.id), 404);
      expect(await stored(result.id)).toEqual([]);
    });
    it("a missing or malformed id is 'not found', not a server error", async () => {
      bad(await get(99_999_999), 404);
      bad(await call("GET", `${base}/abc?companyId=${W.co}`), 404);
      bad(await del(99_999_999), 404);
    });
  });

  describe("post", () => {
    it("posts a saved draft; it can then neither be edited nor deleted nor posted again", async () => {
      const { result } = await mk();
      const r = await post(result.id);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.document).toMatchObject({ status: "POSTED", isPosted: true });
      expect(r.body.document.postedAt).toBeTruthy();
      bad(await put(result.id, body()), 409, undefined, /cannot be edited/);
      bad(await del(result.id), 409, undefined, /cannot be deleted/);
      bad(await post(result.id), 409, undefined, /already posted/);
    });
    it("save-and-post in one request", async () => {
      const r = await call("POST", base, body({ post: true }));
      expect(r.status).toBe(201);
      expect(r.body.document.status).toBe("POSTED");
    });
    it("a draft edit may post in the same request", async () => {
      const { result } = await mk();
      const r = await put(result.id, { ...body(), post: true });
      expect(r.body.document.status).toBe("POSTED");
    });
    it("a posted voucher cannot be changed behind the service's back: the audit-reason guard asks for a reason", async () => {
      const { result } = await mk({ post: true });
      await expect(db.transaction(async (tx: any) => {
        await tx.execute(sql`update "CashBankVoucherLine" set "narration" = 'sneaky' where "cashBankVoucherId" = ${result.id}`);
      })).rejects.toThrow();
    });
  });

  describe("reverse", () => {
    it("makes a posted voucher of the same lines turned inside out; the original shows as reversed and every ledger nets to nothing", async () => {
      const { result, document: orig } = await mk({ voucherDate: "2025-11-01", post: true });
      const r = await reverse(result.id, { date: "2025-11-02", reason: "wrong party" });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.document).toMatchObject({ status: "REVERSED", reversedById: r.body.result.id });
      const rev = (await get(r.body.result.id)).body;
      expect(rev).toMatchObject({ status: "POSTED", isReversal: true, reversalOfId: result.id, voucherDate: "2025-11-02", cashBankLedgerId: W.bank });
      expect(rev.voucherNumber).toBe(`R-${orig.voucherNumber}`);
      expect(rev.remarks).toMatch(/Reversal of .*: wrong party/);
      const net = await rowsOf(sql`select l."generalLedgerId" as gl, sum(l."debit" - l."credit")::numeric(18,2)::text as net from "CashBankVoucherLine" l where l."cashBankVoucherId" in (${result.id}, ${r.body.result.id}) group by 1`);
      expect(net.every((n) => Number(n.net) === 0)).toBe(true);
      expect(net).toHaveLength(3);
    });
    it("is refused for a draft, for a voucher already reversed, and for a reversal", async () => {
      const draft = await mk();
      bad(await reverse(draft.result.id), 409, undefined, /Only a posted voucher/);
      const posted = await mk({ post: true });
      const r = await reverse(posted.result.id, { date: "2025-11-03" });
      expect(r.status).toBe(200);
      bad(await reverse(posted.result.id, { date: "2025-11-03" }), 409, undefined, /already been reversed/);
      bad(await reverse(r.body.result.id), 409, undefined, /cannot itself be reversed/);
    });
    it("the reversal must itself fall in an open fiscal year", async () => {
      const { result } = await mk({ post: true });
      bad(await reverse(result.id, { date: "2031-01-01" }), 400, undefined, /fiscal year/i);
    });
  });

  describe("balance", () => {
    it("is the opening balance plus posted journal and cash/bank vouchers up to the date, and ignores drafts", async () => {
      await postedJournal("2025-09-01", `J1${tag}`, W.bank2, W.rent, "700");
      await postedJournal("2025-12-01", `J2${tag}`, W.bank2, W.rent, "300");
      expect((await balance(W.bank2, "2025-10-01")).body).toMatchObject({ net: "700.00", side: "DR", amount: "700.00" });
      expect((await balance(W.bank2, "2025-12-01")).body.net).toBe("1000.00");
      await mk({ voucherDate: "2025-11-01", cashBankLedgerId: W.bank2, lines: [{ generalLedgerId: W.cust, receipt: "50" }] }); // a draft: not counted
      expect((await balance(W.bank2, "2025-12-01")).body.net).toBe("1000.00");
      const p = await mk({ voucherDate: "2025-11-01", cashBankLedgerId: W.bank2, lines: [{ generalLedgerId: W.cust, receipt: "50" }, { generalLedgerId: W.rent, payment: "20.50" }], post: true });
      expect((await balance(W.bank2, "2025-12-01")).body.net).toBe("1029.50");
      expect((await balance(W.bank2, "2025-12-01", `&excludeId=${p.result.id}`)).body.net).toBe("1000.00"); // leaves out the voucher being looked at
      expect((await balance(W.bank2, "2025-10-31")).body.net).toBe("700.00"); // as on that date, not later
    });
    it("shows a credit balance as CR with its amount unsigned", async () => {
      await mk({ voucherDate: "2025-08-01", lines: [{ generalLedgerId: W.cust, receipt: "250.75" }], post: true });
      const r = await balance(W.cust, "2025-08-01");
      expect(r.body).toMatchObject({ net: "-250.75", side: "CR", amount: "250.75" });
      expect((await balance(W.cust, "2025-07-20")).body.net).toBe("0.00");
    });
    it("an overdrawn bank is reported as a credit balance, not as zero (and the opening balances still differ by the voucher between them)", async () => {
      const big = await mk({ voucherDate: "2026-06-01", lines: [{ generalLedgerId: W.rent, payment: "5000000" }], post: true }); // 12,84,500 - 50,00,000 < 0
      const r = (await balance(W.bank, "2026-06-01")).body;
      expect(r.side).toBe("CR");
      expect(r.net.startsWith("-")).toBe(true);
      expect(Number(r.net)).toBeLessThan(0);
      const after = await mk({ voucherDate: "2026-06-02", lines: [{ generalLedgerId: W.cust, receipt: "10" }] });
      const before = (await get(big.result.id)).body;
      expect(Number(after.document.openingBalance) - Number(before.openingBalance)).toBe(-5000000);
      expect(Number(before.openingBalance)).toBeGreaterThan(Number(before.closingBalance)); // closing = opening - 50,00,000
    });
    it("needs a ledger of this company and a date", async () => {
      bad(await balance(W.foreign, "2025-10-01"), 404, "generalLedgerId");
      bad(await call("GET", `${base}/balance?companyId=${W.co}&branchId=${W.br}&fiscalYear=2082%2F83&generalLedgerId=${W.bank}`), 400, "date");
      bad(await balance(W.bank, "2025-02-30"), 400);
    });
    it("a posted voucher's own opening balance does not include itself, and a later voucher's does include it", async () => {
      const a = await mk({ voucherDate: "2026-01-10", lines: [{ generalLedgerId: W.cust, receipt: "1000" }], post: true });
      const b = await mk({ voucherDate: "2026-01-11", lines: [{ generalLedgerId: W.cust, receipt: "2000" }] });
      const open = (d: any) => Number(d.openingBalance);
      expect(open(b.document) - open((await get(a.result.id)).body)).toBe(1000);
    });
  });

  describe("list", () => {
    it("filters by status and by search, newest date first, with totals", async () => {
      const key = `LST${tag}`;
      const d = await mk({ voucherDate: "2026-03-01", payeeReference: `${key} draft`, lines: [{ generalLedgerId: W.rent, payment: "11" }] });
      const p = await mk({ voucherDate: "2026-03-02", payeeReference: `${key} posted`, lines: [{ generalLedgerId: W.rent, payment: "22" }], post: true });
      const x = await mk({ voucherDate: "2026-03-03", payeeReference: `${key} rev`, lines: [{ generalLedgerId: W.cust, receipt: "33" }], post: true });
      await reverse(x.result.id, { date: "2026-03-04" });
      const list = async (q: string) => (await call("GET", `${base}?companyId=${W.co}&search=${key}${q}`)).body;
      const all = await list("");
      // newest first; the reversal (2026-03-04) copies the payee of the voucher it reverses, so it is listed too
      expect(all.rows.map((r: any) => [r.payeeReference, r.isReversal])).toEqual([[`${key} rev`, true], [`${key} rev`, false], [`${key} posted`, false], [`${key} draft`, false]]);
      expect((await list("&status=DRAFT")).rows.map((r: any) => r.id)).toEqual([d.result.id]);
      expect((await list("&status=POSTED")).rows.map((r: any) => r.id)).toContain(p.result.id);
      expect((await list("&status=REVERSED")).rows.map((r: any) => r.id)).toEqual([x.result.id]);
      const row = (await list("&status=POSTED")).rows.find((r: any) => r.id === p.result.id);
      expect(row).toMatchObject({ voucherDate: "2026-03-02", status: "POSTED", totalReceipts: "0.00", totalPayments: "22.00", cashBankLedgerName: expect.stringContaining("BANK") });
      expect((await list("")).total).toBeGreaterThanOrEqual(3);
    });
    it("is scoped to the company and branch asked for, and says what it found", async () => {
      const r = await call("GET", `${base}?companyId=${W.co2}`);
      expect(r.body).toEqual({ total: 0, rows: [] });
      bad(await call("GET", base), 400, "companyId");
      expect((await call("GET", `${base}?companyId=${W.co}&branchId=${W.br}&fiscalYear=${encodeURIComponent("2099/00")}`)).body.total).toBe(0);
    });
    it("a search with % or _ is text, not a pattern", async () => {
      expect((await call("GET", `${base}?companyId=${W.co}&search=%25`)).body.total).toBe(0);
    });
  });

  describe("the company lock date (ERP-025)", () => {
    it("refuses create, edit, delete, post and reverse on or before the lock date; the override opens one request", async () => {
      const draft = await mk({ voucherDate: "2025-10-14" });
      const posted = await mk({ voucherDate: "2025-10-14", post: true });
      await setLock("2025-10-31");
      try {
        const locked = (r: Res) => { expect(r.status, JSON.stringify(r.body)).toBe(409); expect(r.body.code).toBe("PERIOD_LOCKED"); expect(r.body.message).toMatch(/locked up to 2025-10-31/); };
        locked(await call("POST", base, body()));
        locked(await put(draft.result.id, body()));
        locked(await del(draft.result.id));
        locked(await post(draft.result.id));
        locked(await reverse(posted.result.id, { date: "2025-10-20" }));
        // after the lock date everything works
        expect((await call("POST", base, body({ voucherDate: "2025-11-05" }))).status).toBe(201);
        // the override: the right password and a reason, for this one request
        const wrong = await call("POST", base, body({ lockOverride: { password: "nope", reason: "x" } }));
        expect(wrong.status).toBe(403);
        const ok = await call("POST", base, body({ lockOverride: { password: PW, reason: "owner approved a correction" } }));
        expect(ok.status, JSON.stringify(ok.body)).toBe(201);
        locked(await call("POST", base, body())); // the next request is locked again
        const log = await rowsOf(sql`select "lockOverride", "reason" from "AuditLog" where "tableName" = 'CashBankVoucher' and "recordId" = ${String(ok.body.result.id)} and "action" = 'INSERT'`);
        expect(log).toEqual([expect.objectContaining({ lockOverride: true, reason: expect.stringContaining("owner approved") })]);
      } finally { await setLock(null); }
    });
  });
});
