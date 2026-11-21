import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { postJournalVoucher, saveJournalVoucher, type JvLineInput } from "./journalVoucher";
import { type Actor, type Opts, type Tx, inActorTx, parseDate, today } from "./purchase/common";
import { ZERO, fmt, toMicro, type Micro } from "./purchase/money";
import type { JvRow } from "./voucherWriter";

// TERM LEDGER CORRECTION: a billing term (Trade Discount, Freight ...) was posted to the wrong ledger on many bills. A posted bill is never
// rewritten; ONE correcting journal voucher per branch moves the amounts from the old ledger to the right one, and each corrected document term
// is recorded in TermLedgerCorrection.  Purchase: ADDITIVE sat on Dr of its ledger, DEDUCTIVE on Cr.  Sales: the other way round.

export type CorrectionKind = "PURCHASE" | "SALES";
export type CorrectionFilter = { kind: CorrectionKind; termId: number; fromLedgerId: number; toLedgerId: number; dateFrom?: string | null; dateTo?: string | null; branchId?: number | null };
export type CorrectionRow = {
  documentType: "PURCHASE_BILL" | "SALES_INVOICE"; documentId: number; documentTermId: number; documentNumber: string; documentDate: string;
  branchId: number; termName: string; side: "DR" | "CR"; amount: string;
};

const docType = (k: CorrectionKind) => (k === "PURCHASE" ? "PURCHASE_BILL" : "SALES_INVOICE") as CorrectionRow["documentType"];
const dateStr = (d: Date | string) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));
const sideOf = (k: CorrectionKind, nature: string): "DR" | "CR" => (k === "PURCHASE" ? (nature === "ADDITIVE" ? "DR" : "CR") : (nature === "ADDITIVE" ? "CR" : "DR"));

// The ledger a posted document term sits on now: its latest correction's target, else the ledger it was posted to.
const effectiveLedger = (type: string, termIdCol: unknown, snapshotCol: unknown) =>
  sql`COALESCE((SELECT c."toLedgerId" FROM "TermLedgerCorrection" c WHERE c."documentType" = ${type} AND c."documentTermId" = ${termIdCol} ORDER BY c.id DESC LIMIT 1), ${snapshotCol})`;

async function candidates(q: typeof db | Tx, companyId: number, f: CorrectionFilter): Promise<CorrectionRow[]> {
  const type = docType(f.kind);
  const dFrom = f.dateFrom ? parseDate(f.dateFrom, "dateFrom") : null, dTo = f.dateTo ? parseDate(f.dateTo, "dateTo") : null;
  if (f.kind === "PURCHASE") {
    const b = S.purchaseBill, t = S.purchaseDocumentTerm;
    const rows = await q.select({ t, name: S.purchaseTerm.name, id: b.id, no: b.invoiceNumber, date: b.invoiceDate, branchId: b.branchId })
      .from(t).innerJoin(b, and(eq(b.id, t.documentId), eq(t.documentType, "PURCHASE_BILL"))).innerJoin(S.purchaseTerm, eq(S.purchaseTerm.id, t.termId))
      .where(and(eq(b.companyId, companyId), eq(t.termId, f.termId), eq(b.isPosted, true), sql`${b.reversalOfId} IS NULL`,
        sql`NOT EXISTS (SELECT 1 FROM "PurchaseBill" r WHERE r."reversalOfId" = ${b.id} AND r."isPosted")`,
        sql`${effectiveLedger(type, t.id, t.generalLedgerId)} = ${f.fromLedgerId}`, sql`${t.finalAmount} > 0`,
        f.branchId ? eq(b.branchId, f.branchId) : undefined, dFrom ? gte(b.invoiceDate, dFrom) : undefined, dTo ? lte(b.invoiceDate, dTo) : undefined))
      .orderBy(asc(b.invoiceDate), asc(b.id), asc(t.id));
    return rows.map((r) => ({ documentType: type, documentId: r.id, documentTermId: r.t.id, documentNumber: r.no, documentDate: dateStr(r.date), branchId: r.branchId, termName: r.name, side: sideOf(f.kind, r.t.nature), amount: fmt(toMicro(r.t.finalAmount), 2) }));
  }
  const b = S.salesInvoice, t = S.salesDocumentTerm;
  const rows = await q.select({ t, name: S.salesTerm.name, id: b.id, no: b.invoiceNumber, date: b.invoiceDate, branchId: b.branchId })
    .from(t).innerJoin(b, and(eq(b.id, t.documentId), eq(t.documentType, "SALES_INVOICE"))).innerJoin(S.salesTerm, eq(S.salesTerm.id, t.termId))
    .where(and(eq(b.companyId, companyId), eq(t.termId, f.termId), eq(b.isPosted, true), sql`${b.reversalOfId} IS NULL`,
      sql`NOT EXISTS (SELECT 1 FROM "SalesInvoice" r WHERE r."reversalOfId" = ${b.id} AND r."isPosted")`,
      sql`${effectiveLedger(type, t.id, t.generalLedgerId)} = ${f.fromLedgerId}`, sql`${t.finalAmount} > 0`,
      f.branchId ? eq(b.branchId, f.branchId) : undefined, dFrom ? gte(b.invoiceDate, dFrom) : undefined, dTo ? lte(b.invoiceDate, dTo) : undefined))
    .orderBy(asc(b.invoiceDate), asc(b.id), asc(t.id));
  return rows.map((r) => ({ documentType: type, documentId: r.id, documentTermId: r.t.id, documentNumber: r.no, documentDate: dateStr(r.date), branchId: r.branchId, termName: r.name, side: sideOf(f.kind, r.t.nature), amount: fmt(toMicro(r.t.finalAmount), 2) }));
}

async function checkLedgers(q: typeof db | Tx, companyId: number, f: CorrectionFilter) {
  if (f.fromLedgerId === f.toLedgerId) throw new HttpError(400, "The old and the new ledger are the same.", "toLedgerId");
  const gl = await q.select({ id: S.generalLedger.id, isActive: S.generalLedger.isActive }).from(S.generalLedger)
    .where(and(eq(S.generalLedger.companyId, companyId), inArray(S.generalLedger.id, [f.fromLedgerId, f.toLedgerId])));
  if (gl.length !== 2) throw new HttpError(404, "Ledger not found in this company.");
  if (!gl.find((g) => g.id === f.toLedgerId)!.isActive) throw new HttpError(409, "The new ledger is inactive.", "toLedgerId");
  const term = f.kind === "PURCHASE"
    ? (await q.select({ id: S.purchaseTerm.id }).from(S.purchaseTerm).where(and(eq(S.purchaseTerm.id, f.termId), eq(S.purchaseTerm.companyId, companyId))))[0]
    : (await q.select({ id: S.salesTerm.id }).from(S.salesTerm).where(and(eq(S.salesTerm.id, f.termId), eq(S.salesTerm.companyId, companyId))))[0];
  if (!term) throw new HttpError(404, "Term not found in this company.");
}

export async function previewTermLedgerCorrection(companyId: number, f: CorrectionFilter) {
  await checkLedgers(db, companyId, f);
  const rows = await candidates(db, companyId, f);
  const total = rows.reduce((a, r) => a + toMicro(r.amount), ZERO);
  return { rows, count: rows.length, documents: new Set(rows.map((r) => r.documentId)).size, total: fmt(total, 2) };
}

// How many posted, unreversed documents still sit on `ledgerId` for this term (the warning when a term's ledger is changed in the master).
export async function countOnLedger(companyId: number, kind: CorrectionKind, termId: number, ledgerId: number) {
  const rows = await candidates(db, companyId, { kind, termId, fromLedgerId: ledgerId, toLedgerId: ledgerId });
  return { documents: new Set(rows.map((r) => r.documentId)).size, terms: rows.length };
}

export function applyTermLedgerCorrection(companyId: number, f: CorrectionFilter & { date?: string | null; reason: string }, actor: Actor, opts: Opts = {}) {
  const reason = (f.reason ?? "").trim();
  if (reason.length < 3) throw new HttpError(400, "Give a reason (at least 3 characters) for this correction.", "reason");
  return inActorTx({ ...actor, reason }, opts.tx, async (tx) => {
    await checkLedgers(tx, companyId, f);
    // Lock the documents so a reversal running at the same time cannot slip past, then read the rows again under the lock.
    const type = docType(f.kind);
    const rows = await candidates(tx, companyId, f);
    if (!rows.length) throw new HttpError(409, "Nothing to correct: no posted document of this term sits on the old ledger in that range.");
    const ids = [...new Set(rows.map((r) => r.documentId))];
    if (f.kind === "PURCHASE") await tx.select({ id: S.purchaseBill.id }).from(S.purchaseBill).where(inArray(S.purchaseBill.id, ids)).orderBy(asc(S.purchaseBill.id)).for("update");
    else await tx.select({ id: S.salesInvoice.id }).from(S.salesInvoice).where(inArray(S.salesInvoice.id, ids)).orderBy(asc(S.salesInvoice.id)).for("update");
    const locked = await candidates(tx, companyId, f);
    if (locked.length !== rows.length) throw new HttpError(409, "The documents changed while correcting. Preview again.");

    const date = f.date ? dateStr(parseDate(f.date, "date")) : dateStr(today());
    const [from, to] = await tx.select({ id: S.generalLedger.id, name: S.generalLedger.name }).from(S.generalLedger).where(inArray(S.generalLedger.id, [f.fromLedgerId, f.toLedgerId]))
      .then((g) => [g.find((x) => x.id === f.fromLedgerId)!, g.find((x) => x.id === f.toLedgerId)!]);
    const termName = rows[0].termName;
    const vouchers: { branchId: number; journalVoucherId: number; voucherNumber: string; documents: number; total: string }[] = [];
    for (const branchId of [...new Set(rows.map((r) => r.branchId))].sort((a, b) => a - b)) {
      const mine = rows.filter((r) => r.branchId === branchId);
      const dr = mine.filter((r) => r.side === "DR").reduce((a, r) => a + toMicro(r.amount), ZERO);
      const cr = mine.filter((r) => r.side === "CR").reduce((a, r) => a + toMicro(r.amount), ZERO);
      const narr = `Term ${termName}: ${from.name} to ${to.name}`.slice(0, 500);
      // Original Dr on the old ledger is cancelled by a Cr there and re-stated as Dr on the new one; Cr the other way round.
      const lines: JvLineInput[] = [];
      if (dr > ZERO) lines.push({ generalLedgerId: f.fromLedgerId, credit: fmt(dr, 6), narration: narr }, { generalLedgerId: f.toLedgerId, debit: fmt(dr, 6), narration: narr });
      if (cr > ZERO) lines.push({ generalLedgerId: f.fromLedgerId, debit: fmt(cr, 6), narration: narr }, { generalLedgerId: f.toLedgerId, credit: fmt(cr, 6), narration: narr });
      const saved = await saveJournalVoucher({
        companyId, branchId, voucherDate: date, remarks: `Term ledger correction: ${reason}`.slice(0, 1024), lines,
      }, actor, { tx });
      await postJournalVoucher(saved.id, companyId, actor, { tx });
      for (const r of mine) {
        await tx.insert(S.termLedgerCorrection).values({
          companyId, journalVoucherId: saved.id, documentType: type, documentId: r.documentId, documentTermId: r.documentTermId,
          fromLedgerId: f.fromLedgerId, toLedgerId: f.toLedgerId, side: r.side, amount: r.amount,
        });
      }
      vouchers.push({ branchId, journalVoucherId: saved.id, voucherNumber: saved.voucherNumber, documents: new Set(mine.map((r) => r.documentId)).size, total: fmt(dr + cr, 2) });
    }
    return { vouchers, count: rows.length, documents: ids.length };
  });
}

// Rows that undo, inside a document's own reversal voucher, every correction made on that document. Without them the reversal would cancel the
// original posting on the OLD ledger and leave the correction standing there as a residue.
export async function correctionMirrorRows(tx: Tx, type: "PURCHASE_BILL" | "SALES_INVOICE", documentId: number): Promise<JvRow[]> {
  const rows = await tx.select().from(S.termLedgerCorrection)
    .where(and(eq(S.termLedgerCorrection.documentType, type), eq(S.termLedgerCorrection.documentId, documentId))).orderBy(asc(S.termLedgerCorrection.id));
  const out: JvRow[] = [];
  for (const c of rows) {
    const amt: Micro = toMicro(c.amount);
    // the correction put `side` on toLedger and the opposite on fromLedger; the mirror does the reverse of that
    const onFrom = c.side === "DR" ? { debit: amt, credit: ZERO } : { debit: ZERO, credit: amt };
    const onTo = c.side === "DR" ? { debit: ZERO, credit: amt } : { debit: amt, credit: ZERO };
    out.push({ generalLedgerId: c.fromLedgerId, ...onFrom, narration: "Reversal of term ledger correction" }, { generalLedgerId: c.toLedgerId, ...onTo, narration: "Reversal of term ledger correction" });
  }
  return out;
}

export async function isCorrectionVoucher(tx: Tx, voucherId: number): Promise<boolean> {
  const [r] = await tx.select({ id: S.termLedgerCorrection.id }).from(S.termLedgerCorrection).where(eq(S.termLedgerCorrection.journalVoucherId, voucherId)).limit(1);
  return !!r;
}
