import { Router } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { HttpError, wrap } from "./_util";
import { companyOf, q, whole } from "./_input";
import { parseDate } from "../services/purchase/common";

export const ledgerReportRouter = Router();
const idsFilter = (ids: number[], column: SQL) => ids.length ? sql`AND ${column} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})` : sql``;
function selectedIds(raw: string | undefined): number[] {
  if (!raw) return [];
  const ids = [...new Set(raw.split(",").map((v) => Number(v)))];
  if (ids.length > 100 || ids.some((v) => !Number.isSafeInteger(v) || v <= 0)) throw new HttpError(400, "Select up to 100 valid ledgers.", "ledgerIds");
  return ids;
}

ledgerReportRouter.get("/lookups", wrap(async (req, res) => {
  const companyId = companyOf(req);
  const ledgers = await db.execute(sql`
    SELECT g.id, g.code, g.name, g."glType" AS type, g."requiresSubLedger" AS "requiresSubLedger", g."isActive" AS "isActive"
      FROM "GeneralLedger" g WHERE g."companyId" = ${companyId}
      ORDER BY g.code, g.name
  `) as any[];
  const subLedgers = await db.execute(sql`
    SELECT s.id, s.code, s.name, s."generalLedgerId" FROM "SubLedger" s
    JOIN "GeneralLedger" g ON g.id = s."generalLedgerId"
    WHERE g."companyId" = ${companyId} ORDER BY g.code, s.code, s.name
  `) as any[];
  const products = await db.execute(sql`
    SELECT id, code, description FROM "Product" WHERE "companyId" = ${companyId} ORDER BY code, description
  `) as any[];
  res.json({ ledgers, subLedgers, products });
}));

ledgerReportRouter.get("/", wrap(async (req, res) => {
  const companyId = companyOf(req);
  const branchId = whole(q(req, "branchId"), "branchId");
  const fiscalYear = q(req, "fiscalYear");
  if (!fiscalYear) throw new HttpError(400, "fiscalYear is required.", "fiscalYear");
  const from = q(req, "from");
  const to = q(req, "to");
  if (!from || !to) throw new HttpError(400, "A start and end date are required.", "from");
  const start = parseDate(from, "from").toISOString().slice(0, 10);
  const end = parseDate(to, "to").toISOString().slice(0, 10);
  if (start > end) throw new HttpError(400, "Start date must be on or before end date.", "from");
  const fyRows = await db.execute(sql`SELECT "startDate"::text AS start, "endDate"::text AS end FROM "FiscalYear" WHERE "companyId" = ${companyId} AND code = ${fiscalYear}`) as any[];
  if (!fyRows.length) throw new HttpError(404, "Fiscal year not found for this company.", "fiscalYear");
  const fyStart = String(fyRows[0].start).slice(0, 10), fyEnd = String(fyRows[0].end).slice(0, 10);
  if (start < fyStart || end > fyEnd) throw new HttpError(400, `Choose dates within fiscal year ${fiscalYear} (${fyStart} to ${fyEnd}).`, "from");

  const ledgerIds = selectedIds(q(req, "ledgerIds"));
  const subLedgerId = q(req, "subLedgerId") ? whole(q(req, "subLedgerId"), "subLedgerId") : null;
  const page = Math.max(1, Math.min(100000, Number(q(req, "page") || 1) || 1));
  const pageSize = Math.max(20, Math.min(200, Number(q(req, "pageSize") || 100) || 100));
  const offset = (page - 1) * pageSize;
  const status = q(req, "status") || "POSTED";
  if (!["POSTED", "DRAFT", "ALL"].includes(status)) throw new HttpError(400, "Status must be POSTED, DRAFT or ALL.", "status");
  const voucherType = q(req, "voucherType") || "ALL";
  if (!["ALL", "JOURNAL", "CASH_BANK"].includes(voucherType)) throw new HttpError(400, "Invalid voucher type.", "voucherType");
  const productId = q(req, "productId") ? whole(q(req, "productId"), "productId") : null;
  const search = (q(req, "search") || "").trim().slice(0, 120);
  const ledgerScope = idsFilter(ledgerIds, sql`g.id`);
  const subScope = subLedgerId ? sql`AND x."subLedgerId" = ${subLedgerId}` : sql``;
  const fromTs = `${start}`;
  const toTs = `${end}`;

  const summary = await db.execute(sql`
    WITH chosen AS (
      SELECT g.id, g.code, g.name FROM "GeneralLedger" g
      WHERE g."companyId" = ${companyId} ${ledgerScope}
    ), ob AS (
      SELECT o."generalLedgerId" AS gl, SUM(o."debit" - o."credit") AS net
      FROM "OpeningBalance" o JOIN "FiscalYear" fy ON fy.id = o."fiscalYearId"
      JOIN chosen c ON c.id = o."generalLedgerId"
      WHERE o."companyId" = ${companyId} AND o."branchId" = ${branchId} AND fy.code = ${fiscalYear}
      GROUP BY o."generalLedgerId"
    ), tx AS (
      SELECT l."generalLedgerId" AS gl, v."voucherDate" AS d, l."debit" AS dr, l."credit" AS cr
      FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id = l."journalVoucherId"
      JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true
        AND (v."voucherDate" < ${start}::date OR v."voucherDate" BETWEEN ${start}::date AND ${end}::date)
      UNION ALL
      SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit"
      FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId"
      JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true
        AND (v."voucherDate" < ${start}::date OR v."voucherDate" BETWEEN ${start}::date AND ${end}::date)
    ), sums AS (
      SELECT c.id AS gl, c.code, c.name,
        COALESCE(o.net, 0) + COALESCE(SUM(tx.dr - tx.cr) FILTER (WHERE tx.d < ${start}::date), 0) AS opening,
        COALESCE(SUM(tx.dr) FILTER (WHERE tx.d BETWEEN ${start}::date AND ${end}::date), 0) AS debit,
        COALESCE(SUM(tx.cr) FILTER (WHERE tx.d BETWEEN ${start}::date AND ${end}::date), 0) AS credit
      FROM chosen c LEFT JOIN ob o ON o.gl = c.id LEFT JOIN tx ON tx.gl = c.id GROUP BY c.id, c.code, c.name, o.net
    )
    SELECT gl AS "generalLedgerId", code, name, opening::text,
      debit::text, credit::text, (opening + debit - credit)::text AS closing FROM sums ORDER BY code, name
  `) as any[];

  const filters: SQL[] = [sql`x.d BETWEEN ${start}::date AND ${end}::date`];
  if (status === "POSTED") filters.push(sql`x.posted = true`);
  if (status === "DRAFT") filters.push(sql`x.posted = false`);
  if (voucherType !== "ALL") filters.push(sql`x.kind = ${voucherType}`);
  if (subLedgerId) filters.push(sql`x."subLedgerId" = ${subLedgerId}`);
  if (productId) filters.push(sql`x."productIds" @> to_jsonb(ARRAY[${productId}]::int[])`);
  if (search) filters.push(sql`(x."voucherNumber" ILIKE ${`%${search}%`} OR COALESCE(x.remarks,'') ILIKE ${`%${search}%`} OR COALESCE(x.narration,'') ILIKE ${`%${search}%`} OR COALESCE(x.reference,'') ILIKE ${`%${search}%`} OR x."ledgerName" ILIKE ${`%${search}%`} OR COALESCE(x."subLedgerName",'') ILIKE ${`%${search}%`} OR x.products::text ILIKE ${`%${search}%`})`);
  const where = sql.join(filters, sql` AND `);
  const rowOrder = ledgerIds.length !== 1 ? sql`"ledgerCode", d, "voucherNumber", "voucherId", "lineId"` : sql`d, "voucherNumber", "voucherId", "lineId"`;

  const rows = await db.execute(sql`
    WITH raw AS (
      SELECT l.id AS "lineId", v.id AS "voucherId", l."generalLedgerId", l."subLedgerId", v."voucherDate" AS d,
        v."voucherNumber", 'JOURNAL'::text AS kind, 'Journal voucher'::text AS "voucherLabel", v."isPosted" AS posted,
        v."postedAt", v."postedBy", u.name AS "postedByName", COALESCE(ia.remarks, v.remarks) AS remarks, l.narration, ia."referenceNo" AS reference,
        v."reversalOfId", (rv.id IS NOT NULL) AS "hasReversal", g.code AS "ledgerCode", g.name AS "ledgerName",
        s.code AS "subLedgerCode", s.name AS "subLedgerName", l.debit::text AS debit, l.credit::text AS credit,
        COALESCE(si."invoiceNumber", ia."assessmentNumber", pb."invoiceNumber", v."voucherNumber") AS "sourceNumber",
        CASE WHEN si.id IS NOT NULL THEN 'Sales invoice' WHEN ia.id IS NOT NULL THEN 'Import cost assessment' WHEN pb.id IS NOT NULL THEN 'Purchase bill' ELSE 'Journal voucher' END AS "sourceLabel",
        COALESCE(sp.products, pp.products, '[]'::jsonb) AS products,
        COALESCE(sp.ids, pp.ids, '[]'::jsonb) AS "productIds"
      FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id = l."journalVoucherId"
      JOIN "GeneralLedger" g ON g.id = l."generalLedgerId" LEFT JOIN "SubLedger" s ON s.id = l."subLedgerId"
      LEFT JOIN "User" u ON u.id = v."postedBy" LEFT JOIN "JournalVoucher" rv ON rv."reversalOfId" = v.id AND rv."isPosted" = true
      LEFT JOIN "SalesInvoice" si ON si."journalVoucherId" = v.id
      LEFT JOIN "PurchaseImportAssessment" ia ON ia."journalVoucherId" = v.id OR ia."reversalVoucherId" = v.id
      LEFT JOIN "PurchaseBill" pb ON pb."journalVoucherId" = v.id OR pb.id = ia."importBillId"
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'description', p.description, 'qty', sl.qty::text, 'unit', pu.code, 'altQty', sl."altQty"::text, 'altUnit', au.code, 'rate', sl.rate::text, 'amount', sl."basicAmount"::text) ORDER BY sl."lineNumber") AS products,
          jsonb_agg(p.id) AS ids
        FROM "SalesInvoiceLine" sl JOIN "Product" p ON p.id = sl."productId" JOIN "ProductUnit" pu ON pu.id = sl."unitId" LEFT JOIN "ProductUnit" au ON au.id = sl."altUnitId" WHERE sl."salesInvoiceId" = si.id
      ) sp ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'description', p.description, 'qty', pl.qty::text, 'unit', pu.code, 'altQty', pl."altQty"::text, 'altUnit', au.code, 'rate', pl.rate::text, 'amount', pl."basicAmount"::text, 'location', loc.name, 'batch', pl."batchNo", 'expiry', pl."expiryDate"::text) ORDER BY pl."lineNumber") AS products,
          jsonb_agg(p.id) AS ids
        FROM "PurchaseBillLine" pl JOIN "Product" p ON p.id = pl."productId" JOIN "ProductUnit" pu ON pu.id = pl."unitId" LEFT JOIN "ProductUnit" au ON au.id = pl."altUnitId" LEFT JOIN "Location" loc ON loc.id = pl."locationId" WHERE pl."purchaseBillId" = pb.id
      ) pp ON true
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear}
        AND v."voucherDate" BETWEEN ${start}::date AND ${end}::date ${idsFilter(ledgerIds, sql`g.id`)}
      UNION ALL
      SELECT l.id, v.id, l."generalLedgerId", l."subLedgerId", v."voucherDate", v."voucherNumber", 'CASH_BANK'::text,
        'Cash / bank voucher'::text, v."isPosted", v."postedAt", v."postedBy", u.name, v.remarks, l.narration,
        v."payeeReference", v."reversalOfId", (rv.id IS NOT NULL), g.code, g.name, s.code, s.name,
        l.debit::text, l.credit::text, v."voucherNumber", 'Cash / bank voucher', '[]'::jsonb, '[]'::jsonb
      FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId"
      JOIN "GeneralLedger" g ON g.id = l."generalLedgerId" LEFT JOIN "SubLedger" s ON s.id = l."subLedgerId"
      LEFT JOIN "User" u ON u.id = v."postedBy" LEFT JOIN "CashBankVoucher" rv ON rv."reversalOfId" = v.id AND rv."isPosted" = true
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear}
        AND v."voucherDate" BETWEEN ${start}::date AND ${end}::date ${idsFilter(ledgerIds, sql`g.id`)}
    ), opening AS (
      SELECT c.id AS gl, COALESCE(o.net,0) + COALESCE(p.net,0) AS amount
      FROM (SELECT g.id FROM "GeneralLedger" g WHERE g."companyId" = ${companyId} ${idsFilter(ledgerIds, sql`g.id`)}) c
      LEFT JOIN (SELECT "generalLedgerId" gl, SUM("debit" - "credit") net FROM "OpeningBalance" ob JOIN "FiscalYear" fy ON fy.id=ob."fiscalYearId" WHERE ob."companyId"=${companyId} AND ob."branchId"=${branchId} AND fy.code=${fiscalYear} GROUP BY "generalLedgerId") o ON o.gl=c.id
      LEFT JOIN (
        SELECT gl, SUM(dr-cr) net FROM (
          SELECT l."generalLedgerId" gl, l.debit dr, l.credit cr FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id=l."journalVoucherId" WHERE v."companyId"=${companyId} AND v."branchId"=${branchId} AND v."fiscalYear"=${fiscalYear} AND v."isPosted"=true AND v."voucherDate" < ${start}::date
          UNION ALL
          SELECT l."generalLedgerId", l.debit, l.credit FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id=l."cashBankVoucherId" WHERE v."companyId"=${companyId} AND v."branchId"=${branchId} AND v."fiscalYear"=${fiscalYear} AND v."isPosted"=true AND v."voucherDate" < ${start}::date
        ) before_rows GROUP BY gl
      ) p ON p.gl=c.id
    ), numbered AS (
      SELECT x.*, COALESCE(o.amount,0) + SUM(CASE WHEN x.posted THEN x.debit::numeric - x.credit::numeric ELSE 0 END)
        OVER (PARTITION BY x."generalLedgerId" ORDER BY x.d, x."voucherNumber", x."voucherId", x."lineId" ROWS UNBOUNDED PRECEDING) AS running
      FROM raw x LEFT JOIN opening o ON o.gl=x."generalLedgerId"
    ), filtered AS (SELECT * FROM numbered x WHERE ${where})
    SELECT *, COUNT(*) OVER()::int AS total FROM filtered ORDER BY ${rowOrder} LIMIT ${pageSize} OFFSET ${offset}
  `) as any[];
  res.json({ rows, summary, total: rows.length ? Number(rows[0].total) : 0, page, pageSize, fiscalYear, from: start, to: end });
}));
