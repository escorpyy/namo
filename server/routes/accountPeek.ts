import { Router } from "express";
import { accountPeek } from "../services/accountPeek";
import { HttpError, wrap } from "./_util";
import { companyOf, optWhole, q, whole } from "./_input";

export const accountPeekRouter = Router();

// GET /api/account-peek: balance and last posted entries of one ledger (or one sub-ledger of it), for the panel beside the voucher screens.
accountPeekRouter.get("/", wrap(async (req, res) => {
  const date = q(req, "date");
  const fiscalYear = q(req, "fiscalYear");
  if (!date) throw new HttpError(400, "date is required.", "date");
  if (!fiscalYear) throw new HttpError(400, "fiscalYear is required.", "fiscalYear");

  res.json(await accountPeek({
    companyId: companyOf(req),
    branchId: whole(q(req, "branchId"), "branchId"),
    fiscalYear: fiscalYear.slice(0, 15),
    date,
    generalLedgerId: whole(q(req, "generalLedgerId"), "generalLedgerId"),
    subLedgerId: optWhole(q(req, "subLedgerId"), "subLedgerId") ?? null,
    excludeJournalVoucherId: optWhole(q(req, "excludeJournalVoucherId"), "excludeJournalVoucherId") ?? null,
    excludeCashBankVoucherId: optWhole(q(req, "excludeCashBankVoucherId"), "excludeCashBankVoucherId") ?? null,
    limit: optWhole(q(req, "limit"), "limit"),
  }));
}));
