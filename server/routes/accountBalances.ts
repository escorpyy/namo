import { Router } from "express";
import { accountBalances } from "../services/accountBalances";
import { HttpError, wrap } from "./_util";
import { companyOf, optWhole, q, whole } from "./_input";

export const accountBalancesRouter = Router();

accountBalancesRouter.get("/", wrap(async (req, res) => {
  const date = q(req, "date");
  const fiscalYear = q(req, "fiscalYear");
  if (!date) throw new HttpError(400, "date is required.", "date");
  if (!fiscalYear) throw new HttpError(400, "fiscalYear is required.", "fiscalYear");

  res.json({ rows: await accountBalances({
    companyId: companyOf(req),
    branchId: whole(q(req, "branchId"), "branchId"),
    fiscalYear: fiscalYear.slice(0, 15),
    date,
    excludeJournalVoucherId: optWhole(q(req, "excludeJournalVoucherId"), "excludeJournalVoucherId") ?? null,
    excludeCashBankVoucherId: optWhole(q(req, "excludeCashBankVoucherId"), "excludeCashBankVoucherId") ?? null,
  }) });
}));
