import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { HttpError, wrap } from "./_util";
import { companyOf, q, whole } from "./_input";
import { parseDate } from "../services/purchase/common";
import { stockAutoRows, stockAutoSql } from "../services/stockLedgerAuto";

export const financialReportsRouter = Router();

type ReportKind = "trial-balance" | "profit-loss" | "balance-sheet";

financialReportsRouter.get("/:kind", wrap(async (req, res) => {
  const kind = req.params.kind as ReportKind;
  if (!["trial-balance", "profit-loss", "balance-sheet"].includes(kind)) {
    throw new HttpError(404, "Financial report not found.");
  }
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
  const fyRows = await db.execute(sql`SELECT "startDate"::text AS start, "endDate"::text AS end FROM "FiscalYear" WHERE "companyId" = ${companyId} AND code = ${fiscalYear}`) as any[];
  if (!fyRows.length) throw new HttpError(404, "Fiscal year not found for this company.", "fiscalYear");
  const fyStart = String(fyRows[0].start).slice(0, 10), fyEnd = String(fyRows[0].end).slice(0, 10);
  if (start < fyStart || end > fyEnd) throw new HttpError(400, `Choose dates within fiscal year ${fiscalYear} (${fyStart} to ${fyEnd}).`, "from");

  const auto = await stockAutoRows(db, { companyId, branchId, fiscalYear, start, end });
  const autoSql = stockAutoSql(auto);
  const typeFilter = kind === "profit-loss"
    ? sql`AND ag.type IN ('REVENUE', 'EXPENSE')`
    : kind === "balance-sheet"
      ? sql`AND ag.type IN ('ASSET', 'LIABILITY', 'EQUITY')`
      : sql``;

  const rows = await db.execute(sql`
    WITH chosen AS (
      SELECT g.id, g.code, g.name, ag.id AS "accountGroupId", ag.code AS "accountGroupCode", ag.description AS "accountGroupName", ag.type AS "accountType",
             sg.id AS "accountSubGroupId", sg.code AS "accountSubGroupCode", sg.description AS "accountSubGroupName"
      FROM "GeneralLedger" g
      JOIN "AccountGroup" ag ON ag.id = g."accountGroupId"
      LEFT JOIN "AccountSubGroup" sg ON sg.id = g."accountSubGroupId"
      WHERE g."companyId" = ${companyId} ${typeFilter}
    ), opening AS (
      SELECT o."generalLedgerId" AS gl, COALESCE(SUM(o."debit" - o."credit"), 0) AS net
      FROM "OpeningBalance" o JOIN "FiscalYear" fy ON fy.id = o."fiscalYearId"
      JOIN chosen c ON c.id = o."generalLedgerId"
      WHERE o."companyId" = ${companyId} AND o."branchId" = ${branchId} AND fy.code = ${fiscalYear}
      GROUP BY o."generalLedgerId"
    ), tx AS (
      SELECT sa.gl, sa.d, sa.dr, sa.cr FROM ${autoSql} JOIN chosen c ON c.id = sa.gl
      UNION ALL
      SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit"
      FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id = l."journalVoucherId" JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true
        AND v."voucherDate" <= ${end}::date
      UNION ALL
      SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit"
      FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId" JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true
        AND v."voucherDate" <= ${end}::date
    ), sums AS (
      SELECT c.*, COALESCE(o.net, 0) + COALESCE(SUM(tx.dr - tx.cr) FILTER (WHERE tx.d < ${start}::date), 0) AS opening,
        COALESCE(SUM(tx.dr) FILTER (WHERE tx.d BETWEEN ${start}::date AND ${end}::date), 0) AS debit,
        COALESCE(SUM(tx.cr) FILTER (WHERE tx.d BETWEEN ${start}::date AND ${end}::date), 0) AS credit
      FROM chosen c LEFT JOIN opening o ON o.gl = c.id LEFT JOIN tx ON tx.gl = c.id
      GROUP BY c.id, c.code, c.name, c."accountGroupId", c."accountGroupCode", c."accountGroupName", c."accountType",
        c."accountSubGroupId", c."accountSubGroupCode", c."accountSubGroupName", o.net
    )
    SELECT id AS "generalLedgerId", code, name, "accountGroupId", "accountGroupCode", "accountGroupName", "accountType",
      "accountSubGroupId", "accountSubGroupCode", "accountSubGroupName", opening::text, debit::text, credit::text,
      (opening + debit - credit)::text AS closing
    FROM sums ORDER BY "accountGroupCode", "accountSubGroupCode" NULLS FIRST, code, name
  `) as any[];

  const numeric = (v: unknown) => Number(v ?? 0);
  const total = rows.reduce((a, r) => ({ opening: a.opening + numeric(r.opening), debit: a.debit + numeric(r.debit), credit: a.credit + numeric(r.credit), closing: a.closing + numeric(r.closing) }), { opening: 0, debit: 0, credit: 0, closing: 0 });
  const result = rows.map((r) => ({ ...r, net: (numeric(r.debit) - numeric(r.credit)).toFixed(2), closingDebit: Math.max(numeric(r.closing), 0).toFixed(2), closingCredit: Math.max(-numeric(r.closing), 0).toFixed(2) }));
  const pnl = kind === "balance-sheet" ? await db.execute(sql`
    WITH chosen AS (SELECT g.id FROM "GeneralLedger" g JOIN "AccountGroup" ag ON ag.id = g."accountGroupId" WHERE g."companyId" = ${companyId} AND ag.type IN ('REVENUE','EXPENSE')),
    rows AS (
      SELECT sa.gl, sa.d, sa.dr, sa.cr FROM ${autoSql} JOIN chosen c ON c.id = sa.gl
      UNION ALL SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit" FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id = l."journalVoucherId" JOIN chosen c ON c.id = l."generalLedgerId" WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${end}::date
      UNION ALL SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit" FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId" JOIN chosen c ON c.id = l."generalLedgerId" WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true AND v."voucherDate" <= ${end}::date
    ), opening AS (SELECT o."generalLedgerId" AS gl, SUM(o."debit" - o."credit") AS net FROM "OpeningBalance" o JOIN "FiscalYear" fy ON fy.id = o."fiscalYearId" JOIN chosen c ON c.id = o."generalLedgerId" WHERE o."companyId" = ${companyId} AND o."branchId" = ${branchId} AND fy.code = ${fiscalYear} GROUP BY o."generalLedgerId")
    SELECT COALESCE(SUM(COALESCE(o.net, 0) + COALESCE(r.net, 0)), 0)::text AS net FROM opening o FULL JOIN (SELECT gl, SUM(dr - cr) FILTER (WHERE d BETWEEN ${start}::date AND ${end}::date) AS net FROM rows GROUP BY gl) r ON r.gl = o.gl
  `) as any[] : [];
  const currentResult = kind === "balance-sheet" ? -numeric(pnl[0]?.net) : kind === "profit-loss" ? -total.closing : 0;
  res.json({ kind, fiscalYear, from: start, to: end, rows: result, totals: { ...total, currentResult: currentResult.toFixed(2), balanced: kind === "trial-balance" ? Math.abs(total.closing) < 0.005 : undefined } });
}));
