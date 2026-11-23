import { Router } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { GL_SETUP_ROLES, type GlRoleKey } from "../../shared/glSetup";
import { inActorTx } from "../services/purchase/common";
import { HttpError, wrap } from "./_util";

export const productGlDefaultsRouter = Router();
const ROLE_KEYS = new Set<GlRoleKey>(GL_SETUP_ROLES.map((role) => role.key));
const PRODUCT_ROLE_KEYS = new Set<GlRoleKey>([
  "OPENING_STOCK_PL", "CLOSING_STOCK_PL", "CLOSING_STOCK_BS", "PURCHASE_ACCOUNT",
  "PURCHASE_RETURN_ACCOUNT", "SALES_ACCOUNT", "SALES_RETURN_ACCOUNT",
]);
const STOCK_FIELDS: Partial<Record<GlRoleKey, { value: any; inherited: any }>> = {
  OPENING_STOCK_PL: { value: S.stockDetail.openingGLId, inherited: S.stockDetail.openingGLDefaulted },
  CLOSING_STOCK_PL: { value: S.stockDetail.closingPLGLId, inherited: S.stockDetail.closingPLGLDefaulted },
  CLOSING_STOCK_BS: { value: S.stockDetail.closingBSGLId, inherited: S.stockDetail.closingBSGLDefaulted },
  PURCHASE_ACCOUNT: { value: S.stockDetail.purchaseGLId, inherited: S.stockDetail.purchaseGLDefaulted },
  PURCHASE_RETURN_ACCOUNT: { value: S.stockDetail.purchaseReturnGLId, inherited: S.stockDetail.purchaseReturnGLDefaulted },
  SALES_ACCOUNT: { value: S.stockDetail.salesGLId, inherited: S.stockDetail.salesGLDefaulted },
  SALES_RETURN_ACCOUNT: { value: S.stockDetail.salesReturnGLId, inherited: S.stockDetail.salesReturnGLDefaulted },
};
const NON_STOCK_FIELDS: Partial<Record<GlRoleKey, { value: any; inherited: any }>> = {
  PURCHASE_ACCOUNT: { value: S.nonStockDetail.purchaseGLId, inherited: S.nonStockDetail.purchaseGLDefaulted },
  SALES_ACCOUNT: { value: S.nonStockDetail.salesGLId, inherited: S.nonStockDetail.salesGLDefaulted },
};

productGlDefaultsRouter.get("/", wrap(async (req, res) => {
  const companyId = Number(req.query.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) throw new HttpError(400, "A valid companyId is required.");
  const rows = await db.select({ role: S.generalLedgerSetup.role, generalLedgerId: S.generalLedgerSetup.generalLedgerId })
    .from(S.generalLedgerSetup).where(eq(S.generalLedgerSetup.companyId, companyId));
  const byRole = new Map(rows.map((row) => [row.role, row.generalLedgerId]));
  res.json({
    companyId,
    stock: {
      openingGLId: byRole.get("OPENING_STOCK_PL") ?? null,
      closingPLGLId: byRole.get("CLOSING_STOCK_PL") ?? null,
      closingBSGLId: byRole.get("CLOSING_STOCK_BS") ?? null,
      purchaseGLId: byRole.get("PURCHASE_ACCOUNT") ?? null,
      purchaseReturnGLId: byRole.get("PURCHASE_RETURN_ACCOUNT") ?? null,
      salesGLId: byRole.get("SALES_ACCOUNT") ?? null,
      salesReturnGLId: byRole.get("SALES_RETURN_ACCOUNT") ?? null,
    },
    nonStock: { purchaseGLId: byRole.get("PURCHASE_ACCOUNT") ?? null, salesGLId: byRole.get("SALES_ACCOUNT") ?? null },
  });
}));

productGlDefaultsRouter.post("/apply", wrap(async (req, res) => {
  const companyId = Number(req.body?.companyId), userId = Number(req.body?.userId);
  const mode = req.body?.mode;
  const roles = req.body?.roles;
  if (!Number.isInteger(companyId) || companyId <= 0 || !Number.isInteger(userId) || userId <= 0) throw new HttpError(400, "Valid companyId and userId are required.");
  if (mode !== "UPDATE_ALL" && mode !== "PRESERVE_EXPLICIT") throw new HttpError(400, "Choose how existing product ledgers should be handled.", "mode");
  if (!Array.isArray(roles) || roles.some((role) => typeof role !== "string" || !ROLE_KEYS.has(role as GlRoleKey) || !PRODUCT_ROLE_KEYS.has(role as GlRoleKey))) throw new HttpError(400, "Invalid product-mapped GL roles.", "roles");
  const changedRoles = [...new Set(roles as GlRoleKey[])];
  const affectedProductIds = new Set<number>();
  await inActorTx({ userId }, undefined, async (tx) => {
    const mappingRows = await tx.select({ role: S.generalLedgerSetup.role, generalLedgerId: S.generalLedgerSetup.generalLedgerId })
      .from(S.generalLedgerSetup).where(eq(S.generalLedgerSetup.companyId, companyId));
    const mappings = new Map(mappingRows.map((row) => [row.role as GlRoleKey, row.generalLedgerId]));
    const productIds = tx.select({ id: S.product.id }).from(S.product)
      .where(and(eq(S.product.companyId, companyId), inArray(S.product.type, ["STOCK", "NON_STOCK"])));
    for (const role of changedRoles) {
      const ledgerId = mappings.get(role);
      if (ledgerId == null) continue; // Never clear a product mapping because a role is unassigned.
      const stock = STOCK_FIELDS[role];
      if (stock) {
        const filter = mode === "UPDATE_ALL" ? undefined : or(eq(stock.inherited, true), isNull(stock.value));
        const rows = await tx.update(S.stockDetail).set({ [stock.value.name]: ledgerId, [stock.inherited.name]: true })
          .where(and(inArray(S.stockDetail.productId, productIds), filter)).returning({ productId: S.stockDetail.productId });
        rows.forEach((row) => affectedProductIds.add(row.productId));
      }
      const nonStock = NON_STOCK_FIELDS[role];
      if (nonStock) {
        const filter = mode === "UPDATE_ALL" ? undefined : eq(nonStock.inherited, true);
        const rows = await tx.update(S.nonStockDetail).set({ [nonStock.value.name]: ledgerId, [nonStock.inherited.name]: true })
          .where(and(inArray(S.nonStockDetail.productId, productIds), filter)).returning({ productId: S.nonStockDetail.productId });
        rows.forEach((row) => affectedProductIds.add(row.productId));
      }
    }
  });
  res.json({ ok: true, affected: affectedProductIds.size, mode });
}));
