import { sql } from "drizzle-orm";
import { db } from "../db";
import { type Micro, ZERO, fmt, toMicro } from "./purchase/money";
import { stockValuation } from "./stockValuation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// AUTOMATIC STOCK LEDGERS (periodic method, no vouchers): the stock ledgers named in each product's master move by themselves with the stock.
//   Closing Stock (P&L)  : Cr  closing value                       (closing value = Stock Valuation as on the date)
//   Closing Stock (B/S)  : Dr  closing value - opening value       (the opening value already sits in its Opening Balance)
//   Opening Stock (P&L)  : Dr  opening value                       (the stock entered as opening for the fiscal year)
// so Opening + Purchases + direct costs - Closing in one account group is the COGS, and it changes with every purchase and sale.
// Each balance is as on a date inside one fiscal year; before the year starts it is nil (a new year restarts the P&L side).

export type StockAutoRow = { generalLedgerId: number; d: string; dr: Micro; cr: Micro };

const day = (iso: string, n: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** Net automatic amount (Dr positive) per stock ledger as on `asOf` within the fiscal year starting `fyStart`. */
export async function stockLedgerBalances(tx: Tx | typeof db, q: { companyId: number; branchId: number; fiscalYearId: number; fyStart: string; asOf: string }): Promise<Map<number, Micro>> {
  const out = new Map<number, Micro>();
  if (q.asOf < q.fyStart) return out;
  const maps = (await tx.execute(sql`
    SELECT sd."productId" AS pid, sd."openingGLId" AS opl, sd."closingPLGLId" AS cpl, sd."closingBSGLId" AS cbs
      FROM "StockDetail" sd JOIN "Product" p ON p.id = sd."productId"
     WHERE p."companyId" = ${q.companyId} AND (sd."openingGLId" IS NOT NULL OR sd."closingPLGLId" IS NOT NULL OR sd."closingBSGLId" IS NOT NULL)`)) as any[];
  if (!maps.length) return out;
  const gl = new Map(maps.map((r) => [Number(r.pid), { opl: r.opl == null ? null : Number(r.opl), cpl: r.cpl == null ? null : Number(r.cpl), cbs: r.cbs == null ? null : Number(r.cbs) }]));
  const opening = new Map<number, Micro>(); // product -> value entered as the year's opening stock
  for (const r of (await tx.execute(sql`
    SELECT sd."productId" AS pid, COALESCE(SUM(o.value), 0)::text AS v FROM "StockOpeningBalance" o JOIN "StockDetail" sd ON sd.id = o."stockDetailId"
     WHERE o."branchId" = ${q.branchId} AND o."fiscalYearId" = ${q.fiscalYearId} GROUP BY 1`)) as any[]) opening.set(Number(r.pid), toMicro(r.v));
  const closing = new Map<number, Micro>();
  for (const r of (await stockValuation(tx, { companyId: q.companyId, branchId: q.branchId, asOf: q.asOf })).rows) closing.set(r.productId, toMicro(r.value));
  const add = (id: number | null | undefined, v: Micro) => { if (id && v !== ZERO) out.set(id, (out.get(id) ?? ZERO) + v); };
  for (const [pid, g] of gl) {
    const c = closing.get(pid) ?? ZERO, o = opening.get(pid) ?? ZERO;
    add(g.cpl, -c);
    add(g.cbs, c - o);
    add(g.opl, o);
  }
  return out;
}

/** The automatic stock movement as ledger rows for a report from `start` to `end`: what stood before `start` (dated the day before) and the change inside the period (dated `end`). */
export async function stockAutoRows(tx: Tx | typeof db, q: { companyId: number; branchId: number; fiscalYear: string; start: string; end: string }): Promise<StockAutoRow[]> {
  const [fy] = (await tx.execute(sql`SELECT id, "startDate"::text AS s, "endDate"::text AS e FROM "FiscalYear" WHERE "companyId" = ${q.companyId} AND code = ${q.fiscalYear}`)) as any[];
  if (!fy) return [];
  const base = { companyId: q.companyId, branchId: q.branchId, fiscalYearId: Number(fy.id), fyStart: String(fy.s) };
  const before = await stockLedgerBalances(tx, { ...base, asOf: day(q.start, -1) });
  const end = await stockLedgerBalances(tx, { ...base, asOf: q.end > String(fy.e) ? String(fy.e) : q.end });
  const rows: StockAutoRow[] = [];
  const push = (id: number, d: string, net: Micro) => { if (net !== ZERO) rows.push({ generalLedgerId: id, d, dr: net > ZERO ? net : ZERO, cr: net < ZERO ? -net : ZERO }); };
  for (const [id, v] of before) push(id, day(q.start, -1), v);
  for (const id of new Set([...before.keys(), ...end.keys()])) push(id, q.end, (end.get(id) ?? ZERO) - (before.get(id) ?? ZERO));
  return rows;
}

/** The rows as a SQL derived table: (gl, d, dr, cr). Empty when there is nothing automatic. */
export const stockAutoSql = (rows: StockAutoRow[]) => rows.length
  ? sql`(VALUES ${sql.join(rows.map((r) => sql`(${r.generalLedgerId}::int, ${r.d}::date, ${fmt(r.dr, 6)}::numeric, ${fmt(r.cr, 6)}::numeric)`), sql`, `)}) AS sa(gl, d, dr, cr)`
  : sql`(SELECT NULL::int AS gl, NULL::date AS d, 0::numeric AS dr, 0::numeric AS cr WHERE false) AS sa`;
