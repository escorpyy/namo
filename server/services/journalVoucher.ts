import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { withInitialPostedChildInsert } from "../db/audit";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { numberForSave } from "./numberSeries";
import { guardPeriod, type LockOverride } from "./periodLock";
import { type Actor, type Opts, type Tx, assertBranch, inActorTx, parseDate, resolveFiscalYear, today } from "./purchase/common";
import { ZERO, fmt, toMicro, type Micro } from "./purchase/money";

// JOURNAL VOUCHER: a hand-made accounting entry that touches no cash or bank ledger (those go through a Cash/Bank voucher).
//
//   save (draft: lines must already balance, the database insists) ─▶ post (Dr = Cr, open fiscal year, after the lock date) ─▶ edit with a reason / reverse
//
// One voucher, one remarks, many lines; each line is a ledger (and, for a control ledger such as Debtors or Creditors, a party
// sub-ledger), an optional agent, ONE side (Dr or Cr) and a narration. The database also refuses an unbalanced voucher at commit
// (migration 0007); the checks here give the person a readable message first.
//
// Vouchers made by other modules (a purchase bill, a cost assessment) are listed but never edited here: they are changed from
// the document that made them.

export type JvLineInput = {
  generalLedgerId: number;
  subLedgerId?: number | null;
  agentId?: number | null;
  debit?: string | number | null;
  credit?: string | number | null;
  narration?: string | null;
};
export type JournalVoucherInput = {
  id?: number; // present = edit this voucher
  companyId: number;
  branchId: number;
  voucherNumber?: string;
  numberSeriesId?: number | null;
  voucherDate: string | Date;
  fiscalYear?: string;
  remarks?: string | null;
  lines: JvLineInput[];
};
type LockOpts = { lockOverride?: LockOverride | null };

export const JV_STATES = ["DRAFT", "POSTED", "REVERSED", "REVERSAL"] as const;
const MAX_REMARKS = 1024, MAX_NARRATION = 500;
const CENT = 10_000n; // Micro has 6 decimals, a voucher amount has 2
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const money = (v: string | null | undefined) => fmt(toMicro(v), 2);

// ---------------------------------------------------------------------------------------------------------------------------
// WHO MADE THE VOUCHER
// ---------------------------------------------------------------------------------------------------------------------------
// A voucher written by the purchase bill (or its reversal) or by an import-cost assessment belongs to that document.
async function sourceOf(tx: Tx, id: number): Promise<string | null> {
  const [b] = await tx.select({ n: S.purchaseBill.invoiceNumber }).from(S.purchaseBill).where(eq(S.purchaseBill.journalVoucherId, id)).limit(1);
  if (b) return `Purchase bill ${b.n}`;
  const [a] = await tx.select({ n: S.purchaseImportAssessment.assessmentNumber }).from(S.purchaseImportAssessment)
    .where(or(eq(S.purchaseImportAssessment.journalVoucherId, id), eq(S.purchaseImportAssessment.reversalVoucherId, id))).limit(1);
  if (a) return `Import cost assessment ${a.n}`;
  return null;
}

async function lockVoucher(tx: Tx, id: number, companyId?: number | null) {
  const [v] = await tx.select().from(S.journalVoucher).where(eq(S.journalVoucher.id, id)).for("update");
  if (!v || (companyId && v.companyId !== companyId)) throw new HttpError(404, "Journal voucher not found.");
  return v;
}
async function reversalOf(tx: Tx, id: number) {
  const [r] = await tx.select({ id: S.journalVoucher.id, voucherNumber: S.journalVoucher.voucherNumber }).from(S.journalVoucher)
    .where(and(eq(S.journalVoucher.reversalOfId, id), eq(S.journalVoucher.isPosted, true))).limit(1);
  return r ?? null;
}
async function assertOwnVoucher(tx: Tx, v: typeof S.journalVoucher.$inferSelect) {
  const src = await sourceOf(tx, v.id);
  if (src) throw new HttpError(409, `This voucher was made by ${src}. Change it from that document.`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// LINES
// ---------------------------------------------------------------------------------------------------------------------------
type Resolved = { generalLedgerId: number; subLedgerId: number | null; agentId: number | null; debit: Micro; credit: Micro; narration: string | null; requiresSub: boolean; code: string };

const isBlank = (l: JvLineInput) =>
  !l.generalLedgerId && !l.subLedgerId && !l.agentId && toMicroSafe(l.debit) === ZERO && toMicroSafe(l.credit) === ZERO && !(l.narration ?? "").trim();
function toMicroSafe(v: unknown): Micro { return v === null || v === undefined || v === "" ? ZERO : toMicro(v as string | number); }

function amountOf(v: unknown, label: string, field: string): Micro {
  const m = toMicroSafe(v);
  if (m < ZERO) throw new HttpError(400, `${label} cannot be negative.`, field);
  if (m % CENT !== ZERO) throw new HttpError(400, `${label} can have at most 2 decimals.`, field);
  if (m > 999_999_999_999n * 1_000_000n) throw new HttpError(400, `${label} is too large.`, field);
  return m;
}

async function resolveLines(tx: Tx, companyId: number, input: JvLineInput[]): Promise<Resolved[]> {
  const out: Resolved[] = [];
  const glCache = new Map<number, typeof S.generalLedger.$inferSelect | null>();
  let n = 0;
  for (const raw of input) {
    if (isBlank(raw)) continue;
    n++;
    const at = `Line ${n}`;
    if (!raw.generalLedgerId) throw new HttpError(400, `${at}: pick the ledger.`, "lines");
    let gl = glCache.get(raw.generalLedgerId);
    if (gl === undefined) {
      [gl = null] = await tx.select().from(S.generalLedger).where(and(eq(S.generalLedger.id, raw.generalLedgerId), eq(S.generalLedger.companyId, companyId)));
      glCache.set(raw.generalLedgerId, gl);
    }
    if (!gl) throw new HttpError(404, `${at}: ledger not found in this company.`, "lines");
    if (!gl.isActive) throw new HttpError(409, `${at}: ledger ${gl.code} is not active.`, "lines");
    if (gl.isCashOrBank) throw new HttpError(409, `${at}: ${gl.code} is a cash/bank ledger. Use a Cash/Bank voucher for it.`, "lines");

    let subLedgerId: number | null = null;
    if (raw.subLedgerId) {
      const [sl] = await tx.select().from(S.subLedger).where(eq(S.subLedger.id, raw.subLedgerId));
      if (!sl || sl.generalLedgerId !== gl.id) throw new HttpError(400, `${at}: that party does not belong to ledger ${gl.code}.`, "lines");
      if (!sl.isActive) throw new HttpError(409, `${at}: party ${sl.code} is not active.`, "lines");
      subLedgerId = sl.id;
    }
    let agentId: number | null = null;
    if (raw.agentId) {
      const [ag] = await tx.select({ id: S.agent.id, isActive: S.agent.isActive, code: S.agent.code }).from(S.agent).where(and(eq(S.agent.id, raw.agentId), eq(S.agent.companyId, companyId)));
      if (!ag) throw new HttpError(404, `${at}: agent not found in this company.`, "lines");
      if (!ag.isActive) throw new HttpError(409, `${at}: agent ${ag.code} is not active.`, "lines");
      agentId = ag.id;
    }
    const debit = amountOf(raw.debit, `${at}: Dr`, "lines"), credit = amountOf(raw.credit, `${at}: Cr`, "lines");
    if (debit > ZERO && credit > ZERO) throw new HttpError(400, `${at}: enter Dr or Cr, not both.`, "lines");
    if (debit === ZERO && credit === ZERO) throw new HttpError(400, `${at}: enter an amount in Dr or Cr.`, "lines");
    const narration = (raw.narration ?? "").trim() || null;
    if (narration && narration.length > MAX_NARRATION) throw new HttpError(400, `${at}: narration can be at most ${MAX_NARRATION} characters.`, "lines");
    out.push({ generalLedgerId: gl.id, subLedgerId, agentId, debit, credit, narration, requiresSub: gl.requiresSubLedger, code: gl.code });
  }
  return out;
}

// What must be true of a voucher that is posted (or a posted voucher after an edit).
function assertPostable(lines: Resolved[]) {
  if (lines.length < 2) throw new HttpError(409, "A voucher needs at least two lines.", "lines");
  lines.forEach((l, i) => { if (l.requiresSub && !l.subLedgerId) throw new HttpError(409, `Line ${i + 1}: ledger ${l.code} needs a party (sub-ledger).`, "lines"); });
  const dr = lines.reduce((a, l) => a + l.debit, ZERO), cr = lines.reduce((a, l) => a + l.credit, ZERO);
  if (dr !== cr) throw new HttpError(409, `The voucher does not balance: Dr ${fmt(dr, 2)}, Cr ${fmt(cr, 2)} (difference ${fmt(dr > cr ? dr - cr : cr - dr, 2)}).`, "lines");
  if (dr === ZERO) throw new HttpError(409, "The voucher total must be more than zero.", "lines");
}

async function writeLines(tx: Tx, voucherId: number, lines: Resolved[], initiallyPosted: boolean) {
  const write = async () => {
    let n = 1;
    for (const l of lines) {
      await tx.insert(S.journalVoucherLine).values({
        journalVoucherId: voucherId, lineNumber: n++, generalLedgerId: l.generalLedgerId, subLedgerId: l.subLedgerId, agentId: l.agentId,
        debit: fmt(l.debit, 2), credit: fmt(l.credit, 2), narration: l.narration,
      });
    }
  };
  if (initiallyPosted) await withInitialPostedChildInsert(tx, "JournalVoucherLine", voucherId, write);
  else await write();
}

const reasonOf = (r: string | null | undefined) => (r ?? "").trim();
function needReason(r: string | null | undefined, what: string): string {
  const t = reasonOf(r);
  if (!t) throw new HttpError(400, `Give a reason for ${what}.`, "reason");
  if (t.length > 500) throw new HttpError(400, "The reason can be at most 500 characters.", "reason");
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------------
// SAVE (create / edit)
// ---------------------------------------------------------------------------------------------------------------------------
export function saveJournalVoucher(input: JournalVoucherInput, actor: Actor, opts: Opts & LockOpts & { reason?: string } = {}) {
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    await assertBranch(tx, input.companyId, input.branchId);
    const date = parseDate(input.voucherDate, "voucherDate");
    const remarks = (input.remarks ?? "").trim() || null;
    if (remarks && remarks.length > MAX_REMARKS) throw new HttpError(400, `Remarks can be at most ${MAX_REMARKS} characters.`, "remarks");

    let existing: typeof S.journalVoucher.$inferSelect | null = null;
    if (input.id) {
      existing = await lockVoucher(tx, input.id, input.companyId);
      if (existing.branchId !== input.branchId) throw new HttpError(409, "A voucher cannot move to another branch.", "branchId");
      await assertOwnVoucher(tx, existing);
      if (existing.reversalOfId) throw new HttpError(409, "A reversal voucher cannot be changed.");
      if (existing.isPosted) {
        if (await reversalOf(tx, existing.id)) throw new HttpError(409, "This voucher has been reversed and cannot be changed.");
        needReason(opts.reason, "changing a posted voucher");
      }
    }
    await guardPeriod(tx, input.companyId, existing ? [existing.voucherDate, date] : [date], opts.lockOverride, "voucherDate");
    const fy = await resolveFiscalYear(tx, input.companyId, date, input.fiscalYear ?? null);
    const lines = await resolveLines(tx, input.companyId, input.lines ?? []);
    if (existing?.isPosted) assertPostable(lines);
    // The database refuses ANY voucher whose lines do not balance at commit (drafts too, migration 0007): say so in plain words first.
    const sumDr = lines.reduce((a, l) => a + l.debit, ZERO), sumCr = lines.reduce((a, l) => a + l.credit, ZERO);
    if (sumDr !== sumCr) throw new HttpError(409, `The voucher does not balance: Dr ${fmt(sumDr, 2)}, Cr ${fmt(sumCr, 2)} (difference ${fmt(sumDr > sumCr ? sumDr - sumCr : sumCr - sumDr, 2)}). Make Dr equal Cr to save.`, "lines");

    // A voucher moved into another fiscal year starts that year's numbering; the old number belongs to the old year's sequence.
    const keeps = !!existing && existing.fiscalYear === fy.code;
    const numbered = await numberForSave(tx, {
      companyId: input.companyId, userId: actor.userId, documentType: "JOURNAL_VOUCHER", seriesId: input.numberSeriesId, typed: input.voucherNumber,
      branchId: input.branchId, fiscalYear: fy.code, existing: keeps ? { number: existing!.voucherNumber, numberSeriesId: existing!.numberSeriesId } : null,
    });
    if (numbered.number.length > 30) throw new HttpError(400, "The voucher number can be at most 30 characters.", "voucherNumber");

    const header = { voucherNumber: numbered.number, numberSeriesId: numbered.seriesId, voucherDate: date, fiscalYear: fy.code, remarks, updatedAt: new Date() };
    let id: number;
    if (existing) {
      id = existing.id;
      await tx.update(S.journalVoucher).set(header).where(eq(S.journalVoucher.id, id));
      await tx.delete(S.journalVoucherLine).where(eq(S.journalVoucherLine.journalVoucherId, id));
    } else {
      const [v] = await tx.insert(S.journalVoucher).values({ ...header, companyId: input.companyId, branchId: input.branchId, createdBy: actor.userId }).returning({ id: S.journalVoucher.id });
      id = v.id;
    }
    await writeLines(tx, id, lines, false);
    const dr = lines.reduce((a, l) => a + l.debit, ZERO), cr = lines.reduce((a, l) => a + l.credit, ZERO);
    return { id, voucherNumber: numbered.number, fiscalYear: fy.code, isPosted: !!existing?.isPosted, debit: fmt(dr, 2), credit: fmt(cr, 2), balanced: dr === cr };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------------------------------------------------------
export function postJournalVoucher(id: number, companyId: number | null, actor: Actor, opts: Opts & LockOpts = {}) {
  return inActorTx(actor, opts.tx, async (tx) => {
    const v = await lockVoucher(tx, id, companyId);
    await assertOwnVoucher(tx, v);
    if (v.isPosted) throw new HttpError(409, "This voucher is already posted.");
    await guardPeriod(tx, v.companyId, [v.voucherDate], opts.lockOverride, "voucherDate");
    await resolveFiscalYear(tx, v.companyId, v.voucherDate, v.fiscalYear);
    const stored = await tx.select().from(S.journalVoucherLine).where(eq(S.journalVoucherLine.journalVoucherId, id)).orderBy(asc(S.journalVoucherLine.lineNumber));
    // check again as if freshly entered: a ledger may have been deactivated or turned into a cash ledger since the draft was saved
    const lines = await resolveLines(tx, v.companyId, stored.map((l) => ({ generalLedgerId: l.generalLedgerId, subLedgerId: l.subLedgerId, agentId: l.agentId, debit: l.debit, credit: l.credit, narration: l.narration })));
    assertPostable(lines);
    await tx.update(S.journalVoucher).set({ isPosted: true, postedAt: new Date(), postedBy: actor.userId, updatedAt: new Date() }).where(eq(S.journalVoucher.id, id));
    const dr = lines.reduce((a, l) => a + l.debit, ZERO);
    return { id, voucherNumber: v.voucherNumber, isPosted: true as const, total: fmt(dr, 2) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// DELETE: a draft goes freely; a posted voucher needs a reason and an open period, and is audit-logged
// ---------------------------------------------------------------------------------------------------------------------------
export function deleteJournalVoucher(id: number, companyId: number | null, actor: Actor, opts: Opts & LockOpts & { reason?: string } = {}) {
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    const v = await lockVoucher(tx, id, companyId);
    await assertOwnVoucher(tx, v);
    if (v.isPosted) {
      if (v.reversalOfId) throw new HttpError(409, "A reversal voucher cannot be deleted.");
      if (await reversalOf(tx, id)) throw new HttpError(409, "This voucher has been reversed and cannot be deleted.");
      needReason(opts.reason, "deleting a posted voucher");
    }
    await guardPeriod(tx, v.companyId, [v.voucherDate], opts.lockOverride, "voucherDate");
    await tx.delete(S.journalVoucher).where(eq(S.journalVoucher.id, id));
    return { id, deleted: true as const };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// REVERSE: a new voucher with Dr and Cr swapped; the original is never changed
// ---------------------------------------------------------------------------------------------------------------------------
export function reverseJournalVoucher(id: number, companyId: number | null, actor: Actor, opts: Opts & LockOpts & { date?: string | Date; reason?: string } = {}) {
  return inActorTx({ ...actor, reason: opts.reason }, opts.tx, async (tx) => {
    const orig = await lockVoucher(tx, id, companyId);
    await assertOwnVoucher(tx, orig);
    if (!orig.isPosted) throw new HttpError(409, "Only a posted voucher can be reversed. Edit or delete a draft instead.");
    if (orig.reversalOfId) throw new HttpError(409, "A reversal cannot itself be reversed.");
    if (await reversalOf(tx, id)) throw new HttpError(409, "This voucher has already been reversed.");
    const date = opts.date ? parseDate(opts.date, "date") : today();
    if (date.getTime() < orig.voucherDate.getTime()) throw new HttpError(400, "A reversal cannot be dated before the voucher it reverses.", "date");
    // The original is never edited, so it is the reversal's own date that has to be open.
    await guardPeriod(tx, orig.companyId, [date], opts.lockOverride, "date");
    const fy = await resolveFiscalYear(tx, orig.companyId, date, null);

    const olines = await tx.select().from(S.journalVoucherLine).where(eq(S.journalVoucherLine.journalVoucherId, id)).orderBy(asc(S.journalVoucherLine.lineNumber));
    let number = `R-${orig.voucherNumber}`.slice(0, 30), k = 1;
    while ((await tx.select({ id: S.journalVoucher.id }).from(S.journalVoucher).where(and(eq(S.journalVoucher.branchId, orig.branchId), eq(S.journalVoucher.voucherNumber, number)))).length) {
      number = `R${++k}-${orig.voucherNumber}`.slice(0, 30);
    }
    const reason = reasonOf(opts.reason);
    const [rv] = await tx.insert(S.journalVoucher).values({
      companyId: orig.companyId, branchId: orig.branchId, voucherNumber: number, voucherDate: date, fiscalYear: fy.code,
      remarks: `Reversal of ${orig.voucherNumber}${reason ? `: ${reason}` : ""}`.slice(0, MAX_REMARKS), reversalOfId: orig.id,
      isPosted: true, postedAt: new Date(), postedBy: actor.userId, createdBy: actor.userId,
    }).returning({ id: S.journalVoucher.id });
    await withInitialPostedChildInsert(tx, "JournalVoucherLine", rv.id, async () => {
      for (const l of olines) {
        await tx.insert(S.journalVoucherLine).values({
          journalVoucherId: rv.id, lineNumber: l.lineNumber, generalLedgerId: l.generalLedgerId, subLedgerId: l.subLedgerId, agentId: l.agentId,
          debit: l.credit, credit: l.debit, narration: `Reversal: ${l.narration ?? ""}`.trim().slice(0, MAX_NARRATION),
        });
      }
    });
    return { reversalVoucherId: rv.id, voucherNumber: number };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------
// READ SIDE
// ---------------------------------------------------------------------------------------------------------------------------
const snapshot = <T>(fn: (tx: Tx) => Promise<T>): Promise<T> => db.transaction(fn, { isolationLevel: "repeatable read", accessMode: "read only" });

export type JvListFilter = { companyId: number; branchId?: number; fiscalYear?: string; status?: string; search?: string; limit?: number };

export async function listJournalVouchers(f: JvListFilter) {
  const V = S.journalVoucher;
  const vid = sql.raw('"JournalVoucher"."id"'); // qualified: inside a sub-select a bare "id" would mean that sub-select's own table
  const where: (SQL | undefined)[] = [eq(V.companyId, f.companyId)];
  if (f.branchId) where.push(eq(V.branchId, f.branchId));
  if (f.fiscalYear) where.push(eq(V.fiscalYear, f.fiscalYear));
  const reversedExists = sql`exists (select 1 from "JournalVoucher" r where r."reversalOfId" = ${vid} and r."isPosted")`;
  if (f.status) {
    if (!(JV_STATES as readonly string[]).includes(f.status)) throw new HttpError(400, `Unknown voucher status ${f.status}.`, "status");
    if (f.status === "DRAFT") where.push(eq(V.isPosted, false));
    else if (f.status === "REVERSAL") where.push(sql`${V.reversalOfId} is not null`);
    else if (f.status === "REVERSED") where.push(and(eq(V.isPosted, true), sql`${V.reversalOfId} is null`, reversedExists));
    else where.push(and(eq(V.isPosted, true), sql`${V.reversalOfId} is null`, sql`not ${reversedExists}`));
  }
  if (f.search?.trim()) {
    const s = like(f.search.trim());
    where.push(or(ilike(V.voucherNumber, s), ilike(V.remarks, s), sql`exists (select 1 from "JournalVoucherLine" l where l."journalVoucherId" = ${vid} and l.narration ilike ${s})`));
  }
  const limit = Math.min(Math.max(Math.trunc(f.limit ?? 300), 1), 1000);
  return snapshot(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(V).where(and(...where));
    const rows = await tx.select({
      id: V.id, branchId: V.branchId, voucherNumber: V.voucherNumber, voucherDate: V.voucherDate, fiscalYear: V.fiscalYear, remarks: V.remarks, isPosted: V.isPosted, reversalOfId: V.reversalOfId,
      lineCount: sql<number>`(select count(*)::int from "JournalVoucherLine" l where l."journalVoucherId" = ${vid})`,
      totalDebit: sql<string>`coalesce((select sum(l.debit) from "JournalVoucherLine" l where l."journalVoucherId" = ${vid}), 0)::text`,
      reversed: sql<boolean>`${reversedExists}`,
      source: sql<string | null>`coalesce(
        (select 'Purchase bill ' || b."invoiceNumber" from "PurchaseBill" b where b."journalVoucherId" = ${vid} limit 1),
        (select 'Import cost assessment ' || a."assessmentNumber" from "PurchaseImportAssessment" a where a."journalVoucherId" = ${vid} or a."reversalVoucherId" = ${vid} limit 1))`,
    }).from(V).where(and(...where)).orderBy(desc(V.voucherDate), desc(V.id)).limit(limit);
    return {
      total: n,
      rows: rows.map((r) => ({
        id: r.id, branchId: r.branchId, voucherNumber: r.voucherNumber, voucherDate: iso(r.voucherDate), fiscalYear: r.fiscalYear, remarks: r.remarks,
        state: !r.isPosted ? "DRAFT" : r.reversalOfId ? "REVERSAL" : r.reversed ? "REVERSED" : "POSTED",
        lineCount: r.lineCount, totalAmount: money(r.totalDebit), source: r.source,
      })),
    };
  });
}

export async function getJournalVoucher(id: number, companyId: number) {
  return snapshot(async (tx) => {
    const [v] = await tx.select().from(S.journalVoucher).where(and(eq(S.journalVoucher.id, id), eq(S.journalVoucher.companyId, companyId)));
    if (!v) throw new HttpError(404, "Journal voucher not found.");
    const lines = await tx.select({
      id: S.journalVoucherLine.id, lineNumber: S.journalVoucherLine.lineNumber, generalLedgerId: S.journalVoucherLine.generalLedgerId, glCode: S.generalLedger.code, glName: S.generalLedger.name,
      subLedgerId: S.journalVoucherLine.subLedgerId, subCode: S.subLedger.code, subName: S.subLedger.name, agentId: S.journalVoucherLine.agentId, agentName: S.agent.name,
      debit: S.journalVoucherLine.debit, credit: S.journalVoucherLine.credit, narration: S.journalVoucherLine.narration,
    }).from(S.journalVoucherLine)
      .innerJoin(S.generalLedger, eq(S.generalLedger.id, S.journalVoucherLine.generalLedgerId))
      .leftJoin(S.subLedger, eq(S.subLedger.id, S.journalVoucherLine.subLedgerId))
      .leftJoin(S.agent, eq(S.agent.id, S.journalVoucherLine.agentId))
      .where(eq(S.journalVoucherLine.journalVoucherId, id)).orderBy(asc(S.journalVoucherLine.lineNumber));
    const source = await sourceOf(tx, id);
    const reversedBy = v.isPosted ? await reversalOf(tx, id) : null;
    const [orig] = v.reversalOfId ? await tx.select({ id: S.journalVoucher.id, voucherNumber: S.journalVoucher.voucherNumber }).from(S.journalVoucher).where(eq(S.journalVoucher.id, v.reversalOfId)) : [];
    const dr = lines.reduce((a, l) => a + toMicro(l.debit), ZERO), cr = lines.reduce((a, l) => a + toMicro(l.credit), ZERO);
    const state = !v.isPosted ? "DRAFT" : v.reversalOfId ? "REVERSAL" : reversedBy ? "REVERSED" : "POSTED";
    const final = !!source || !!v.reversalOfId || !!reversedBy;
    return {
      id: v.id, companyId: v.companyId, branchId: v.branchId, voucherNumber: v.voucherNumber, numberSeriesId: v.numberSeriesId, voucherDate: iso(v.voucherDate), fiscalYear: v.fiscalYear,
      remarks: v.remarks, isPosted: v.isPosted, postedAt: v.postedAt?.toISOString() ?? null, state, source, reversalOf: orig ?? null, reversedBy,
      totalDebit: fmt(dr, 2), totalCredit: fmt(cr, 2),
      editable: !final, deletable: !final, reversible: v.isPosted && !final,
      lines: lines.map((l) => ({
        id: l.id, lineNumber: l.lineNumber, generalLedgerId: l.generalLedgerId, glCode: l.glCode, glName: l.glName, subLedgerId: l.subLedgerId, subCode: l.subCode, subName: l.subName,
        agentId: l.agentId, agentName: l.agentName, debit: money(l.debit), credit: money(l.credit), narration: l.narration,
      })),
    };
  });
}

// The pick-lists the entry form needs. Cash/bank ledgers are left out: they belong to the Cash/Bank voucher.
export async function journalLookups(companyId: number) {
  return snapshot(async (tx) => {
    const ledgers = await tx.select({ id: S.generalLedger.id, code: S.generalLedger.code, name: S.generalLedger.name, requiresSubLedger: S.generalLedger.requiresSubLedger, isActive: S.generalLedger.isActive })
      .from(S.generalLedger).where(and(eq(S.generalLedger.companyId, companyId), eq(S.generalLedger.isCashOrBank, false))).orderBy(asc(S.generalLedger.code));
    const ids = ledgers.map((l) => l.id);
    const subLedgers = ids.length
      ? await tx.select({ id: S.subLedger.id, code: S.subLedger.code, name: S.subLedger.name, generalLedgerId: S.subLedger.generalLedgerId, isActive: S.subLedger.isActive })
        .from(S.subLedger).where(inArray(S.subLedger.generalLedgerId, ids)).orderBy(asc(S.subLedger.code))
      : [];
    const agents = await tx.select({ id: S.agent.id, code: S.agent.code, name: S.agent.name, isActive: S.agent.isActive }).from(S.agent).where(eq(S.agent.companyId, companyId)).orderBy(asc(S.agent.code));
    const fiscalYears = await tx.select({ id: S.fiscalYear.id, code: S.fiscalYear.code, startDate: S.fiscalYear.startDate, endDate: S.fiscalYear.endDate, isActive: S.fiscalYear.isActive, isClosed: S.fiscalYear.isClosed, isCurrent: S.fiscalYear.isCurrent })
      .from(S.fiscalYear).where(eq(S.fiscalYear.companyId, companyId)).orderBy(desc(S.fiscalYear.startDate));
    return { ledgers, subLedgers, agents, fiscalYears: fiscalYears.map((y) => ({ ...y, startDate: iso(y.startDate), endDate: iso(y.endDate) })) };
  });
}
