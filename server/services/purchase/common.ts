import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db, type DB } from "../../db";
import { setAuditContext } from "../../db/audit";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";

// Every service takes an optional `tx`. With none it opens its own transaction (the normal case: all or nothing).
// With one it joins that transaction through a savepoint, so a caller (or a test) can wrap several calls and roll back.
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Opts = { tx?: Tx };
// A rule the DATABASE refused (check / trigger / foreign key / unique) becomes a readable 409 instead of a raw exception.
function translate(e: any): never {
  const c = e?.cause ?? e;
  if (c && typeof c.code === "string" && ["23514", "23503", "23505"].includes(c.code)) {
    const unique = c.code === "23505";
    throw new HttpError(409, unique ? `Already exists: ${c.detail ?? c.constraint_name ?? c.message}` : String(c.message));
  }
  throw e;
}
export const inTx = async <T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> => {
  try {
    return await (tx ? tx.transaction(fn) : db.transaction(fn));
  } catch (e) {
    return translate(e);
  }
};

export type Actor = { userId: number | null };

// Same as inTx for a service that WRITES: first tells the database who is acting (and, optionally, why) so the audit trail
// (ERP-024) records it. The setting lasts until the outer transaction ends; the next audited write sets its own.
export const inActorTx = <T>(actor: Actor & { reason?: string | null }, tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  inTx(tx, async (t) => {
    await setAuditContext(t, actor);
    return fn(t);
  });

// ---- dates (stored as plain dates, handled as UTC midnight so no timezone can shift a day) ----
export function parseDate(v: string | Date | null | undefined, field = "date"): Date {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) throw new HttpError(400, `${field} must be a date like 2026-10-22.`, field);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new HttpError(400, `${field} is not a real date.`, field);
  return d;
}
export const optDate = (v: string | Date | null | undefined, field: string) => (v === null || v === undefined || v === "" ? null : parseDate(v, field));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const today = () => parseDate(new Date());

// ---- fiscal year ----
// The document's fiscal year must exist, be active and OPEN, and the document date must fall inside it.
// With no code given, the fiscal year that contains the date is used.
export async function resolveFiscalYear(tx: Tx, companyId: number, date: Date, code?: string | null) {
  const where = code
    ? and(eq(S.fiscalYear.companyId, companyId), eq(S.fiscalYear.code, code))
    : and(eq(S.fiscalYear.companyId, companyId), lte(S.fiscalYear.startDate, date), gte(S.fiscalYear.endDate, date));
  const [fy] = await tx.select().from(S.fiscalYear).where(where).limit(1);
  if (!fy) throw new HttpError(400, code ? `Fiscal year ${code} does not exist in this company.` : "No fiscal year covers this date.", "fiscalYear");
  if (!fy.isActive) throw new HttpError(409, `Fiscal year ${fy.code} is not active.`, "fiscalYear");
  if (fy.isClosed) throw new HttpError(409, `Fiscal year ${fy.code} is closed.`, "fiscalYear");
  if (date.getTime() < fy.startDate.getTime() || date.getTime() > fy.endDate.getTime()) {
    throw new HttpError(400, `The date is outside fiscal year ${fy.code}.`, "date");
  }
  return fy;
}

export async function assertBranch(tx: Tx, companyId: number, branchId: number) {
  const [b] = await tx.select({ id: S.branch.id, isActive: S.branch.isActive }).from(S.branch).where(and(eq(S.branch.id, branchId), eq(S.branch.companyId, companyId)));
  if (!b) throw new HttpError(404, "Branch not found in this company.", "branchId");
  if (!b.isActive) throw new HttpError(409, "Branch is not active.", "branchId");
}

// The vendor is a general ledger (it can be "Cash A/C" as well as a supplier). The optional sub-ledger must belong to it.
export async function assertVendorLedger(tx: Tx, companyId: number, vendorGLId: number, subLedgerId: number | null | undefined, opts: { requireSubWhenFlagged?: boolean } = {}) {
  const [gl] = await tx.select().from(S.generalLedger).where(and(eq(S.generalLedger.id, vendorGLId), eq(S.generalLedger.companyId, companyId)));
  if (!gl) throw new HttpError(404, "Vendor ledger not found in this company.", "vendorGLId");
  if (!gl.isActive) throw new HttpError(409, `Ledger ${gl.code} is not active.`, "vendorGLId");
  if (subLedgerId) {
    const [sl] = await tx.select().from(S.subLedger).where(eq(S.subLedger.id, subLedgerId));
    if (!sl || sl.generalLedgerId !== vendorGLId) throw new HttpError(400, "That sub-ledger does not belong to the vendor ledger.", "subLedgerId");
  } else if (opts.requireSubWhenFlagged && gl.requiresSubLedger) {
    throw new HttpError(400, `Ledger ${gl.code} needs a sub-ledger.`, "subLedgerId");
  }
  return gl;
}

// ---- numbering ----
// Next number for a document type in a branch and fiscal year: highest purely numeric number + 1, zero-padded to 4.
// A transaction-scoped advisory lock stops two people taking the same number at the same moment.
export async function nextNumber(tx: Tx, table: "PurchaseOrder" | "PurchaseChallan" | "PurchaseBill", col: "orderNumber" | "challanNumber" | "invoiceNumber", branchId: number, fiscalYear: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${table}:${branchId}:${fiscalYear}`}))`);
  const r = (await tx.execute(sql`
    select coalesce(max((${sql.identifier(col)})::bigint), 0)::text as n
      from ${sql.identifier(table)}
     where "branchId" = ${branchId} and "fiscalYear" = ${fiscalYear} and ${sql.identifier(col)} ~ '^[0-9]{1,15}$'`)) as any[];
  return String(BigInt(r[0].n) + 1n).padStart(4, "0");
}

export const idList = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);
