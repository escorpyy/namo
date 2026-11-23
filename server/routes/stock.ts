import { Router } from "express";
import { db } from "../db";
import { stockBalance } from "../services/stockLedger";
import { HttpError, wrap } from "./_util";

// GET /api/stock/balance?companyId[&branchId][&productId][&locationId][&asOf=YYYY-MM-DD]
// Stock on hand by product, location and batch, from the stock ledger.
export const stockRouter = Router();

const whole = (v: unknown, name: string, required = true): number | undefined => {
  if (v === undefined || v === "") { if (required) throw new HttpError(400, `${name} is required.`, name); return undefined; }
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} must be a whole number.`, name);
  return n;
};

stockRouter.get("/balance", wrap(async (req, res) => {
  const asOfText = typeof req.query.asOf === "string" ? req.query.asOf : "";
  if (asOfText && !/^\d{4}-\d{2}-\d{2}$/.test(asOfText)) throw new HttpError(400, "asOf must be a date like 2026-11-23.", "asOf");
  res.json(await stockBalance(db, {
    companyId: whole(req.query.companyId, "companyId")!, branchId: whole(req.query.branchId, "branchId", false),
    productId: whole(req.query.productId, "productId", false), locationId: whole(req.query.locationId, "locationId", false),
    asOf: asOfText ? new Date(`${asOfText}T00:00:00Z`) : undefined,
  }));
}));
