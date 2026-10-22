import { and, eq } from "drizzle-orm";
import * as S from "../../db/schema";
import { HttpError } from "../../routes/_util";
import { type Tx } from "./common";
import { type Micro, ZERO, mul, roundTo, toMicro } from "./money";

// What a user types on one grid row of an order, challan or bill. Everything else is worked out here.
export type LineInput = {
  productId: number;
  particular?: string | null;
  altQty?: string | number | null; // quantity in the alternate unit (the first Uom column)
  altUnitId?: number | null;
  qty?: string | number | null; // quantity in the stock unit (the second Uom column); derived when altQty is given
  unitId?: number | null;
  rate?: string | number | null;
};

export type ResolvedLine = {
  lineNumber: number;
  productId: number;
  productType: "STOCK" | "NON_STOCK" | "SERVICE" | "FIXED_ASSET" | "BUNDLE";
  particular: string | null;
  altQty: Micro | null;
  altUnitId: number | null;
  qty: Micro;
  unitId: number;
  rate: Micro;
  basicAmount: Micro; // qty * rate, whole paisa
  tracksBatch: boolean;
  tracksExpiry: boolean;
};

// Turns typed rows into complete rows:
//  - the product must belong to the company, be active, and be something you can buy (not a bundle)
//  - STOCK products are kept in their base unit; a quantity typed in an alternate unit becomes
//    qty = altQty * AlternateUnit.conversionFactor (the typed qty is ignored in that case)
//  - basicAmount = qty * rate rounded to paisa
export async function resolveLines(tx: Tx, companyId: number, rows: LineInput[], opts: { allowZeroQty?: boolean } = {}): Promise<ResolvedLine[]> {
  const out: ResolvedLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const n = i + 1;
    const where = (m: string) => `Line ${n}: ${m}`;
    const [p] = await tx.select().from(S.product).where(and(eq(S.product.id, r.productId), eq(S.product.companyId, companyId)));
    if (!p) throw new HttpError(400, where("product not found in this company."), "lines");
    if (!p.isActive) throw new HttpError(409, where(`product ${p.code} is not active.`), "lines");
    if (p.type === "BUNDLE") throw new HttpError(400, where(`${p.code} is a bundle; buy its components instead.`), "lines");

    let unitId = r.unitId ?? null;
    let qty = r.qty === null || r.qty === undefined || r.qty === "" ? null : toMicro(r.qty);
    let altQty: Micro | null = null;
    let altUnitId: number | null = null;
    let tracksBatch = false;
    let tracksExpiry = false;

    if (p.type === "STOCK") {
      const [sd] = await tx.select().from(S.stockDetail).where(eq(S.stockDetail.productId, p.id));
      if (!sd) throw new HttpError(409, where(`stock product ${p.code} has no stock details.`), "lines");
      tracksBatch = sd.tracksBatch;
      tracksExpiry = sd.tracksExpiry;
      if (r.altQty !== null && r.altQty !== undefined && r.altQty !== "") {
        if (!r.altUnitId) throw new HttpError(400, where("an alternate quantity needs an alternate unit."), "lines");
        altQty = toMicro(r.altQty);
        altUnitId = r.altUnitId;
        let factor: Micro;
        if (altUnitId === sd.baseUnitId) factor = toMicro("1");
        else {
          const [au] = await tx.select().from(S.alternateUnit).where(and(eq(S.alternateUnit.stockDetailId, sd.id), eq(S.alternateUnit.unitId, altUnitId)));
          if (!au) throw new HttpError(400, where(`that unit is not an alternate unit of ${p.code}.`), "lines");
          factor = toMicro(au.conversionFactor);
        }
        qty = roundTo(mul(altQty, factor), 6);
        unitId = sd.baseUnitId;
      } else {
        if (r.altUnitId) throw new HttpError(400, where("an alternate unit needs an alternate quantity."), "lines");
        unitId = unitId ?? sd.baseUnitId;
        if (unitId !== sd.baseUnitId) throw new HttpError(400, where(`quantity of ${p.code} is kept in its base unit; use the alternate unit column for other units.`), "lines");
      }
    } else {
      if (r.altQty !== null && r.altQty !== undefined && r.altQty !== "") throw new HttpError(400, where("alternate units exist only for stock products."), "lines");
      // Non-stock goods and services carry their own unit; use it when none is typed.
      if (!unitId && p.type === "NON_STOCK") unitId = (await tx.select({ u: S.nonStockDetail.unitId }).from(S.nonStockDetail).where(eq(S.nonStockDetail.productId, p.id)))[0]?.u ?? null;
      if (!unitId && p.type === "SERVICE") unitId = (await tx.select({ u: S.serviceDetail.unitId }).from(S.serviceDetail).where(eq(S.serviceDetail.productId, p.id)))[0]?.u ?? null;
    }

    if (qty === null) throw new HttpError(400, where("quantity is required."), "lines");
    if (qty < ZERO || (!opts.allowZeroQty && qty === ZERO)) throw new HttpError(400, where("quantity must be greater than zero."), "lines");
    if (!unitId) throw new HttpError(400, where("unit is required."), "lines");
    const rate = toMicro(r.rate ?? 0);
    if (rate < ZERO) throw new HttpError(400, where("rate cannot be negative."), "lines");

    out.push({
      lineNumber: n, productId: p.id, productType: p.type as ResolvedLine["productType"],
      particular: r.particular?.trim() || p.description,
      altQty, altUnitId, qty, unitId, rate, basicAmount: roundTo(mul(qty, rate), 2), tracksBatch, tracksExpiry,
    });
  }
  return out;
}
