import { Router } from "express";
import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { HttpError, wrap } from "./_util";
import { companyOf, q, whole } from "./_input";
import { parseDate } from "../services/purchase/common";

export const ledgerReportRouter = Router();
const GROUP_FIELDS = ["accountGroup", "accountSubGroup", "generalLedger", "subLedger", "agent", "invoiceAgent", "area", "subArea", "month", "source", "postingStatus", "postedBy"];
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
  // With a sub-ledger chosen, its statement carries its own opening balance, period totals and running balance (never the whole ledger's).
  const subOnLine = subLedgerId ? sql`AND l."subLedgerId" = ${subLedgerId}` : sql``;
  const subOnOpening = subLedgerId ? sql`AND o."subLedgerId" = ${subLedgerId}` : sql``;
  const subOnOpeningRows = subLedgerId ? sql`AND ob."subLedgerId" = ${subLedgerId}` : sql``;
  const fromTs = `${start}`;
  const toTs = `${end}`;

  // Summary grouping stays stable at the ledger/party-master level; transaction totals remain calculated independently below.
  const summary = await db.execute(sql`
    WITH chosen AS (
      SELECT g.id, g.code, g.name,
        sg.id AS "accountSubGroupId", sg.code AS "accountSubGroupCode", sg.description AS "accountSubGroupName",
        ag.id AS "accountGroupId", ag.code AS "accountGroupCode", ag.description AS "accountGroupName",
        COALESCE(p."agentId", g."agentId") AS "agentId", a.code AS "agentCode", a.name AS "agentName",
        COALESCE(p."subAreaId", g."subAreaId") AS "subAreaId", sa.code AS "subAreaCode", sa.name AS "subAreaName", ar.id AS "areaId", ar.code AS "areaCode", ar.name AS "areaName"
      FROM "GeneralLedger" g
      JOIN "AccountSubGroup" sg ON sg.id = g."accountSubGroupId"
      JOIN "AccountGroup" ag ON ag.id = sg."accountGroupId"
      LEFT JOIN "Party" p ON p."generalLedgerId" = g.id
      LEFT JOIN "Agent" a ON a.id = COALESCE(p."agentId", g."agentId")
      LEFT JOIN "SubArea" sa ON sa.id = COALESCE(p."subAreaId", g."subAreaId")
      LEFT JOIN "Area" ar ON ar.id = sa."areaId"
      WHERE g."companyId" = ${companyId} ${ledgerScope}
    ), ob AS (
      SELECT o."generalLedgerId" AS gl, SUM(o."debit" - o."credit") AS net
      FROM "OpeningBalance" o JOIN "FiscalYear" fy ON fy.id = o."fiscalYearId"
      JOIN chosen c ON c.id = o."generalLedgerId"
      WHERE o."companyId" = ${companyId} AND o."branchId" = ${branchId} AND fy.code = ${fiscalYear} ${subOnOpening}
      GROUP BY o."generalLedgerId"
    ), tx AS (
      SELECT l."generalLedgerId" AS gl, v."voucherDate" AS d, l."debit" AS dr, l."credit" AS cr
      FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id = l."journalVoucherId"
      JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true ${subOnLine}
        AND (v."voucherDate" < ${start}::date OR v."voucherDate" BETWEEN ${start}::date AND ${end}::date)
      UNION ALL
      SELECT l."generalLedgerId", v."voucherDate", l."debit", l."credit"
      FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId"
      JOIN chosen c ON c.id = l."generalLedgerId"
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear} AND v."isPosted" = true ${subOnLine}
        AND (v."voucherDate" < ${start}::date OR v."voucherDate" BETWEEN ${start}::date AND ${end}::date)
    ), sums AS (
      SELECT c.id AS gl, c.code, c.name,
        c."accountSubGroupId", c."accountSubGroupCode", c."accountSubGroupName",
        c."accountGroupId", c."accountGroupCode", c."accountGroupName",
        c."agentId", c."agentCode", c."agentName", c."subAreaId", c."subAreaCode", c."subAreaName", c."areaId", c."areaCode", c."areaName",
        COALESCE(o.net, 0) + COALESCE(SUM(tx.dr - tx.cr) FILTER (WHERE tx.d < ${start}::date), 0) AS opening,
        COALESCE(SUM(tx.dr) FILTER (WHERE tx.d BETWEEN ${start}::date AND ${end}::date), 0) AS debit,
        COALESCE(SUM(tx.cr) FILTER (WHERE tx.d BETWEEN ${start}::date AND ${end}::date), 0) AS credit
      FROM chosen c LEFT JOIN ob o ON o.gl = c.id LEFT JOIN tx ON tx.gl = c.id
      GROUP BY c.id, c.code, c.name, c."accountSubGroupId", c."accountSubGroupCode", c."accountSubGroupName",
        c."accountGroupId", c."accountGroupCode", c."accountGroupName", c."agentId", c."agentCode", c."agentName",
        c."subAreaId", c."subAreaCode", c."subAreaName", c."areaId", c."areaCode", c."areaName", o.net
    )
    SELECT gl AS "generalLedgerId", code, name,
      "accountSubGroupId", "accountSubGroupCode", "accountSubGroupName", "accountGroupId", "accountGroupCode", "accountGroupName",
      "agentId", "agentCode", "agentName", "subAreaId", "subAreaCode", "subAreaName", "areaId", "areaCode", "areaName", opening::text,
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

  // ---- Group By (Lines view): whitelisted dimensions only; the client never sends SQL ----
  const groupBy = [...new Set((q(req, "groupBy") || "").split(",").map((v) => v.trim()).filter(Boolean))];
  if (groupBy.length > 3) throw new HttpError(400, "Group by at most 3 fields.", "groupBy");
  for (const f of groupBy) if (!GROUP_FIELDS.includes(f)) throw new HttpError(400, `Unknown group field "${f}".`, "groupBy");
  const monthBounds = (q(req, "monthBounds") || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (monthBounds.length > 40 || monthBounds.some((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v))) throw new HttpError(400, "monthBounds must be up to 40 YYYY-MM-DD dates.", "monthBounds");
  if (groupBy.includes("month") && !monthBounds.length) throw new HttpError(400, "Grouping by month needs monthBounds.", "monthBounds");
  const grouped = groupBy.length > 0;
  const col = (c: string) => sql.raw(`x."${c}"`);
  const pair = (id: string, code: string, name: string) => ({ key: sql`${col(id)}::text`, label: sql`COALESCE(NULLIF(${col(code)}, '') || ' — ' || ${col(name)}, ${col(name)}, 'Unassigned')` });
  const dim = (f: string): { key: SQL; label: SQL } => {
    switch (f) {
      case "accountGroup": return pair("accountGroupId", "accountGroupCode", "accountGroupName");
      case "accountSubGroup": return pair("accountSubGroupId", "accountSubGroupCode", "accountSubGroupName");
      case "generalLedger": return pair("generalLedgerId", "ledgerCode", "ledgerName");
      case "subLedger": return pair("subLedgerId", "subLedgerCode", "subLedgerName");
      case "agent": return pair("agentId", "agentCode", "agentName");
      case "invoiceAgent": return pair("invoiceAgentId", "invoiceAgentCode", "invoiceAgentName");
      case "area": return pair("areaId", "areaCode", "areaName");
      case "subArea": return pair("subAreaId", "subAreaCode", "subAreaName");
      case "source": return { key: sql`${col("sourceLabel")}`, label: sql`${col("sourceLabel")}` };
      case "postingStatus": return { key: sql`CASE WHEN x.posted THEN 'posted' ELSE 'draft' END`, label: sql`CASE WHEN x.posted THEN 'Posted' ELSE 'Draft' END` };
      case "postedBy": return { key: sql`${col("postedBy")}::text`, label: sql`COALESCE(${col("postedByName")}, 'Unassigned')` };
      default: { // month: the client sends the first day of each (BS or AD) month; a line belongs to the latest start on or before its date
        const m = sql`(SELECT max(b)::text FROM unnest(ARRAY[${sql.join(monthBounds.map((d) => sql`${d}::date`), sql`, `)}]) AS b WHERE b <= x.d)`;
        return { key: m, label: m };
      }
    }
  };
  const attrTypes = ["int", "text", "text", "int", "text", "text", "int", "text", "text", "int", "text", "text", "int", "text", "text", "int", "text", "text"];
  const attrNames = ["accountSubGroupId", "accountSubGroupCode", "accountSubGroupName", "accountGroupId", "accountGroupCode", "accountGroupName", "agentId", "agentCode", "agentName", "subAreaId", "subAreaCode", "subAreaName", "areaId", "areaCode", "areaName", "invoiceAgentId", "invoiceAgentCode", "invoiceAgentName"];
  const attrNone = sql.raw(attrTypes.map((t, i) => `NULL::${t} AS "${attrNames[i]}"`).join(", "));
  const attrNoneCb = sql.raw(attrTypes.map((t) => `NULL::${t}`).join(", "));

  // Agent is the same party/ledger-master assignment in Summary and Lines; invoice-header agents have their own Lines-only dimension.
  const cte = sql`
    WITH raw AS (
      SELECT l.id AS "lineId", v.id AS "voucherId", l."generalLedgerId", l."subLedgerId", v."voucherDate" AS d,
        v."voucherNumber", 'JOURNAL'::text AS kind, 'Journal voucher'::text AS "voucherLabel", v."isPosted" AS posted,
        v."postedAt", v."postedBy", u.name AS "postedByName", COALESCE(ia.remarks, v.remarks) AS remarks, l.narration, ia."referenceNo" AS reference,
        v."reversalOfId", (rv.id IS NOT NULL) AS "hasReversal", g.code AS "ledgerCode", g.name AS "ledgerName",
        ${grouped ? sql`sg.id AS "accountSubGroupId", sg.code AS "accountSubGroupCode", sg.description AS "accountSubGroupName",
        ag.id AS "accountGroupId", ag.code AS "accountGroupCode", ag.description AS "accountGroupName",
        COALESCE(ledgerParty."agentId", g."agentId") AS "agentId", a.code AS "agentCode", a.name AS "agentName", COALESCE(pt."subAreaId", g."subAreaId") AS "subAreaId", sa.code AS "subAreaCode", sa.name AS "subAreaName", ar.id AS "areaId", ar.code AS "areaCode", ar.name AS "areaName",
        COALESCE(si."agentId", pb."agentId") AS "invoiceAgentId", invoiceAgent.code AS "invoiceAgentCode", invoiceAgent.name AS "invoiceAgentName"` : attrNone},
        s.code AS "subLedgerCode", s.name AS "subLedgerName", l.debit::text AS debit, l.credit::text AS credit,
        COALESCE(si."invoiceNumber", ia."assessmentNumber", pb."invoiceNumber", v."voucherNumber") AS "sourceNumber",
        CASE WHEN si.id IS NOT NULL THEN 'Sales invoice' WHEN ia.id IS NOT NULL THEN 'Import cost assessment' WHEN pb.id IS NOT NULL THEN 'Purchase bill' ELSE 'Journal voucher' END AS "sourceLabel",
        COALESCE(sp.products, pp.products, '[]'::jsonb) AS products,
        COALESCE(sp.ids, pp.ids, '[]'::jsonb) AS "productIds",
        CASE WHEN si.id IS NOT NULL THEN 'sales-invoices' WHEN ia.id IS NOT NULL THEN 'purchase-import-assessments' WHEN pb.id IS NOT NULL THEN 'purchase-bills' ELSE 'journal' END AS "sourceScreen",
        COALESCE(si.id, ia.id, pb.id, v.id) AS "sourceId"
      FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id = l."journalVoucherId"
      JOIN "GeneralLedger" g ON g.id = l."generalLedgerId" LEFT JOIN "SubLedger" s ON s.id = l."subLedgerId"
      LEFT JOIN "User" u ON u.id = v."postedBy" LEFT JOIN "JournalVoucher" rv ON rv."reversalOfId" = v.id AND rv."isPosted" = true
      LEFT JOIN "SalesInvoice" si ON si."journalVoucherId" = v.id
      LEFT JOIN "PurchaseImportAssessment" ia ON ia."journalVoucherId" = v.id OR ia."reversalVoucherId" = v.id
      LEFT JOIN "PurchaseBill" pb ON pb."journalVoucherId" = v.id OR pb.id = ia."importBillId"
      ${grouped ? sql`LEFT JOIN "AccountSubGroup" sg ON sg.id = g."accountSubGroupId" JOIN "AccountGroup" ag ON ag.id = g."accountGroupId"
      LEFT JOIN "Party" ledgerParty ON ledgerParty."generalLedgerId" = g.id
      LEFT JOIN "Party" pt ON pt.id = COALESCE(s."partyId", (SELECT p0.id FROM "Party" p0 WHERE p0."generalLedgerId" = g.id))
      LEFT JOIN "Agent" a ON a.id = COALESCE(ledgerParty."agentId", g."agentId")
      LEFT JOIN "Agent" invoiceAgent ON invoiceAgent.id = COALESCE(si."agentId", pb."agentId")
      LEFT JOIN "SubArea" sa ON sa.id = COALESCE(pt."subAreaId", g."subAreaId") LEFT JOIN "Area" ar ON ar.id = sa."areaId"` : sql``}
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
        AND v."voucherDate" BETWEEN ${start}::date AND ${end}::date ${idsFilter(ledgerIds, sql`g.id`)} ${subOnLine}
      UNION ALL
      SELECT l.id, v.id, l."generalLedgerId", l."subLedgerId", v."voucherDate", v."voucherNumber", 'CASH_BANK'::text,
        'Cash / bank voucher'::text, v."isPosted", v."postedAt", v."postedBy", u.name, v.remarks, l.narration,
        v."payeeReference", v."reversalOfId", (rv.id IS NOT NULL), g.code, g.name,
        ${grouped ? sql`sg.id, sg.code, sg.description, ag.id, ag.code, ag.description, COALESCE(ledgerParty."agentId", g."agentId"), a.code, a.name, COALESCE(pt."subAreaId", g."subAreaId"), sa.code, sa.name, ar.id, ar.code, ar.name, NULL::int, NULL::text, NULL::text` : attrNoneCb},
        s.code, s.name,
        l.debit::text, l.credit::text, v."voucherNumber", 'Cash / bank voucher', '[]'::jsonb, '[]'::jsonb, 'cash-bank'::text, v.id
      FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id = l."cashBankVoucherId"
      JOIN "GeneralLedger" g ON g.id = l."generalLedgerId" LEFT JOIN "SubLedger" s ON s.id = l."subLedgerId"
      ${grouped ? sql`LEFT JOIN "AccountSubGroup" sg ON sg.id = g."accountSubGroupId" JOIN "AccountGroup" ag ON ag.id = g."accountGroupId"
      LEFT JOIN "Party" ledgerParty ON ledgerParty."generalLedgerId" = g.id
      LEFT JOIN "Party" pt ON pt.id = COALESCE(s."partyId", (SELECT p0.id FROM "Party" p0 WHERE p0."generalLedgerId" = g.id))
      LEFT JOIN "Agent" a ON a.id = COALESCE(ledgerParty."agentId", g."agentId")
      LEFT JOIN "SubArea" sa ON sa.id = COALESCE(pt."subAreaId", g."subAreaId") LEFT JOIN "Area" ar ON ar.id = sa."areaId"` : sql``}
      LEFT JOIN "User" u ON u.id = v."postedBy" LEFT JOIN "CashBankVoucher" rv ON rv."reversalOfId" = v.id AND rv."isPosted" = true
      WHERE v."companyId" = ${companyId} AND v."branchId" = ${branchId} AND v."fiscalYear" = ${fiscalYear}
        AND v."voucherDate" BETWEEN ${start}::date AND ${end}::date ${idsFilter(ledgerIds, sql`g.id`)} ${subOnLine}
    ), opening AS (
      SELECT c.id AS gl, COALESCE(o.net,0) + COALESCE(p.net,0) AS amount
      FROM (SELECT g.id FROM "GeneralLedger" g WHERE g."companyId" = ${companyId} ${idsFilter(ledgerIds, sql`g.id`)}) c
      LEFT JOIN (SELECT "generalLedgerId" gl, SUM("debit" - "credit") net FROM "OpeningBalance" ob JOIN "FiscalYear" fy ON fy.id=ob."fiscalYearId" WHERE ob."companyId"=${companyId} AND ob."branchId"=${branchId} AND fy.code=${fiscalYear} ${subOnOpeningRows} GROUP BY "generalLedgerId") o ON o.gl=c.id
      LEFT JOIN (
        SELECT gl, SUM(dr-cr) net FROM (
          SELECT l."generalLedgerId" gl, l.debit dr, l.credit cr FROM "JournalVoucherLine" l JOIN "JournalVoucher" v ON v.id=l."journalVoucherId" WHERE v."companyId"=${companyId} AND v."branchId"=${branchId} AND v."fiscalYear"=${fiscalYear} AND v."isPosted"=true AND v."voucherDate" < ${start}::date ${subOnLine}
          UNION ALL
          SELECT l."generalLedgerId", l.debit, l.credit FROM "CashBankVoucherLine" l JOIN "CashBankVoucher" v ON v.id=l."cashBankVoucherId" WHERE v."companyId"=${companyId} AND v."branchId"=${branchId} AND v."fiscalYear"=${fiscalYear} AND v."isPosted"=true AND v."voucherDate" < ${start}::date ${subOnLine}
        ) before_rows GROUP BY gl
      ) p ON p.gl=c.id
    ), numbered AS (
      SELECT x.*, COALESCE(o.amount,0) + SUM(CASE WHEN x.posted THEN x.debit::numeric - x.credit::numeric ELSE 0 END)
        OVER (PARTITION BY x."generalLedgerId" ORDER BY x.d, x."voucherNumber", x."voucherId", x."lineId" ROWS UNBOUNDED PRECEDING) AS running
      FROM raw x LEFT JOIN opening o ON o.gl=x."generalLedgerId"
    ), filtered AS (SELECT * FROM numbered x WHERE ${where})`;

  let rows: any[];
  let groupTotals: { keys: (string | null)[]; debit: string; credit: string; count: number }[] | undefined;
  if (!grouped) {
    rows = await db.execute(sql`${cte} SELECT *, COUNT(*) OVER()::int AS total FROM filtered ORDER BY ${rowOrder} LIMIT ${pageSize} OFFSET ${offset}`) as any[];
  } else {
    // Rows are ordered by the group path first, so a group is contiguous across pages; subtotals are summed in SQL over every filtered line, never over the one page on screen.
    const withGroups = sql`${cte}, grouped AS (SELECT x.* ${sql.join(groupBy.map((f, i) => sql`, ${dim(f).key} AS ${sql.raw(`gk${i + 1}`)}, ${dim(f).label} AS ${sql.raw(`gl${i + 1}`)}`), sql``)} FROM filtered x)`;
    const groupOrder = sql.join(groupBy.map((_, i) => sql`${sql.raw(`gk${i + 1}`)} IS NULL, ${sql.raw(`gl${i + 1}`)}, ${sql.raw(`gk${i + 1}`)}`), sql`, `);
    const keyCols = sql.join(groupBy.map((_, i) => sql.raw(`gk${i + 1}`)), sql`, `);
    const [paged, totals] = await Promise.all([
      db.execute(sql`${withGroups} SELECT *, COUNT(*) OVER()::int AS total FROM grouped ORDER BY ${groupOrder}, ${rowOrder} LIMIT ${pageSize} OFFSET ${offset}`) as Promise<any[]>,
      db.execute(sql`${withGroups} SELECT ${keyCols}, SUM(debit::numeric)::text AS debit, SUM(credit::numeric)::text AS credit, COUNT(*)::int AS count FROM grouped GROUP BY ${keyCols}`) as Promise<any[]>,
    ]);
    rows = paged.map((r) => {
      const groupKeys: (string | null)[] = [], groupLabels: string[] = [];
      groupBy.forEach((_, i) => { groupKeys.push(r[`gk${i + 1}`] ?? null); groupLabels.push(r[`gl${i + 1}`]); delete r[`gk${i + 1}`]; delete r[`gl${i + 1}`]; });
      return { ...r, groupKeys, groupLabels };
    });
    groupTotals = totals.map((t) => ({ keys: groupBy.map((_, i) => t[`gk${i + 1}`] ?? null), debit: t.debit, credit: t.credit, count: t.count }));
  }
  res.json({ rows, summary, total: rows.length ? Number(rows[0].total) : 0, page, pageSize, fiscalYear, from: start, to: end, groupBy, groupTotals });
}));
