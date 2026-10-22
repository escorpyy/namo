import { sql } from "drizzle-orm";
import { type Tx, idList } from "./common";
import { type Micro, ZERO, toMicro } from "./money";

// Received / billed quantities are NEVER stored; they are summed from the documents here, so they cannot drift.
//
//  received  = confirmed challan lines against an order line
//  billed    = bill lines against a challan line / an order line, from every bill that still stands:
//              drafts count (they reserve the quantity), reversal bills do not, and a bill that has been
//              reversed no longer counts.

const standing = sql`b."reversalOfId" is null and not exists (select 1 from "PurchaseBill" r where r."reversalOfId" = b.id and r."isPosted")`;
const asMap = (rows: any[]): Map<number, Micro> => new Map(rows.map((r) => [Number(r.id), toMicro(r.q)]));

export async function receivedByOrderLine(tx: Tx, orderLineIds: number[], excludeChallanId?: number): Promise<Map<number, Micro>> {
  if (!orderLineIds.length) return new Map();
  return asMap((await tx.execute(sql`
    select cl."purchaseOrderLineId" as id, coalesce(sum(cl.qty), 0)::text as q
      from "PurchaseChallanLine" cl join "PurchaseChallan" c on c.id = cl."purchaseChallanId"
     where cl."purchaseOrderLineId" in (${idList(orderLineIds)}) and c."isConfirmed"
       and c.id <> ${excludeChallanId ?? 0}
     group by 1`)) as any[]);
}

export async function billedByChallanLine(tx: Tx, challanLineIds: number[], excludeBillId?: number): Promise<Map<number, Micro>> {
  if (!challanLineIds.length) return new Map();
  return asMap((await tx.execute(sql`
    select bl."challanLineId" as id, coalesce(sum(bl.qty), 0)::text as q
      from "PurchaseBillLine" bl join "PurchaseBill" b on b.id = bl."purchaseBillId"
     where bl."challanLineId" in (${idList(challanLineIds)}) and ${standing} and b.id <> ${excludeBillId ?? 0}
     group by 1`)) as any[]);
}

export async function billedByOrderLine(tx: Tx, orderLineIds: number[], excludeBillId?: number): Promise<Map<number, Micro>> {
  if (!orderLineIds.length) return new Map();
  return asMap((await tx.execute(sql`
    select bl."purchaseOrderLineId" as id, coalesce(sum(bl.qty), 0)::text as q
      from "PurchaseBillLine" bl join "PurchaseBill" b on b.id = bl."purchaseBillId"
     where bl."purchaseOrderLineId" in (${idList(orderLineIds)}) and ${standing} and b.id <> ${excludeBillId ?? 0}
     group by 1`)) as any[]);
}

// qty allowed = qty * (1 + tolerance%). Tolerance defaults to 0: no over-receiving, no over-billing.
export const withTolerance = (qty: Micro, tolerancePercent = 0): Micro => qty + (qty * toMicro(tolerancePercent)) / 100_000_000n;
export const pending = (limit: Micro, used: Micro): Micro => (limit > used ? limit - used : ZERO);
