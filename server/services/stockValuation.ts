import { sql } from "drizzle-orm";
import { db } from "../db";
import { div, fmt, mul, roundTo, ZERO, toMicro, type Micro } from "./purchase/money";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// STOCK VALUATION (closing stock value = balance qty x costing rate), per product by the product's own valuation method:
//   WEIGHTED_AVERAGE : rate = all purchases and opening stock (qty x cost) / their qty, up to the date.      value = balance x rate
//   FIFO             : issues (sales, purchase returns) use the oldest receipts first; value = what is left of the newer receipts.
//   STANDARD_COST    : rate = the product's standard (purchase) rate from the stock master.                  value = balance x rate
// Receipt cost comes from the purchase side (landed rate, so cost assessments count) or the opening stock rate: see namo.purchase_line_cost.
// This is the periodic method: sales do not carry a cost, the value is worked out for a date, and
//   COGS = opening stock + purchases + direct costs - closing stock.

const PURCHASE_SIDE = new Set(["OPENING_STOCK", "PURCHASE_CHALLAN", "PURCHASE_BILL"]);
type Mov = { productId: number; locationId: number | null; batchNo: string | null; id: number; d: string; qty: Micro; side: boolean; cost: Micro | null };

export type ValuationRow = {
  productId: number; code: string; description: string; unit: string; method: "FIFO" | "WEIGHTED_AVERAGE" | "STANDARD_COST";
  qty: string; rate: string; value: string; missingCost: boolean; negative: boolean;
  buckets: { locationId: number | null; locationName: string | null; batchNo: string | null; qty: string; value: string }[];
};

export async function stockValuation(tx: Tx | typeof db, q: { companyId: number; branchId?: number; asOf?: string; productId?: number }) {
  const asOf = q.asOf ?? "9999-12-31";
  const movs = (await tx.execute(sql`
    SELECT m."productId", m."locationId", m."batchNo", m.id, m."movementDate"::text AS d, m.qty::text AS qty, m."sourceType" AS st,
           CASE m."sourceType"
             WHEN 'OPENING_STOCK' THEN (SELECT o.rate::text FROM "StockOpeningBalance" o WHERE o.id = m."sourceLineId")
             WHEN 'PURCHASE_BILL' THEN "namo"."purchase_line_cost"(m."sourceLineId")::text
             WHEN 'PURCHASE_CHALLAN' THEN "namo"."purchase_challan_line_cost"(m."sourceLineId")::text
           END AS cost
      FROM "StockMovement" m
     WHERE m."companyId" = ${q.companyId} AND m."movementDate" <= ${asOf}::date
       ${q.branchId ? sql`AND m."branchId" = ${q.branchId}` : sql``} ${q.productId ? sql`AND m."productId" = ${q.productId}` : sql``}
     ORDER BY m."productId", m."movementDate", m.id`)) as any[];
  const info = new Map(((await tx.execute(sql`
    SELECT p.id, p.code, p.description, u.code AS unit, sd."valuationMethod" AS method, sd."purchaseRate"::text AS std
      FROM "Product" p JOIN "StockDetail" sd ON sd."productId" = p.id JOIN "ProductUnit" u ON u.id = sd."baseUnitId" WHERE p."companyId" = ${q.companyId}`)) as any[]).map((r) => [Number(r.id), r]));
  const locs = new Map(((await tx.execute(sql`SELECT id, name FROM "Location" WHERE "companyId" = ${q.companyId}`)) as any[]).map((r) => [Number(r.id), String(r.name)]));

  const byProduct = new Map<number, Mov[]>();
  for (const r of movs) {
    const m: Mov = { productId: Number(r.productId), locationId: r.locationId == null ? null : Number(r.locationId), batchNo: r.batchNo, id: Number(r.id), d: r.d, qty: toMicro(r.qty), side: PURCHASE_SIDE.has(r.st), cost: r.cost == null ? null : toMicro(r.cost) };
    (byProduct.get(m.productId) ?? byProduct.set(m.productId, []).get(m.productId)!).push(m);
  }

  const rows: ValuationRow[] = [];
  let total = ZERO;
  for (const [productId, list] of byProduct) {
    const p = info.get(productId);
    if (!p) continue;
    const balance = list.reduce((a, m) => a + m.qty, ZERO);
    if (balance === ZERO) continue;
    const missingCost = list.some((m) => m.side && m.qty > ZERO && m.cost === null);
    const method = p.method as ValuationRow["method"];
    let value = ZERO;
    if (balance > ZERO) {
      if (method === "FIFO") {
        // receipts in order; everything issued (sales and purchase returns) eats the oldest first
        const layers = list.filter((m) => m.side && m.qty > ZERO).map((m) => ({ qty: m.qty, cost: m.cost ?? ZERO }));
        let issued = list.reduce((a, m) => a + (m.qty < ZERO ? -m.qty : ZERO), ZERO);
        for (const l of layers) { const take = issued < l.qty ? issued : l.qty; l.qty -= take; issued -= take; if (issued === ZERO) break; }
        value = layers.reduce((a, l) => a + roundTo(mul(l.qty, l.cost), 2), ZERO);
      } else if (method === "STANDARD_COST") {
        value = roundTo(mul(balance, toMicro(p.std ?? 0)), 2);
      } else {
        const bought = list.filter((m) => m.side).reduce((a, m) => a + m.qty, ZERO);
        const cost = list.filter((m) => m.side).reduce((a, m) => a + mul(m.qty, m.cost ?? ZERO), ZERO);
        value = bought > ZERO ? roundTo(mul(balance, div(cost, bought)), 2) : ZERO;
      }
    }
    const rate = balance > ZERO && value > ZERO ? div(value, balance) : ZERO;
    const bk = new Map<string, { locationId: number | null; batchNo: string | null; qty: Micro }>();
    for (const m of list) { const k = `${m.locationId ?? 0}|${m.batchNo ?? ""}`; const b = bk.get(k) ?? bk.set(k, { locationId: m.locationId, batchNo: m.batchNo, qty: ZERO }).get(k)!; b.qty += m.qty; }
    rows.push({
      productId, code: p.code, description: p.description, unit: p.unit, method, qty: fmt(balance), rate: fmt(rate, 6), value: fmt(value, 2), missingCost, negative: balance < ZERO,
      buckets: [...bk.values()].filter((b) => b.qty !== ZERO).map((b) => ({ locationId: b.locationId, locationName: b.locationId ? locs.get(b.locationId) ?? null : null, batchNo: b.batchNo, qty: fmt(b.qty), value: fmt(b.qty > ZERO ? roundTo(mul(b.qty, rate), 2) : ZERO, 2) })),
    });
    total += value;
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { asOf: q.asOf ?? null, rows, totalValue: fmt(total, 2) };
}
