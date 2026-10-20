import { Router } from "express";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError, wrap } from "./_util";
import { mulRound2, parseDec } from "../../shared/decimal";

const SOB = S.stockOpeningBalance, SD = S.stockDetail, OB = S.openingBalance;
const int = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} is required.`);
  return n;
};
const validIso = (v: string) => { const d = new Date(v + "T00:00:00Z"); return /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; };

async function scope(companyId: number, branchId: number, fyId: number) {
  const [fy] = await db.select().from(S.fiscalYear).where(and(eq(S.fiscalYear.id, fyId), eq(S.fiscalYear.companyId, companyId)));
  if (!fy) throw new HttpError(404, "Fiscal year not found in this company.");
  const [br] = await db.select({ id: S.branch.id }).from(S.branch).where(and(eq(S.branch.id, branchId), eq(S.branch.companyId, companyId)));
  if (!br) throw new HttpError(404, "Branch not found in this company.");
  return fy;
}

// Stock Opening Balance: (Company, Branch, Fiscal Year) ki lines. Lock ka flag Opening Balance ke saath share hota hai (ek flag, dono).
export const stockOpeningRouter = Router();

stockOpeningRouter.get("/", wrap(async (req, res) => {
  const companyId = int(req.query.companyId, "companyId"), branchId = int(req.query.branchId, "branchId"), fyId = int(req.query.fiscalYearId, "fiscalYearId");
  const fy = await scope(companyId, branchId, fyId);

  const products = await db
    .select({
      stockDetailId: SD.id, productId: S.product.id, code: S.product.code, description: S.product.description, isActive: S.product.isActive,
      unitId: S.productUnit.id, unitCode: S.productUnit.code, decimals: S.productUnit.decimalPlaces,
      tracksBatch: SD.tracksBatch, tracksExpiry: SD.tracksExpiry, closingBSGLId: SD.closingBSGLId, defaultLocationId: SD.defaultLocationId,
    })
    .from(SD).innerJoin(S.product, eq(SD.productId, S.product.id)).innerJoin(S.productUnit, eq(SD.baseUnitId, S.productUnit.id))
    .where(and(eq(S.product.companyId, companyId), eq(S.product.type, "STOCK"))).orderBy(asc(S.product.code));
  const locations = await db.select({ id: S.location.id, code: S.location.code, name: S.location.name, isActive: S.location.isActive }).from(S.location).where(eq(S.location.companyId, companyId)).orderBy(asc(S.location.code));
  const lines = await db.select().from(SOB).where(and(eq(SOB.branchId, branchId), eq(SOB.fiscalYearId, fyId))).orderBy(asc(SOB.id));

  // Reconciliation ke liye: stock ledgers (Closing Stock GL B/S) aur unka Opening Balance (is branch me)
  const glIds = [...new Set(products.map((p) => p.closingBSGLId).filter((x): x is number => x != null))];
  const gls = glIds.length ? await db.select({ id: S.generalLedger.id, code: S.generalLedger.code, name: S.generalLedger.name }).from(S.generalLedger).where(inArray(S.generalLedger.id, glIds)) : [];
  const ob = glIds.length
    ? await db.select({ glId: OB.generalLedgerId, n: sql<string>`(coalesce(sum(${OB.debit}), 0) - coalesce(sum(${OB.credit}), 0))::text` })
        .from(OB).where(and(eq(OB.fiscalYearId, fyId), eq(OB.branchId, branchId), inArray(OB.generalLedgerId, glIds))).groupBy(OB.generalLedgerId)
    : [];
  res.json({
    fiscalYear: { id: fy.id, code: fy.code, startDate: fy.startDate, endDate: fy.endDate, isClosed: fy.isClosed, isOpeningBalanceLocked: fy.isOpeningBalanceLocked },
    products, locations, lines,
    ledgers: gls.map((g) => ({ ...g, balance: (ob.find((o) => o.glId === g.id)?.n ?? "0").replace(/(\.\d{2})\d*$/, "$1") })),
  });
}));

stockOpeningRouter.put("/", wrap(async (req, res) => {
  const b = req.body ?? {};
  const companyId = int(b.companyId, "companyId"), branchId = int(b.branchId, "branchId"), fyId = int(b.fiscalYearId, "fiscalYearId");
  const fy = await scope(companyId, branchId, fyId);
  if (fy.isClosed) throw new HttpError(409, "This fiscal year is closed. Stock opening cannot be changed.");
  if (fy.isOpeningBalanceLocked) throw new HttpError(409, "Opening balance is locked for this fiscal year. Unlock it (Opening Balance screen) first.");
  const upserts: any[] = Array.isArray(b.upserts) ? b.upserts : [];
  const deletes: number[] = (Array.isArray(b.deletes) ? b.deletes : []).map(Number);
  if (!upserts.length && !deletes.length) throw new HttpError(400, "Nothing to save.");
  if (upserts.length > 5000) throw new HttpError(400, "Too many rows in one save.");

  const existing = await db.select().from(SOB).where(and(eq(SOB.branchId, branchId), eq(SOB.fiscalYearId, fyId)));
  const exMap = new Map(existing.map((e) => [e.id, e]));
  for (const id of deletes) if (!exMap.has(id)) throw new HttpError(400, "Row to delete not found in this branch / fiscal year.");
  for (const u of upserts) if (u.id != null && !exMap.has(Number(u.id))) throw new HttpError(400, "Row to update not found in this branch / fiscal year.");

  const sdIds = [...new Set(upserts.map((u) => int(u.stockDetailId, "stockDetailId")))];
  const prods = sdIds.length
    ? await db.select({ sdId: SD.id, code: S.product.code, decimals: S.productUnit.decimalPlaces, tracksBatch: SD.tracksBatch, tracksExpiry: SD.tracksExpiry, type: S.product.type })
        .from(SD).innerJoin(S.product, eq(SD.productId, S.product.id)).innerJoin(S.productUnit, eq(SD.baseUnitId, S.productUnit.id))
        .where(and(inArray(SD.id, sdIds), eq(S.product.companyId, companyId)))
    : [];
  const pMap = new Map(prods.map((p) => [p.sdId, p]));
  const locIds = [...new Set(upserts.map((u) => u.locationId).filter((x) => x != null).map(Number))];
  if (locIds.length) {
    const ok = await db.select({ id: S.location.id }).from(S.location).where(and(inArray(S.location.id, locIds), eq(S.location.companyId, companyId)));
    if (ok.length !== locIds.length) throw new HttpError(400, "Location not found in this company.");
  }

  const clean = upserts.map((u) => {
    const p = pMap.get(Number(u.stockDetailId));
    if (!p) throw new HttpError(400, "Product not found in this company (only Stock products can have stock opening).");
    const label = p.code;
    const qty = String(u.quantity ?? ""), rate = String(u.rate ?? ""), value = String(u.value ?? "");
    const q = parseDec(qty), r = parseDec(rate);
    if (!q || !r) throw new HttpError(400, `${label}: invalid quantity or rate (numbers only, up to 6 decimals, no negatives).`);
    if (q.n === 0n) throw new HttpError(400, `${label}: quantity must be greater than 0 (remove the row instead).`);
    if (q.scale > p.decimals) throw new HttpError(400, `${label}: this unit allows at most ${p.decimals} decimal place(s) in quantity.`);
    const expected = mulRound2(qty, rate);
    // Value explicit store hota hai: transcription error chhupna nahi chahiye, isliye Qty x Rate se match zaroori
    if (value !== expected) throw new HttpError(400, `${label}: value ${value} does not match Quantity × Rate (${expected}).`);
    const batch = u.batchNo == null || String(u.batchNo).trim() === "" ? null : String(u.batchNo).trim();
    if (batch && batch.length > 50) throw new HttpError(400, `${label}: batch no can be at most 50 characters.`);
    if (p.tracksBatch && !batch) throw new HttpError(400, `${label}: batch no is required (batch tracking is on).`);
    if (!p.tracksBatch && batch) throw new HttpError(400, `${label}: batch is not tracked for this product.`);
    const exp = u.expiryDate == null || u.expiryDate === "" ? null : String(u.expiryDate);
    if (exp && !validIso(exp)) throw new HttpError(400, `${label}: invalid expiry date.`);
    if (p.tracksExpiry && !exp) throw new HttpError(400, `${label}: expiry date is required (expiry tracking is on).`);
    if (!p.tracksExpiry && exp) throw new HttpError(400, `${label}: expiry is not tracked for this product.`);
    return { id: u.id != null ? Number(u.id) : null, sdId: Number(u.stockDetailId), loc: u.locationId == null ? null : Number(u.locationId), batch, exp, qty, rate, value: expected, code: p.code };
  });

  // Final state me (product, location, batch) unique hona chahiye (batch case-insensitive: "B1" aur "b1" alag nahi maante)
  const final = new Map<string, string>();
  const key = (sd: number, loc: number | null, batch: string | null) => `${sd}|${loc ?? 0}|${(batch ?? "").toLowerCase()}`;
  const touched = new Set(clean.map((c) => c.id).filter((x): x is number => x != null));
  for (const e of existing) if (!deletes.includes(e.id) && !touched.has(e.id)) final.set(key(e.stockDetailId, e.locationId, e.batchNo), `#${e.id}`);
  for (const c of clean) {
    const k = key(c.sdId, c.loc, c.batch);
    if (final.has(k)) throw new HttpError(409, `${c.code}: the same product / location / batch appears twice.`);
    final.set(k, "new");
  }

  let saved = 0;
  await db.transaction(async (tx) => {
    if (deletes.length) await tx.delete(SOB).where(inArray(SOB.id, deletes));
    for (const c of clean) {
      const vals = { stockDetailId: c.sdId, locationId: c.loc, batchNo: c.batch, expiryDate: c.exp ? new Date(`${c.exp}T00:00:00Z`) : null, quantity: c.qty, rate: c.rate, value: c.value };
      if (c.id != null) await tx.update(SOB).set(vals).where(eq(SOB.id, c.id));
      else await tx.insert(SOB).values({ branchId, fiscalYearId: fyId, ...vals });
      saved++;
    }
  });
  res.json({ saved, deleted: deletes.length });
}));
