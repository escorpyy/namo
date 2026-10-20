import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { toCents } from "../../shared/decimal";

const SOB = S.stockOpeningBalance, SD = S.stockDetail, OB = S.openingBalance;
const fmt = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;

// Control: Stock Opening ka value (product ke "Closing Stock GL (B/S)" ke hisaab se) us ledger ke Opening Balance se match hona chahiye.
export async function stockMismatches(companyId: number, fyId: number) {
  const stock = await db
    .select({ branchId: SOB.branchId, glId: SD.closingBSGLId, v: sql<string>`coalesce(sum(${SOB.value}), 0)::text` })
    .from(SOB).innerJoin(SD, eq(SOB.stockDetailId, SD.id)).innerJoin(S.product, eq(SD.productId, S.product.id))
    .where(and(eq(SOB.fiscalYearId, fyId), eq(S.product.companyId, companyId)))
    .groupBy(SOB.branchId, SD.closingBSGLId);
  const gls = (await db.selectDistinct({ id: SD.closingBSGLId }).from(SD).innerJoin(S.product, eq(SD.productId, S.product.id)).where(and(eq(S.product.companyId, companyId), isNotNull(SD.closingBSGLId)))).map((x) => x.id!) ;
  const ob = gls.length
    ? await db.select({ branchId: OB.branchId, glId: OB.generalLedgerId, n: sql<string>`(coalesce(sum(${OB.debit}), 0) - coalesce(sum(${OB.credit}), 0))::text` })
        .from(OB).where(and(eq(OB.companyId, companyId), eq(OB.fiscalYearId, fyId), inArray(OB.generalLedgerId, gls))).groupBy(OB.branchId, OB.generalLedgerId)
    : [];
  const cents = (s: string) => { const neg = s.startsWith("-"); const c = toCents(neg ? s.slice(1) : s); return neg ? -c : c; };
  const map = new Map<string, { branchId: number; glId: number | null; stock: bigint; ledger: bigint }>();
  const slot = (b: number, g: number | null) => { const k = `${b}:${g ?? 0}`; if (!map.has(k)) map.set(k, { branchId: b, glId: g, stock: 0n, ledger: 0n }); return map.get(k)!; };
  for (const r of stock) slot(r.branchId, r.glId).stock += cents(r.v);
  for (const r of ob) slot(r.branchId, r.glId).ledger += cents(r.n);
  const bad = [...map.values()].filter((x) => x.stock !== x.ledger);
  if (!bad.length) return [];
  const glNames = new Map((await db.select({ id: S.generalLedger.id, code: S.generalLedger.code }).from(S.generalLedger).where(eq(S.generalLedger.companyId, companyId))).map((g) => [g.id, g.code]));
  const brNames = new Map((await db.select({ id: S.branch.id, name: S.branch.name }).from(S.branch).where(eq(S.branch.companyId, companyId))).map((b) => [b.id, b.name]));
  return bad.map((x) => ({
    branch: brNames.get(x.branchId) ?? String(x.branchId),
    ledger: x.glId ? (glNames.get(x.glId) ?? String(x.glId)) : "(products without Closing Stock GL)",
    stock: fmt(x.stock), ledgerBalance: fmt(x.ledger),
  }));
}
