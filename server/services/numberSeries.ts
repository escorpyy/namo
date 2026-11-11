import { and, asc, eq, or, sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { documentType, formatNumber, stepNumber, numbersLeft, type DocumentType, type SeriesFormat, type SeriesMode } from "../../shared/numberSeries";
import { nextNumber, type Tx } from "./purchase/common";

// The number series engine: which series a user may use, and the next number of a series.
// The settings (create / edit / list) live in numberSeriesAdmin.ts; documents call assignNumber().

/** where each kind of document keeps its number */
export const DOC_TABLE: Record<DocumentType, { table: "PurchaseOrder" | "PurchaseChallan" | "PurchaseBill"; col: "orderNumber" | "challanNumber" | "invoiceNumber" }> = {
  PURCHASE_ORDER: { table: "PurchaseOrder", col: "orderNumber" },
  PURCHASE_CHALLAN: { table: "PurchaseChallan", col: "challanNumber" },
  PURCHASE_BILL: { table: "PurchaseBill", col: "invoiceNumber" },
};

export type SeriesRecord = typeof S.numberSeries.$inferSelect;
const fmt = (s: SeriesRecord): SeriesFormat => s;

/** the active series of a kind of document that this user may use in this branch, default first */
export async function usableSeries(tx: Tx, companyId: number, docType: string, userId: number | null, branchId: number | null): Promise<SeriesRecord[]> {
  const rows = await tx.select().from(S.numberSeries)
    .where(and(eq(S.numberSeries.companyId, companyId), eq(S.numberSeries.documentType, docType), eq(S.numberSeries.isActive, true),
      or(eq(S.numberSeries.allUsers, true), userId === null ? sql`false` : sql`exists (select 1 from "NumberSeriesUser" u where u."seriesId" = ${S.numberSeries.id} and u."userId" = ${userId})`),
      or(eq(S.numberSeries.allBranches, true), branchId === null ? sql`false` : sql`exists (select 1 from "NumberSeriesBranch" b where b."seriesId" = ${S.numberSeries.id} and b."branchId" = ${branchId})`)))
    .orderBy(sql`${S.numberSeries.isDefault} desc`, asc(S.numberSeries.name));
  return rows;
}

type Where = { companyId: number; branchId: number; fiscalYear: string };
const counterKey = (s: SeriesRecord, w: Where) => ({ branchId: s.perBranch ? w.branchId : 0, fiscalYear: s.resetPerFy ? w.fiscalYear : "" });

async function taken(tx: Tx, docType: DocumentType, branchId: number, fiscalYear: string, number: string, exceptId?: number) {
  const { table, col } = DOC_TABLE[docType];
  const r = (await tx.execute(sql`select 1 from ${sql.identifier(table)} where "branchId" = ${branchId} and "fiscalYear" = ${fiscalYear} and ${sql.identifier(col)} = ${number}${exceptId ? sql` and id <> ${exceptId}` : sql``} limit 1`)) as any[];
  return r.length > 0;
}

async function branchCode(tx: Tx, branchId: number) {
  const [b] = await tx.select({ code: S.branch.code }).from(S.branch).where(eq(S.branch.id, branchId));
  return b?.code ?? "";
}

export interface Allocated { number: string; counter: number; left: number | null }

/**
 * Take the next number of a series. `commit` false only looks (the suggestion shown on a new form); true uses the number up.
 * A number that already exists on a document (typed by hand earlier) is skipped. Past the end number it refuses.
 */
export async function nextOfSeries(tx: Tx, s: SeriesRecord, w: Where, commit: boolean): Promise<Allocated> {
  if (s.mode === "MANUAL") throw new HttpError(400, `Series ${s.name} is manual: the number is typed by the user.`);
  const key = counterKey(s, w);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`series:${s.id}:${key.branchId}:${key.fiscalYear}`}))`);
  const [row] = await tx.select().from(S.numberCounter).where(and(eq(S.numberCounter.seriesId, s.id), eq(S.numberCounter.branchId, key.branchId), eq(S.numberCounter.fiscalYear, key.fiscalYear)));
  const ctx = { fiscalYear: w.fiscalYear, branch: s.prefix.includes("{BRANCH}") || s.suffix.includes("{BRANCH}") ? await branchCode(tx, w.branchId) : "" };
  const docType = s.documentType as DocumentType;
  let last: number | null = row?.lastNumber ?? null;
  for (let i = 0; i < 5000; i++) {
    const n = stepNumber(s, last);
    if (n === null) throw new HttpError(409, `Series ${s.name} has reached its end number (${s.endNumber}). Extend the end number or use another series.`, "numberSeriesId");
    const text = formatNumber(s, n, ctx);
    // the unique index is per branch and fiscal year, so a count shared by several branches can still meet a hand-typed number
    if (await taken(tx, docType, w.branchId, w.fiscalYear, text)) { last = n; continue; }
    if (commit) {
      await tx.insert(S.numberCounter).values({ seriesId: s.id, ...key, lastNumber: n })
        .onConflictDoUpdate({ target: [S.numberCounter.seriesId, S.numberCounter.branchId, S.numberCounter.fiscalYear], set: { lastNumber: n } });
    }
    return { number: text, counter: n, left: numbersLeft(s, n) };
  }
  throw new HttpError(409, `Series ${s.name} could not find a free number.`, "numberSeriesId");
}

export interface Assigned { number: string; seriesId: number | null; mode: SeriesMode | "LEGACY" }

/**
 * The number a document gets. `typed` is what the user wrote in the Number box (or the number the document already has).
 *  AUTOMATIC  always from the counter (typed is ignored)      SUGGESTED  typed if given, else from the counter
 *  MANUAL     typed is required                                no series at all: typed, else the old highest + 1 (4 digits)
 * seriesId = null picks the user's default series for this kind; an explicit id must be one the user may use.
 */
export async function assignNumber(tx: Tx, o: { companyId: number; userId: number | null; documentType: DocumentType; seriesId?: number | null; typed?: string | null; branchId: number; fiscalYear: string }): Promise<Assigned> {
  const typed = o.typed?.trim() || "";
  const usable = await usableSeries(tx, o.companyId, o.documentType, o.userId, o.branchId);
  let s: SeriesRecord | undefined;
  if (o.seriesId) {
    s = usable.find((x) => x.id === o.seriesId);
    if (!s) throw new HttpError(409, "That number series is not available to you for this branch.", "numberSeriesId");
  } else s = usable[0];
  if (!s) {
    if (typed) return { number: typed, seriesId: null, mode: "LEGACY" };
    const { table, col } = DOC_TABLE[o.documentType];
    return { number: await nextNumber(tx, table, col, o.branchId, o.fiscalYear), seriesId: null, mode: "LEGACY" };
  }
  if (s.mode === "MANUAL") {
    if (!typed) throw new HttpError(400, `Series ${s.name} is manual: type the ${documentType(o.documentType)?.label.toLowerCase()} number.`, "number");
    return { number: typed, seriesId: s.id, mode: "MANUAL" };
  }
  if (s.mode === "SUGGESTED" && typed) return { number: typed, seriesId: s.id, mode: "SUGGESTED" };
  const a = await nextOfSeries(tx, s, o, true);
  return { number: a.number, seriesId: s.id, mode: s.mode as SeriesMode };
}

/**
 * The number to store when a document is saved. A new document (or one moved to another fiscal year, when keepWhen says so) gets a
 * number from assignNumber(). An existing document keeps its number: changing the series on a saved document is the only thing that
 * gives it a new one; and a typed number replaces the old one only if the series lets the user type (suggested / manual / no series).
 */
export async function numberForSave(tx: Tx, o: {
  companyId: number; userId: number | null; documentType: DocumentType; seriesId?: number | null; typed?: string | null; branchId: number; fiscalYear: string;
  existing?: { number: string; numberSeriesId: number | null } | null;
}): Promise<Assigned> {
  const typed = o.typed?.trim() || "", ex = o.existing;
  if (!ex) return assignNumber(tx, o);
  const switching = !!o.seriesId && o.seriesId !== ex.numberSeriesId;
  if (switching) return assignNumber(tx, { ...o, typed: typed === ex.number ? "" : typed });
  if (typed && typed !== ex.number) {
    const [s] = ex.numberSeriesId ? await tx.select().from(S.numberSeries).where(eq(S.numberSeries.id, ex.numberSeriesId)) : [];
    if (!s || s.mode !== "AUTOMATIC") return { number: typed, seriesId: ex.numberSeriesId, mode: s ? (s.mode as SeriesMode) : "LEGACY" };
  }
  return { number: ex.number, seriesId: ex.numberSeriesId, mode: "LEGACY" };
}
