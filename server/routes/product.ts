import { Router } from "express";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError, wrap } from "./_util";
import { applyConditions, buildSchema } from "./masterFactory";
import type { MasterDef } from "../../shared/masters";

const P = S.product, SD = S.stockDetail, NS = S.nonStockDetail, SV = S.serviceDetail, FA = S.fixedAssetDetail, BD = S.bundleDetail, AU = S.alternateUnit, BC = S.bundleComponent;
const str = (v: unknown) => (v == null ? null : String(v));
const date = (v: unknown) => (v == null ? null : new Date(`${v}T00:00:00Z`));
const co = (...c: any[]) => sql`coalesce(${sql.join(c, sql`, `)})`;

// Product = ek header (Product) + type ke hisaab se ek detail table (+ Alternate Units / Bundle Components).
// UI me flat form hai; yahan type dekhkar sahi tables me likhte hain, sab ek transaction me.
export function productRouter(def: MasterDef) {
  const r = Router();
  const schema = buildSchema(def, { lenient: true });

  const selectRows = async (o: { companyId?: number; id?: number }) => {
    const rows = await db
      .select({
        id: P.id, code: P.code, description: P.description, shortName: P.shortName, barcode: P.barcode, type: P.type,
        productSubGroupId: P.productSubGroupId, isActive: P.isActive, createdAt: P.createdAt, updatedAt: P.updatedAt,
        // Jo naam kai type me common hain, unhe coalesce se ek field banaya (ek product me ek hi detail row hoti hai)
        unitId: co(SD.baseUnitId, NS.unitId), serviceUnitId: SV.unitId, locationId: co(SD.defaultLocationId, FA.locationId),
        taxRateId: co(SD.taxRateId, NS.taxRateId, SV.taxRateId),
        salesGLId: co(SD.salesGLId, NS.salesGLId, SV.salesGLId, BD.salesGLId), purchaseGLId: co(SD.purchaseGLId, NS.purchaseGLId, SV.purchaseGLId),
        stockCategoryId: SD.stockCategoryId, valuationMethod: SD.valuationMethod, tracksBatch: SD.tracksBatch, tracksExpiry: SD.tracksExpiry,
        purchaseRate: SD.purchaseRate, salesRate: SD.salesRate, mrp: SD.mrp, tradePrice: SD.tradePrice,
        minStock: SD.minStock, maxStock: SD.maxStock, reorderLevel: SD.reorderLevel, reorderQty: SD.reorderQty,
        openingGLId: SD.openingGLId, closingPLGLId: SD.closingPLGLId, closingBSGLId: SD.closingBSGLId,
        purchaseReturnGLId: SD.purchaseReturnGLId, salesReturnGLId: SD.salesReturnGLId, defaultVendorId: SD.defaultVendorId,
        assetGLId: FA.assetGLId, accumulatedDeprGLId: FA.accumulatedDeprGLId, depreciationExpenseGLId: FA.depreciationExpenseGLId,
        purchaseDate: FA.purchaseDate, originalCost: FA.originalCost, salvageValue: FA.salvageValue, usefulLifeYears: FA.usefulLifeYears,
        depreciationMethod: FA.depreciationMethod, depreciationRatePercent: FA.depreciationRatePercent, accumulatedDepreciation: FA.accumulatedDepreciation,
        bundlePrice: BD.bundlePrice,
        bundleUseCount: sql<number>`(select count(*)::int from ${BC} bc where bc."componentProductId" = ${P.id})`,
        stockOpeningCount: sql<number>`(select count(*)::int from ${S.stockOpeningBalance} sob join ${SD} sd2 on sd2."id" = sob."stockDetailId" where sd2."productId" = ${P.id})`,
      })
      .from(P)
      .leftJoin(SD, eq(SD.productId, P.id)).leftJoin(NS, eq(NS.productId, P.id)).leftJoin(SV, eq(SV.productId, P.id))
      .leftJoin(FA, eq(FA.productId, P.id)).leftJoin(BD, eq(BD.productId, P.id))
      .where(and(o.id != null ? eq(P.id, o.id) : undefined, o.companyId != null ? eq(P.companyId, o.companyId) : undefined))
      .orderBy(asc(P.code));
    if (!rows.length) return [];
    const ids = rows.map((x) => x.id);
    const au = await db.select({ productId: SD.productId, unitId: AU.unitId, conversionFactor: AU.conversionFactor }).from(AU).innerJoin(SD, eq(AU.stockDetailId, SD.id)).where(inArray(SD.productId, ids)).orderBy(asc(AU.id));
    const bc = await db.select({ productId: BD.productId, componentProductId: BC.componentProductId, quantity: BC.quantity }).from(BC).innerJoin(BD, eq(BC.bundleDetailId, BD.id)).where(inArray(BD.productId, ids)).orderBy(asc(BC.id));
    return rows.map((x) => ({
      ...x,
      alternateUnits: au.filter((a) => a.productId === x.id).map((a) => ({ unitId: a.unitId, conversionFactor: a.conversionFactor })),
      components: bc.filter((c) => c.productId === x.id).map((c) => ({ componentProductId: c.componentProductId, quantity: c.quantity })),
    }));
  };

  const parse = (raw: unknown) => {
    const p = schema.safeParse(raw);
    if (!p.success) {
      const issue = p.error.issues[0];
      throw new HttpError(400, issue.message, String(issue.path[0] ?? ""));
    }
    return applyConditions(def, p.data as Record<string, any>);
  };

  // Linked rows usi company ke hone chahiye (denormalized companyId trigger db:push se nahi banta)
  async function owned(table: any, ids: unknown[], companyId: number, label: string, field: string) {
    const want = [...new Set(ids.filter((x): x is number => typeof x === "number"))];
    if (!want.length) return;
    const found = await db.select({ id: table.id }).from(table).where(and(inArray(table.id, want), eq(table.companyId, companyId)));
    if (found.length !== want.length) throw new HttpError(400, `${label} not found in this company.`, field);
  }

  async function check(d: Record<string, any>, companyId: number, productId?: number) {
    const [sg] = await db.select({ c: S.productGroup.companyId }).from(S.productSubGroup).innerJoin(S.productGroup, eq(S.productSubGroup.productGroupId, S.productGroup.id)).where(eq(S.productSubGroup.id, d.productSubGroupId));
    if (sg?.c !== companyId) throw new HttpError(400, "Sub Group not found in this company.", "productSubGroupId");
    await owned(S.productUnit, [d.unitId], companyId, "Unit", "unitId");
    await owned(S.productUnit, [d.serviceUnitId], companyId, "Unit", "serviceUnitId");
    await owned(S.stockCategory, [d.stockCategoryId], companyId, "Stock Category", "stockCategoryId");
    await owned(S.location, [d.locationId], companyId, "Location", "locationId");
    await owned(S.taxRate, [d.taxRateId], companyId, "Tax Rate", "taxRateId");
    await owned(S.party, [d.defaultVendorId], companyId, "Default Vendor", "defaultVendorId");
    for (const f of ["openingGLId", "closingPLGLId", "closingBSGLId", "purchaseGLId", "purchaseReturnGLId", "salesGLId", "salesReturnGLId", "assetGLId", "accumulatedDeprGLId", "depreciationExpenseGLId"])
      await owned(S.generalLedger, [d[f]], companyId, "Ledger", f);

    if (d.type === "STOCK") {
      const units: number[] = d.alternateUnits.map((a: any) => a.unitId);
      await owned(S.productUnit, units, companyId, "Alternate unit", "alternateUnits");
      if (units.includes(d.unitId)) throw new HttpError(400, "Alternate Unit cannot be the same as the Base Unit.", "alternateUnits");
      if (new Set(units).size !== units.length) throw new HttpError(400, "The same Alternate Unit appears twice.", "alternateUnits");
      if (d.minStock != null && d.maxStock != null && d.maxStock < d.minStock) throw new HttpError(400, "Max Stock cannot be less than Min Stock.", "maxStock");
    }
    if (d.type === "FIXED_ASSET") {
      if (d.originalCost != null && d.salvageValue > d.originalCost) throw new HttpError(400, "Salvage Value cannot exceed Original Cost.", "salvageValue");
      if (d.originalCost != null && d.accumulatedDepreciation > d.originalCost) throw new HttpError(400, "Accumulated Depreciation cannot exceed Original Cost.", "accumulatedDepreciation");
    }
    if (d.type === "BUNDLE") {
      const ids: number[] = d.components.map((c: any) => c.componentProductId);
      if (new Set(ids).size !== ids.length) throw new HttpError(400, "The same component appears twice.", "components");
      if (productId != null && ids.includes(productId)) throw new HttpError(400, "A bundle cannot contain itself.", "components");
      const comps = await db.select({ id: P.id, type: P.type }).from(P).where(and(inArray(P.id, ids), eq(P.companyId, companyId)));
      if (comps.length !== ids.length) throw new HttpError(400, "Component product not found in this company.", "components");
      if (comps.some((c) => c.type === "BUNDLE")) throw new HttpError(400, "A bundle cannot contain another bundle.", "components");
    }
    // code / barcode: company ke andar case-insensitive unique
    for (const [field, label] of [["code", "Code"], ["barcode", "Barcode"]] as const) {
      if (d[field] == null) continue;
      const [hit] = await db.select({ id: P.id }).from(P).where(and(eq(P.companyId, companyId), sql`lower(${P[field]}) = ${String(d[field]).toLowerCase()}`, productId != null ? ne(P.id, productId) : undefined)).limit(1);
      if (hit) throw new HttpError(409, `${label} '${d[field]}' already exists in this company.`, field);
    }
  }

  // Type ke hisaab se detail table + child rows likho
  async function writeDetail(tx: any, id: number, d: Record<string, any>, create: boolean) {
    const upsert = async (table: any, vals: Record<string, any>): Promise<number> => {
      if (create) return (await tx.insert(table).values({ productId: id, ...vals }).returning({ id: table.id }))[0].id;
      const hit = await tx.update(table).set(vals).where(eq(table.productId, id)).returning({ id: table.id });
      return hit.length ? hit[0].id : (await tx.insert(table).values({ productId: id, ...vals }).returning({ id: table.id }))[0].id;
    };
    switch (d.type) {
      case "STOCK": {
        const sdId = await upsert(SD, {
          baseUnitId: d.unitId, stockCategoryId: d.stockCategoryId, defaultLocationId: d.locationId, taxRateId: d.taxRateId,
          valuationMethod: d.valuationMethod, tracksBatch: d.tracksBatch, tracksExpiry: d.tracksExpiry,
          purchaseRate: str(d.purchaseRate), salesRate: str(d.salesRate), mrp: str(d.mrp), tradePrice: str(d.tradePrice),
          minStock: str(d.minStock), maxStock: str(d.maxStock), reorderLevel: str(d.reorderLevel), reorderQty: str(d.reorderQty),
          openingGLId: d.openingGLId, closingPLGLId: d.closingPLGLId, closingBSGLId: d.closingBSGLId,
          purchaseGLId: d.purchaseGLId, purchaseReturnGLId: d.purchaseReturnGLId, salesGLId: d.salesGLId, salesReturnGLId: d.salesReturnGLId,
          defaultVendorId: d.defaultVendorId,
        });
        await tx.delete(AU).where(eq(AU.stockDetailId, sdId));
        if (d.alternateUnits.length) await tx.insert(AU).values(d.alternateUnits.map((a: any) => ({ stockDetailId: sdId, unitId: a.unitId, conversionFactor: String(a.conversionFactor) })));
        break;
      }
      case "NON_STOCK": await upsert(NS, { unitId: d.unitId, taxRateId: d.taxRateId, salesGLId: d.salesGLId, purchaseGLId: d.purchaseGLId }); break;
      case "SERVICE": await upsert(SV, { unitId: d.serviceUnitId, taxRateId: d.taxRateId, salesGLId: d.salesGLId, purchaseGLId: d.purchaseGLId }); break;
      case "FIXED_ASSET":
        await upsert(FA, {
          assetGLId: d.assetGLId, accumulatedDeprGLId: d.accumulatedDeprGLId, depreciationExpenseGLId: d.depreciationExpenseGLId, locationId: d.locationId,
          purchaseDate: date(d.purchaseDate), originalCost: str(d.originalCost), salvageValue: String(d.salvageValue ?? 0), usefulLifeYears: d.usefulLifeYears,
          depreciationMethod: d.depreciationMethod, depreciationRatePercent: str(d.depreciationRatePercent), accumulatedDepreciation: String(d.accumulatedDepreciation ?? 0),
        });
        break;
      case "BUNDLE": {
        const bdId = await upsert(BD, { salesGLId: d.salesGLId, bundlePrice: str(d.bundlePrice) });
        await tx.delete(BC).where(eq(BC.bundleDetailId, bdId));
        await tx.insert(BC).values(d.components.map((c: any) => ({ bundleDetailId: bdId, componentProductId: c.componentProductId, quantity: String(c.quantity) })));
        break;
      }
    }
  }

  const headerVals = (d: Record<string, any>) => ({ code: d.code, description: d.description, shortName: d.shortName, barcode: d.barcode, productSubGroupId: d.productSubGroupId, isActive: d.isActive });

  r.get("/", wrap(async (req, res) => {
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(companyId)) throw new HttpError(400, "companyId is required.");
    res.json(await selectRows({ companyId }));
  }));

  r.post("/", wrap(async (req, res) => {
    const companyId = Number(req.query.companyId);
    if (!Number.isInteger(companyId)) throw new HttpError(400, "companyId is required.");
    const d = parse(req.body);
    await check(d, companyId);
    const id = await db.transaction(async (tx) => {
      const [p] = await tx.insert(P).values({ companyId, type: d.type, ...headerVals(d) }).returning({ id: P.id });
      await writeDetail(tx, p.id, d, true);
      return p.id;
    });
    res.status(201).json((await selectRows({ id }))[0]);
  }));

  r.put("/:id", wrap(async (req, res) => {
    const id = Number(req.params.id);
    const [ex] = await db.select().from(P).where(eq(P.id, id));
    if (!ex) throw new HttpError(404, "Product not found.");
    const d = parse(req.body);
    if (d.type !== ex.type) throw new HttpError(409, "Product type cannot be changed after creation (create a new product instead).", "type");
    await check(d, ex.companyId, id);
    await db.transaction(async (tx) => {
      await tx.update(P).set(headerVals(d)).where(eq(P.id, id));
      await writeDetail(tx, id, d, false);
    });
    res.json((await selectRows({ id }))[0]);
  }));

  r.delete("/:id", wrap(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await selectRows({ id });
    if (!row) throw new HttpError(404, "Product not found.");
    for (const c of def.counts ?? []) {
      const n = (row as any)[c.key] as number;
      if (n > 0) throw new HttpError(409, `Cannot delete: ${n} ${c.label} linked to this Product.`);
    }
    await db.delete(P).where(eq(P.id, id)); // detail tables cascade
    res.json({ ok: true });
  }));

  return r;
}
