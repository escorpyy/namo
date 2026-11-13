import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { formatPaise, journalLines, swapSides, voucherProblems, type JournalLine } from "../../shared/cashBankVoucher";
import { parseDec, toCents } from "../../shared/decimal";
import { guardPeriod, type LockOverride } from "./periodLock";
import { type Actor, type Opts, type Tx, assertBranch, inActorTx, parseDate, resolveFiscalYear, today } from "./purchase/common";

// Cash / Bank Voucher (ERP-006). The rules that need no database live in shared/cashBankVoucher.ts (the screen uses them too); this file
// owns everything that does: ledgers and sub-ledgers must exist in the company and be usable, the number, the lock date, the fiscal year,
// posting, reversal and the balances.
//
// Life of a voucher: DRAFT (freely edited or deleted) -> POSTED (never edited; corrected by a reversal voucher, like a purchase bill, S7/S9)
// -> REVERSED once a reversal of it is posted. A posted voucher is written as a draft first and then flipped to posted in the same
// transaction: the audit-reason guard (migration 0009) exempts that transition, so no special permission is needed to post.
// Number: CBV-<fiscal year>-<0001...>, per branch. (Number series, ERP-006 follow-up, only know purchase documents so far.)
// Every write runs inside inActorTx, so the audit trail records who did it; every date is checked against the company lock date (ERP-025).

type LockOpts = { lockOverride?: LockOverride };

export type VoucherEntryInput = { generalLedgerId?: number | null; subLedgerId?: number | null; receipt?: unknown; payment?: unknown; narration?: string | null };
export type VoucherInput = {
  companyId: number; branchId: number; voucherDate: string; fiscalYear?: string | null; cashBankLedgerId: number; cashBankSubLedgerId?: number | null;
  instrumentType?: string | null; chequeNumber?: string | null; chequeDate?: string | null; payeeReference?: string | null; remarks?: string | null;
  lines: VoucherEntryInput[];
};

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const paise = (v: string | null | undefined) => toCents(v ?? "0");
const money = (v: string | null | undefined) => formatPaise(paise(v));
// A balance can be negative (a credit balance, an overdrawn bank). toCents only reads non-negative numbers and answers 0 for anything it cannot
// read, which would show every negative balance as 0.00, so the sign is handled here and an unreadable amount is an error, never a silent 0.
function signedPaise(s: string): bigint {
  const neg = s.startsWith("-"), body = neg ? s.slice(1) : s;
  if (!parseDec(body)) throw new Error(`Unreadable amount from the database: ${s}`);
  const v = toCents(body);
  return neg ? -v : v;
}

// ---------- checks that need the database ----------
// Shape first (shared rules), then: the cash/bank ledger is one, every account exists in THIS company and is active, a ledger that
// requires a sub-ledger has one, and a sub-ledger given belongs to its line's ledger. Returns the lines to store.
async function checkedLines(tx: Tx, input: VoucherInput): Promise<JournalLine[]> {
  const problems = voucherProblems(input, input.lines);
  if (problems.length) throw new HttpError(400, problems[0].message, problems[0].field);

  const ids = [...new Set([input.cashBankLedgerId, ...input.lines.map((l) => l.generalLedgerId as number)])];
  const gls = await tx.select({ id: S.generalLedger.id, code: S.generalLedger.code, isActive: S.generalLedger.isActive, isCashOrBank: S.generalLedger.isCashOrBank, requiresSubLedger: S.generalLedger.requiresSubLedger })
    .from(S.generalLedger).where(and(eq(S.generalLedger.companyId, input.companyId), inArray(S.generalLedger.id, ids)));
  const byId = new Map(gls.map((g) => [g.id, g]));

  const bank = byId.get(input.cashBankLedgerId);
  if (!bank) throw new HttpError(400, "The cash / bank ledger was not found in this company.", "cashBankLedgerId");
  if (!bank.isActive) throw new HttpError(409, `Ledger ${bank.code} is not active.`, "cashBankLedgerId");
  if (!bank.isCashOrBank) throw new HttpError(400, `Ledger ${bank.code} is not a cash / bank ledger.`, "cashBankLedgerId");

  const subIds = [...new Set([input.cashBankSubLedgerId, ...input.lines.map((l) => l.subLedgerId)].filter((x): x is number => !!x))];
  const subs = subIds.length ? await tx.select({ id: S.subLedger.id, code: S.subLedger.code, generalLedgerId: S.subLedger.generalLedgerId, isActive: S.subLedger.isActive }).from(S.subLedger).where(inArray(S.subLedger.id, subIds)) : [];
  const subById = new Map(subs.map((s) => [s.id, s]));

  // The bank side may need a sub-ledger too (a bank ledger with one sub-ledger per account): it is kept on the two bank lines.
  if (input.cashBankSubLedgerId) {
    const sl = subById.get(input.cashBankSubLedgerId);
    if (!sl || sl.generalLedgerId !== bank.id) throw new HttpError(400, `That sub-ledger does not belong to ledger ${bank.code}.`, "cashBankSubLedgerId");
    if (!sl.isActive) throw new HttpError(409, `Sub-ledger ${sl.code} is not active.`, "cashBankSubLedgerId");
  } else if (bank.requiresSubLedger) {
    throw new HttpError(400, `Ledger ${bank.code} needs a sub-ledger.`, "cashBankSubLedgerId");
  }

  input.lines.forEach((l, i) => {
    const n = i + 1, gl = byId.get(l.generalLedgerId as number);
    if (!gl) throw new HttpError(400, `Line ${n}: the account was not found in this company.`, `lines.${i}.account`);
    if (!gl.isActive) throw new HttpError(409, `Line ${n}: ledger ${gl.code} is not active.`, `lines.${i}.account`);
    if (l.subLedgerId) {
      const sl = subById.get(l.subLedgerId);
      if (!sl || sl.generalLedgerId !== gl.id) throw new HttpError(400, `Line ${n}: that sub-ledger does not belong to ledger ${gl.code}.`, `lines.${i}.subLedger`);
      if (!sl.isActive) throw new HttpError(409, `Line ${n}: sub-ledger ${sl.code} is not active.`, `lines.${i}.subLedger`);
    } else if (gl.requiresSubLedger) {
      throw new HttpError(400, `Line ${n}: ledger ${gl.code} needs a sub-ledger.`, `lines.${i}.subLedger`);
    }
  });
  return journalLines(input.cashBankLedgerId, input.lines, { ...input, bankSubLedgerId: input.cashBankSubLedgerId });
}

async function insertLines(tx: Tx, voucherId: number, lines: JournalLine[]) {
  let n = 1;
  for (const l of lines) {
    await tx.insert(S.cashBankVoucherLine).values({
      cashBankVoucherId: voucherId, lineNumber: n++, generalLedgerId: l.generalLedgerId, subLedgerId: l.subLedgerId,
      debit: formatPaise(l.debit), credit: formatPaise(l.credit), narration: l.narration, isCashBankLine: l.isCashBankLine,
      instrumentType: l.instrumentType, chequeNumber: l.chequeNumber, chequeDate: l.chequeDate ? parseDate(l.chequeDate, "chequeDate") : null,
    });
  }
}

// Next voucher number of a branch for a fiscal year: the highest CBV-<fy>-<digits> + 1, zero-padded to 4. The advisory lock stops two
// people taking the same number at the same moment (the unique index per branch is the last line of defence).
async function nextVoucherNumber(tx: Tx, branchId: number, fyCode: string) {
  const prefix = `CBV-${fyCode.replace(/\//g, "-")}-`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`CashBankVoucher:${branchId}`}))`);
  const pattern = `^${prefix.replace(/[^A-Za-z0-9]/g, (c) => `\\${c}`)}[0-9]{1,15}$`;
  const r = (await tx.execute(sql`select coalesce(max(substring("voucherNumber" from '([0-9]+)$')::bigint), 0)::text as n from "CashBankVoucher" where "branchId" = ${branchId} and "voucherNumber" ~ ${pattern}`)) as any[];
  return `${prefix}${String(BigInt(r[0].n) + 1n).padStart(4, "0")}`;
}

async function lockVoucher(tx: Tx, id: number, companyId: number) {
  const [v] = await tx.select().from(S.cashBankVoucher).where(and(eq(S.cashBankVoucher.id, id), eq(S.cashBankVoucher.companyId, companyId))).for("update");
  if (!v) throw new HttpError(404, "Voucher not found.");
  return v;
}

const markPosted = (tx: Tx, id: number, actor: Actor) =>
  tx.update(S.cashBankVoucher).set({ isPosted: true, postedAt: new Date(), postedBy: actor.userId }).where(eq(S.cashBankVoucher.id, id));

// ---------- write ----------
export function createVoucher(input: VoucherInput, actor: Actor, opts: Opts & LockOpts & { post?: boolean } = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const problems = voucherProblems(input, input.lines);
    const dateProblem = problems.find((p) => p.field === "voucherDate");
    if (dateProblem) throw new HttpError(400, dateProblem.message, dateProblem.field);
    await assertBranch(tx, input.companyId, input.branchId);
    const date = parseDate(input.voucherDate, "voucherDate");
    await guardPeriod(tx, input.companyId, [date], opts.lockOverride, "voucherDate");
    const fy = await resolveFiscalYear(tx, input.companyId, date, input.fiscalYear);
    const lines = await checkedLines(tx, input);
    const [v] = await tx.insert(S.cashBankVoucher).values({
      companyId: input.companyId, branchId: input.branchId, voucherNumber: await nextVoucherNumber(tx, input.branchId, fy.code), voucherDate: date, fiscalYear: fy.code,
      cashBankLedgerId: input.cashBankLedgerId, payeeReference: input.payeeReference?.trim() || null, remarks: input.remarks?.trim() || null, createdBy: actor.userId,
    }).returning({ id: S.cashBankVoucher.id });
    await insertLines(tx, v.id, lines);
    if (opts.post) await markPosted(tx, v.id, actor);
    return { id: v.id, posted: !!opts.post };
  });
}

// A draft only. Company and branch never change; the number is kept unless the new date falls in another fiscal year.
export function updateVoucher(id: number, input: VoucherInput, actor: Actor, opts: Opts & LockOpts & { post?: boolean } = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const v = await lockVoucher(tx, id, input.companyId);
    if (v.isPosted) throw new HttpError(409, "A posted voucher cannot be edited. Reverse it and enter a correct one.");
    const problems = voucherProblems(input, input.lines);
    const dateProblem = problems.find((p) => p.field === "voucherDate");
    if (dateProblem) throw new HttpError(400, dateProblem.message, dateProblem.field);
    const date = parseDate(input.voucherDate, "voucherDate");
    await guardPeriod(tx, v.companyId, [date, v.voucherDate], opts.lockOverride, "voucherDate");
    const fy = await resolveFiscalYear(tx, v.companyId, date, input.fiscalYear);
    const lines = await checkedLines(tx, { ...input, companyId: v.companyId, branchId: v.branchId });
    await tx.update(S.cashBankVoucher).set({
      voucherDate: date, fiscalYear: fy.code, voucherNumber: fy.code === v.fiscalYear ? v.voucherNumber : await nextVoucherNumber(tx, v.branchId, fy.code),
      cashBankLedgerId: input.cashBankLedgerId, payeeReference: input.payeeReference?.trim() || null, remarks: input.remarks?.trim() || null,
    }).where(eq(S.cashBankVoucher.id, id));
    await tx.delete(S.cashBankVoucherLine).where(eq(S.cashBankVoucherLine.cashBankVoucherId, id));
    await insertLines(tx, id, lines);
    if (opts.post) await markPosted(tx, id, actor);
    return { id, posted: !!opts.post };
  });
}

export function deleteVoucher(id: number, companyId: number, actor: Actor, opts: Opts & LockOpts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const v = await lockVoucher(tx, id, companyId);
    if (v.isPosted) throw new HttpError(409, "A posted voucher cannot be deleted. Reverse it instead.");
    await guardPeriod(tx, companyId, [v.voucherDate], opts.lockOverride, "voucherDate");
    await tx.delete(S.cashBankVoucher).where(eq(S.cashBankVoucher.id, id));
    return { id, deleted: true as const };
  });
}

// Post a saved draft. The stored lines are checked again (a ledger may have been deactivated since the draft was saved).
export function postVoucher(id: number, companyId: number, actor: Actor, opts: Opts & LockOpts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const v = await lockVoucher(tx, id, companyId);
    if (v.isPosted) throw new HttpError(409, "This voucher is already posted.");
    if (!v.cashBankLedgerId) throw new HttpError(409, "This voucher has no cash / bank ledger; open it and choose one.", "cashBankLedgerId");
    await guardPeriod(tx, companyId, [v.voucherDate], opts.lockOverride, "voucherDate");
    await resolveFiscalYear(tx, companyId, v.voucherDate, v.fiscalYear);
    const lines = await tx.select().from(S.cashBankVoucherLine).where(eq(S.cashBankVoucherLine.cashBankVoucherId, id));
    if (!lines.some((l) => !l.isCashBankLine)) throw new HttpError(409, "A voucher with no entry lines cannot be posted.", "lines");
    const ledgerIds = [...new Set([v.cashBankLedgerId, ...lines.map((l) => l.generalLedgerId)])];
    const gls = await tx.select({ code: S.generalLedger.code, isActive: S.generalLedger.isActive }).from(S.generalLedger).where(inArray(S.generalLedger.id, ledgerIds));
    const off = gls.find((g) => !g.isActive);
    if (off) throw new HttpError(409, `Ledger ${off.code} is not active any more.`);
    await markPosted(tx, id, actor);
    return { id, posted: true as const };
  });
}

// REVERSE a posted voucher: a new posted voucher with every debit and credit swapped. The original is never edited. A reversal cannot
// itself be reversed, and a voucher is reversed once. `date` defaults to today; the reversal must fall in an open period.
export function reverseVoucher(id: number, companyId: number, actor: Actor, opts: Opts & LockOpts & { date?: string | Date; reason?: string | null } = {}) {
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    const orig = await lockVoucher(tx, id, companyId);
    if (!orig.isPosted) throw new HttpError(409, "Only a posted voucher can be reversed. Edit or delete a draft instead.");
    if (orig.reversalOfId) throw new HttpError(409, "A reversal cannot itself be reversed.");
    const [already] = await tx.select({ id: S.cashBankVoucher.id }).from(S.cashBankVoucher).where(and(eq(S.cashBankVoucher.reversalOfId, id), eq(S.cashBankVoucher.isPosted, true)));
    if (already) throw new HttpError(409, "This voucher has already been reversed.");
    const date = opts.date ? parseDate(opts.date, "date") : parseDate(today(), "date");
    await guardPeriod(tx, companyId, [date], opts.lockOverride, "date");
    const fy = await resolveFiscalYear(tx, companyId, date);
    const stored = await tx.select().from(S.cashBankVoucherLine).where(eq(S.cashBankVoucherLine.cashBankVoucherId, id)).orderBy(asc(S.cashBankVoucherLine.lineNumber));
    const lines = swapSides(stored.map((l): JournalLine => ({
      generalLedgerId: l.generalLedgerId, subLedgerId: l.subLedgerId, debit: paise(l.debit), credit: paise(l.credit), narration: l.narration, isCashBankLine: l.isCashBankLine,
      instrumentType: l.instrumentType, chequeNumber: l.chequeNumber, chequeDate: day(l.chequeDate),
    })));
    const [r] = await tx.insert(S.cashBankVoucher).values({
      companyId, branchId: orig.branchId, voucherNumber: `R-${orig.voucherNumber}`.slice(0, 30), voucherDate: date, fiscalYear: fy.code,
      cashBankLedgerId: orig.cashBankLedgerId, payeeReference: orig.payeeReference,
      remarks: `Reversal of ${orig.voucherNumber}${opts.reason?.trim() ? `: ${opts.reason.trim()}` : ""}`.slice(0, 1024), reversalOfId: orig.id, createdBy: actor.userId,
    }).returning({ id: S.cashBankVoucher.id });
    await insertLines(tx, r.id, lines);
    await markPosted(tx, r.id, actor);
    return { id: r.id, reversalOfId: orig.id };
  });
}

// ---------- balances ----------
// Net balance (debit minus credit, in paisa) of one ledger in a branch and fiscal year up to and including `asOf`: the opening balance
// plus every POSTED journal and cash/bank voucher line. Drafts do not count; `excludeVoucherId` leaves out the voucher being looked at,
// so its own opening balance does not include itself. Ledger level only (journal lines carry no sub-ledger).
export async function ledgerBalance(tx: Pick<Tx, "execute">, o: { companyId: number; branchId: number; fiscalYear: string; generalLedgerId: number; asOf: Date; excludeVoucherId?: number | null }): Promise<bigint> {
  const asOf = day(o.asOf)!;
  const r = (await tx.execute(sql`
    select (
      coalesce((select sum(ob."debit" - ob."credit") from "OpeningBalance" ob join "FiscalYear" fy on fy.id = ob."fiscalYearId"
                 where ob."companyId" = ${o.companyId} and ob."branchId" = ${o.branchId} and fy."code" = ${o.fiscalYear} and fy."companyId" = ${o.companyId} and ob."generalLedgerId" = ${o.generalLedgerId}), 0)
    + coalesce((select sum(l."debit" - l."credit") from "JournalVoucherLine" l join "JournalVoucher" v on v.id = l."journalVoucherId"
                 where v."companyId" = ${o.companyId} and v."branchId" = ${o.branchId} and v."fiscalYear" = ${o.fiscalYear} and v."isPosted" and v."voucherDate" <= ${asOf}::date and l."generalLedgerId" = ${o.generalLedgerId}), 0)
    + coalesce((select sum(l."debit" - l."credit") from "CashBankVoucherLine" l join "CashBankVoucher" v on v.id = l."cashBankVoucherId"
                 where v."companyId" = ${o.companyId} and v."branchId" = ${o.branchId} and v."fiscalYear" = ${o.fiscalYear} and v."isPosted" and v."voucherDate" <= ${asOf}::date and l."generalLedgerId" = ${o.generalLedgerId}
                   and (${o.excludeVoucherId ?? null}::int is null or v.id <> ${o.excludeVoucherId ?? null}::int)), 0)
    )::text as net`)) as any[];
  return signedPaise(r[0].net);
}

export async function balanceOf(o: { companyId: number; branchId: number; fiscalYear: string; generalLedgerId: number; asOf: string | Date; excludeVoucherId?: number | null }) {
  const [gl] = await db.select({ id: S.generalLedger.id }).from(S.generalLedger).where(and(eq(S.generalLedger.id, o.generalLedgerId), eq(S.generalLedger.companyId, o.companyId)));
  if (!gl) throw new HttpError(404, "Ledger not found in this company.", "generalLedgerId");
  const net = await ledgerBalance(db, { ...o, asOf: parseDate(o.asOf, "date") });
  return { net: formatPaise(net), side: net < 0n ? ("CR" as const) : ("DR" as const), amount: formatPaise(net < 0n ? -net : net) };
}

// ---------- read ----------
export async function getVoucher(id: number, companyId: number) {
  const cb = S.cashBankVoucher, gl = S.generalLedger;
  const [v] = await db.select({ v: cb, bankCode: gl.code, bankName: gl.name }).from(cb).leftJoin(gl, eq(gl.id, cb.cashBankLedgerId)).where(and(eq(cb.id, id), eq(cb.companyId, companyId)));
  if (!v) throw new HttpError(404, "Voucher not found.");
  const h = v.v;
  const rows = await db.select({ l: S.cashBankVoucherLine, code: gl.code, name: gl.name, glType: gl.glType, subCode: S.subLedger.code, subName: S.subLedger.name })
    .from(S.cashBankVoucherLine).innerJoin(gl, eq(gl.id, S.cashBankVoucherLine.generalLedgerId)).leftJoin(S.subLedger, eq(S.subLedger.id, S.cashBankVoucherLine.subLedgerId))
    .where(eq(S.cashBankVoucherLine.cashBankVoucherId, id)).orderBy(asc(S.cashBankVoucherLine.lineNumber));
  const entries = rows.filter((r) => !r.l.isCashBankLine).map((r) => ({
    id: r.l.id, lineNumber: r.l.lineNumber, generalLedgerId: r.l.generalLedgerId, code: r.code, name: r.name, glType: r.glType,
    subLedgerId: r.l.subLedgerId, subLedgerCode: r.subCode, subLedgerName: r.subName,
    receipt: paise(r.l.credit) > 0n ? money(r.l.credit) : "", payment: paise(r.l.debit) > 0n ? money(r.l.debit) : "", narration: r.l.narration ?? "",
  }));
  const bankLine = rows.find((r) => r.l.isCashBankLine)?.l;
  const receipts = rows.filter((r) => !r.l.isCashBankLine).reduce((a, r) => a + paise(r.l.credit), 0n);
  const payments = rows.filter((r) => !r.l.isCashBankLine).reduce((a, r) => a + paise(r.l.debit), 0n);
  const [rev] = await db.select({ id: cb.id, voucherNumber: cb.voucherNumber }).from(cb).where(and(eq(cb.reversalOfId, id), eq(cb.isPosted, true)));
  const opening = h.cashBankLedgerId
    ? await ledgerBalance(db, { companyId, branchId: h.branchId, fiscalYear: h.fiscalYear, generalLedgerId: h.cashBankLedgerId, asOf: h.voucherDate, excludeVoucherId: id })
    : 0n;
  return {
    id: h.id, companyId: h.companyId, branchId: h.branchId, voucherNumber: h.voucherNumber, voucherDate: day(h.voucherDate)!, fiscalYear: h.fiscalYear,
    status: !h.isPosted ? ("DRAFT" as const) : rev ? ("REVERSED" as const) : ("POSTED" as const), isPosted: h.isPosted, isReversal: !!h.reversalOfId,
    reversalOfId: h.reversalOfId, reversedById: rev?.id ?? null, reversedByNumber: rev?.voucherNumber ?? null,
    cashBankLedgerId: h.cashBankLedgerId, cashBankSubLedgerId: bankLine?.subLedgerId ?? null, cashBankLedgerCode: v.bankCode, cashBankLedgerName: v.bankName,
    instrumentType: bankLine?.instrumentType ?? null, chequeNumber: bankLine?.chequeNumber ?? null, chequeDate: day(bankLine?.chequeDate), payeeReference: h.payeeReference ?? "", remarks: h.remarks ?? "",
    entries, lines: entries, totalReceipts: formatPaise(receipts), totalPayments: formatPaise(payments),
    openingBalance: formatPaise(opening), closingBalance: formatPaise(opening + receipts - payments),
    postedAt: h.postedAt, postedBy: h.postedBy,
  };
}

export type VoucherFilter = { companyId: number; branchId?: number; fiscalYear?: string; status?: string; search?: string; limit?: number };

export async function listVouchers(f: VoucherFilter) {
  const limit = Math.min(Math.max(f.limit ?? 200, 1), 500);
  const like = f.search?.trim() ? `%${f.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = sql`v."companyId" = ${f.companyId}
    ${f.branchId ? sql`and v."branchId" = ${f.branchId}` : sql``}
    ${f.fiscalYear ? sql`and v."fiscalYear" = ${f.fiscalYear}` : sql``}
    ${f.status === "DRAFT" ? sql`and not v."isPosted"` : f.status === "POSTED" ? sql`and v."isPosted" and not exists (select 1 from "CashBankVoucher" r where r."reversalOfId" = v.id and r."isPosted")` : f.status === "REVERSED" ? sql`and v."isPosted" and exists (select 1 from "CashBankVoucher" r where r."reversalOfId" = v.id and r."isPosted")` : sql``}
    ${like ? sql`and (v."voucherNumber" ilike ${like} or v."payeeReference" ilike ${like} or v."remarks" ilike ${like} or g."name" ilike ${like})` : sql``}`;
  const total = (await db.execute(sql`select count(*)::int as n from "CashBankVoucher" v left join "GeneralLedger" g on g.id = v."cashBankLedgerId" where ${where}`)) as any[];
  const rows = (await db.execute(sql`
    select v.id, v."branchId", v."voucherNumber", to_char(v."voucherDate", 'YYYY-MM-DD') as "voucherDate", v."fiscalYear", v."isPosted", v."reversalOfId", g."name" as "cashBankLedgerName", v."payeeReference",
           exists (select 1 from "CashBankVoucher" r where r."reversalOfId" = v.id and r."isPosted") as "isReversed",
           coalesce((select sum(l."credit") from "CashBankVoucherLine" l where l."cashBankVoucherId" = v.id and not l."isCashBankLine"), 0)::text as "totalReceipts",
           coalesce((select sum(l."debit") from "CashBankVoucherLine" l where l."cashBankVoucherId" = v.id and not l."isCashBankLine"), 0)::text as "totalPayments"
      from "CashBankVoucher" v left join "GeneralLedger" g on g.id = v."cashBankLedgerId"
     where ${where} order by v."voucherDate" desc, v.id desc limit ${limit}`)) as any[];
  return {
    total: total[0].n as number,
    rows: rows.map((r) => ({
      id: r.id as number, branchId: r.branchId as number, voucherNumber: r.voucherNumber as string, voucherDate: r.voucherDate as string, fiscalYear: r.fiscalYear as string,
      status: !r.isPosted ? "DRAFT" : r.isReversed ? "REVERSED" : "POSTED", isReversal: !!r.reversalOfId, cashBankLedgerName: (r.cashBankLedgerName ?? "") as string, payeeReference: (r.payeeReference ?? "") as string,
      totalReceipts: money(r.totalReceipts), totalPayments: money(r.totalPayments),
    })),
  };
}

// What the form needs to offer: the cash/bank ledgers, every account an entry may use, their sub-ledgers and the fiscal years.
export async function voucherLookups(companyId: number) {
  const gl = S.generalLedger;
  const [ledgers, subs, years] = await Promise.all([
    db.select({ id: gl.id, code: gl.code, name: gl.name, glType: gl.glType, requiresSubLedger: gl.requiresSubLedger, isCashOrBank: gl.isCashOrBank, isActive: gl.isActive }).from(gl).where(eq(gl.companyId, companyId)).orderBy(asc(gl.code)),
    db.select({ id: S.subLedger.id, code: S.subLedger.code, name: S.subLedger.name, generalLedgerId: S.subLedger.generalLedgerId, isActive: S.subLedger.isActive })
      .from(S.subLedger).innerJoin(gl, eq(gl.id, S.subLedger.generalLedgerId)).where(eq(gl.companyId, companyId)).orderBy(asc(S.subLedger.code)),
    db.select({ id: S.fiscalYear.id, code: S.fiscalYear.code, startDate: S.fiscalYear.startDate, endDate: S.fiscalYear.endDate, isActive: S.fiscalYear.isActive, isClosed: S.fiscalYear.isClosed, isCurrent: S.fiscalYear.isCurrent })
      .from(S.fiscalYear).where(eq(S.fiscalYear.companyId, companyId)).orderBy(asc(S.fiscalYear.startDate)),
  ]);
  return {
    cashBankLedgers: ledgers.filter((l) => l.isCashOrBank), ledgers, subLedgers: subs,
    fiscalYears: years.map((y) => ({ ...y, startDate: day(y.startDate)!, endDate: day(y.endDate)! })),
  };
}
