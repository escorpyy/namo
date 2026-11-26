import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { HttpError, wrap } from "./_util";
import { companyOf, q, whole } from "./_input";
import { parseDate } from "../services/purchase/common";
import { financialReportRows, type FinancialRowsKind } from "../services/financialReportRows";
import { stockMismatches } from "./stockRecon";

export const financialReportsRouter = Router();
financialReportsRouter.get("/:kind", wrap(async (req, res) => {
  const kind = req.params.kind as FinancialRowsKind;
  if (!["trial-balance", "profit-loss", "balance-sheet"].includes(kind)) throw new HttpError(404, "Financial report not found.");
  const companyId = companyOf(req);
  const branchId = whole(q(req, "branchId"), "branchId");
  const fiscalYear = q(req, "fiscalYear");
  const from = q(req, "from");
  const to = q(req, "to");
  if (!fiscalYear) throw new HttpError(400, "fiscalYear is required.", "fiscalYear");
  if (!from || !to) throw new HttpError(400, "A start and end date are required.", "from");
  const start = parseDate(from, "from").toISOString().slice(0, 10);
  const end = parseDate(to, "to").toISOString().slice(0, 10);
  if (start > end) throw new HttpError(400, "Start date must be on or before end date.", "from");
  const fyRows = await db.execute(sql`SELECT id, "startDate"::text AS start, "endDate"::text AS end FROM "FiscalYear" WHERE "companyId" = ${companyId} AND code = ${fiscalYear}`) as any[];
  if (!fyRows.length) throw new HttpError(404, "Fiscal year not found for this company.", "fiscalYear");
  const fyStart = String(fyRows[0].start).slice(0, 10), fyEnd = String(fyRows[0].end).slice(0, 10);
  if (start < fyStart || end > fyEnd) throw new HttpError(400, `Choose dates within fiscal year ${fiscalYear} (${fyStart} to ${fyEnd}).`, "from");
  const rows = await financialReportRows(db, { companyId, branchId, fiscalYear, start, end, kind });
  // Stock Opening value vs the opening balance of the Closing Stock (B/S) ledger: when they differ the stock on the Balance Sheet is off by the difference.
  // The Opening Balance lock refuses a mismatch unless forced; this keeps it visible on the statements afterwards.
  const stockOpeningMismatches = kind === "profit-loss" ? [] : (await stockMismatches(companyId, Number(fyRows[0].id))).filter((m) => m.branchId === branchId);
  const numeric = (v: unknown) => Number(v ?? 0);
  const total = rows.reduce((a, r) => ({ opening: a.opening + numeric(r.opening), debit: a.debit + numeric(r.debit), credit: a.credit + numeric(r.credit), closing: a.closing + numeric(r.closing) }), { opening: 0, debit: 0, credit: 0, closing: 0 });
  const result = rows.map((r) => ({ ...r, net: (numeric(r.debit) - numeric(r.credit)).toFixed(2), closingDebit: Math.max(numeric(r.closing), 0).toFixed(2), closingCredit: Math.max(-numeric(r.closing), 0).toFixed(2) }));
  let currentResult = kind === "profit-loss" ? -total.closing : 0;
  if (kind === "balance-sheet") {
    const pnl = await financialReportRows(db, { companyId, branchId, fiscalYear, start, end, kind: "profit-loss", excludeActiveCloseJournals: false });
    currentResult = -pnl.reduce((sum, row) => sum + numeric(row.closing), 0);
  }
  // The Profit and Loss Account chosen in GL Setup names the period result on the statements.
  const plRow = (await db.execute(sql`SELECT g.id, g.code, g.name FROM "GeneralLedgerSetup" s JOIN "GeneralLedger" g ON g.id = s."generalLedgerId" WHERE s."companyId" = ${companyId} AND s.role = 'PROFIT_AND_LOSS'`) as any[])[0];
  const resultLedger = plRow ? { id: Number(plRow.id), code: String(plRow.code), name: String(plRow.name) } : null;
  res.json({ kind, fiscalYear, from: start, to: end, rows: result, resultLedger, stockOpeningMismatches, totals: { ...total, currentResult: currentResult.toFixed(2), balanced: kind === "trial-balance" ? Math.abs(total.closing) < 0.005 : undefined } });
}));
