import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { type Tx } from "./purchase/common";
import { stockAutoRows, stockAutoSql } from "./stockLedgerAuto";

export type FinancialRowsKind = "trial-balance" | "profit-loss" | "balance-sheet";
export type FinancialRowsQuery = {
  companyId: number;
  branchId: number;
  fiscalYear: string;
  start: string;
  end: string;
  kind: FinancialRowsKind;
  excludeActiveCloseJournals?: boolean;
};
export type FinancialLedgerRow = {
  generalLedgerId: number;
  code: string;
  name: string;
  accountGroupId: number;
  accountGroupCode: string;
  accountGroupName: string;
  accountType: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
  accountSubGroupId: number | null;
  accountSubGroupCode: string | null;
  accountSubGroupName: string | null;
  opening: string;
  debit: string;
  credit: string;
  closing: string;
};

/** Posted balances used by financial reports and year-end close. Debit balances are positive. */
export async function financialReportRows(tx: Tx | typeof db, q: FinancialRowsQuery): Promise<FinancialLedgerRow[]> {
  const auto = await stockAutoRows(tx, { companyId: q.companyId, branchId: q.branchId, fiscalYear: q.fiscalYear, start: q.start, end: q.end });
  const autoSql = stockAutoSql(auto);
  const typeFilter: SQL = q.kind === "profit-loss"
    ? sql`AND ag.type IN ('REVENUE', 'EXPENSE')`
    : q.kind === "balance-sheet"
      ? sql`AND ag.type IN ('ASSET', 'LIABILITY', 'EQUITY')`
      : sql``;
  const excludeActiveClose = q.kind === "profit-loss" && q.excludeActiveCloseJournals !== false ? sql`AND NOT EXISTS (
      SELECT 1 FROM "FiscalYearCloseVoucher" fcv
      JOIN "FiscalYearClose" fc ON fc.id = fcv."fiscalYearCloseId"
      WHERE fcv."journalVoucherId" = v.id AND fc.status = 'CLOSED'
    )` : sql``;
  return await tx.execute(sql`
    WITH chosen AS (
      SELECT g.id, g.code, g.name, ag.id AS "accountGroupId", ag.code AS "accountGroupCode", ag.description AS "accountGroupName", ag.type AS "accountType",
             sg.id AS "accountSubGroupId", sg.code AS "accountSubGroupCode", sg.description AS "accountSubGroupName"
      FROM "GeneralLedger" g
      JOIN "AccountGroup" ag ON ag.id = g."accountGroupId"
      LEFT JOIN "AccountSubGroup" sg ON sg.id = g."accountSubGroupId"
      WHERE g."companyId" = ${q.companyId} ${typeFilter}
    ), opening AS (
      SELECT o."generalLedgerId" AS gl, COALESCE(SUM(o."debit" - o."credit"), 0) AS net
      FROM "OpeningBalance" o JOIN "FiscalYear" fy ON fy.id = o."fiscalYearId"
      JOIN chosen c ON c.id = o."generalLedgerId"
      WHERE o."companyId" = ${q.companyId} AND o."branchId" = ${q.branchId} AND fy.code = ${q.fiscalYear}
      GROUP BY o."generalLedgerId"
    ), tx AS (
      SELECT sa.gl, sa.d, sa.dr, sa.cr FROM ${autoSql} JOIN chosen c ON c.id = sa.gl
      UNION ALL
      SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit"
      FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id = l."journalVoucherId" JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${q.companyId} AND v."branchId" = ${q.branchId} AND v."fiscalYear" = ${q.fiscalYear} AND v."isPosted" = true
        AND v."voucherDate" <= ${q.end}::date ${excludeActiveClose}
      UNION ALL
      SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit"
      FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId" JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${q.companyId} AND v."branchId" = ${q.branchId} AND v."fiscalYear" = ${q.fiscalYear} AND v."isPosted" = true
        AND v."voucherDate" <= ${q.end}::date
    ), sums AS (
      SELECT c.*, COALESCE(o.net, 0) + COALESCE(SUM(tx.dr - tx.cr) FILTER (WHERE tx.d < ${q.start}::date), 0) AS opening,
        COALESCE(SUM(tx.dr) FILTER (WHERE tx.d BETWEEN ${q.start}::date AND ${q.end}::date), 0) AS debit,
        COALESCE(SUM(tx.cr) FILTER (WHERE tx.d BETWEEN ${q.start}::date AND ${q.end}::date), 0) AS credit
      FROM chosen c LEFT JOIN opening o ON o.gl = c.id LEFT JOIN tx ON tx.gl = c.id
      GROUP BY c.id, c.code, c.name, c."accountGroupId", c."accountGroupCode", c."accountGroupName", c."accountType",
        c."accountSubGroupId", c."accountSubGroupCode", c."accountSubGroupName", o.net
    )
    SELECT id AS "generalLedgerId", code, name, "accountGroupId", "accountGroupCode", "accountGroupName", "accountType",
      "accountSubGroupId", "accountSubGroupCode", "accountSubGroupName", opening::text, debit::text, credit::text,
      (opening + debit - credit)::text AS closing
    FROM sums ORDER BY "accountGroupCode", "accountSubGroupCode" NULLS FIRST, code, name
  `) as unknown as FinancialLedgerRow[];
}
