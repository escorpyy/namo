import { and, eq, inArray, sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { fmt, toMicro, ZERO } from "./purchase/money";
import type { Tx } from "./purchase/common";
import type { db } from "../db";

// The stock ledger (see StockMovement). Only STOCK products move stock; services and non-stock items never do.
export type StockSource = "PURCHASE_CHALLAN" | "PURCHASE_BILL" | "SALES_CHALLAN" | "SALES_INVOICE";
export type StockLine = {
  id: number; productId: number; qty: string | number;
  locationId?: number | null; batchNo?: string | null; expiryDate?: Date | string | null;
};

/** Adds one movement per line that is a stock product: qty > 0 for `direction` IN, qty < 0 for OUT. Returns how many rows were written. */
export async function recordMovements(tx: Tx, h: { companyId: number; branchId: number; date: Date; source: StockSource; sourceId: number; direction: "IN" | "OUT" }, lines: StockLine[]) {
  if (!lines.length) return 0;
  const stock = new Set((await tx.select({ id: S.product.id }).from(S.product).where(and(inArray(S.product.id, [...new Set(lines.map((l) => l.productId))]), eq(S.product.type, "STOCK")))).map((p) => p.id));
  const rows = lines.filter((l) => stock.has(l.productId) && toMicro(l.qty) !== ZERO).map((l) => ({
    companyId: h.companyId, branchId: h.branchId, productId: l.productId, locationId: l.locationId ?? null, batchNo: l.batchNo ?? null,
    expiryDate: l.expiryDate ? new Date(l.expiryDate) : null, movementDate: h.date,
    qty: fmt(h.direction === "IN" ? toMicro(l.qty) : -toMicro(l.qty)), sourceType: h.source, sourceId: h.sourceId, sourceLineId: l.id,
  }));
  if (rows.length) await tx.insert(S.stockMovement).values(rows);
  return rows.length;
}

/** Cancels what earlier lines wrote: for each (original line -> new line) pair, adds the opposite of the original line's movements. */
export async function reverseMovements(tx: Tx, h: { source: StockSource; originalSourceId: number; newSourceId: number; date: Date }, lineMap: Map<number, number>) {
  const originals = await tx.select().from(S.stockMovement).where(and(eq(S.stockMovement.sourceType, h.source), eq(S.stockMovement.sourceId, h.originalSourceId)));
  const rows = originals.filter((m) => lineMap.has(m.sourceLineId)).map((m) => ({
    companyId: m.companyId, branchId: m.branchId, productId: m.productId, locationId: m.locationId, batchNo: m.batchNo, expiryDate: m.expiryDate,
    movementDate: h.date, qty: fmt(-toMicro(m.qty)), sourceType: h.source, sourceId: h.newSourceId, sourceLineId: lineMap.get(m.sourceLineId)!,
  }));
  if (rows.length) await tx.insert(S.stockMovement).values(rows);
  return rows.length;
}

/** Stock on hand by product, location and batch (rows that net to zero are left out). `asOf` counts movements up to and including that date. */
export async function stockBalance(tx: Tx | typeof db, q: { companyId: number; branchId?: number; productId?: number; locationId?: number; asOf?: Date }) {
  const m = S.stockMovement;
  const conds = [eq(m.companyId, q.companyId)];
  if (q.branchId) conds.push(eq(m.branchId, q.branchId));
  if (q.productId) conds.push(eq(m.productId, q.productId));
  if (q.locationId) conds.push(eq(m.locationId, q.locationId));
  if (q.asOf) conds.push(sql`${m.movementDate} <= ${q.asOf.toISOString().slice(0, 10)}`);
  const rows = await tx.select({
    productId: m.productId, code: S.product.code, description: S.product.description, locationId: m.locationId, batchNo: m.batchNo, expiryDate: m.expiryDate,
    qty: sql<string>`sum(${m.qty})`,
  }).from(m).innerJoin(S.product, eq(S.product.id, m.productId)).where(and(...conds))
    .groupBy(m.productId, S.product.code, S.product.description, m.locationId, m.batchNo, m.expiryDate)
    .having(sql`sum(${m.qty}) <> 0`).orderBy(S.product.code, m.locationId, m.batchNo);
  return rows.map((r) => ({ ...r, qty: fmt(toMicro(r.qty)), expiryDate: r.expiryDate ? new Date(r.expiryDate).toISOString().slice(0, 10) : null }));
}

/** Refuses an issue the stock cannot cover. Stock is counted in the exact bucket (product, location, batch) the line names; a line that
 *  names no location draws on the stock that was received with no location. Lines taking from the same bucket are added up first. */
export async function assertStockCovers(tx: Tx, h: { companyId: number; branchId: number }, lines: { lineNumber: number; productId: number; qty: string | number; locationId?: number | null; batchNo?: string | null }[]) {
  const m = S.stockMovement;
  const stock = new Set((await tx.select({ id: S.product.id }).from(S.product).where(and(inArray(S.product.id, [...new Set(lines.map((l) => l.productId))]), eq(S.product.type, "STOCK")))).map((p) => p.id));
  const need = new Map<string, { first: number; productId: number; locationId: number | null; batchNo: string | null; qty: bigint }>();
  for (const l of lines) {
    if (!stock.has(l.productId)) continue;
    const key = `${l.productId}|${l.locationId ?? ""}|${l.batchNo ?? ""}`;
    const cur = need.get(key);
    if (cur) cur.qty += toMicro(l.qty);
    else need.set(key, { first: l.lineNumber, productId: l.productId, locationId: l.locationId ?? null, batchNo: l.batchNo ?? null, qty: toMicro(l.qty) });
  }
  for (const n of need.values()) {
    const [r] = await tx.select({ qty: sql<string>`coalesce(sum(${m.qty}), 0)` }).from(m).where(and(
      eq(m.companyId, h.companyId), eq(m.branchId, h.branchId), eq(m.productId, n.productId),
      n.locationId === null ? sql`${m.locationId} is null` : eq(m.locationId, n.locationId),
      n.batchNo === null ? sql`${m.batchNo} is null` : eq(m.batchNo, n.batchNo)));
    const have = toMicro(r.qty);
    if (have < n.qty) {
      const where = [n.locationId === null ? "no location" : `location ${n.locationId}`, n.batchNo ? `batch ${n.batchNo}` : ""].filter(Boolean).join(", ");
      throw new HttpError(409, `Line ${n.first}: not enough stock (${where}): ${fmt(have)} on hand, ${fmt(n.qty)} needed.`, "lines");
    }
  }
}
