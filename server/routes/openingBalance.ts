import { Router } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError, wrap } from "./_util";
import { stockMismatches } from "./stockRecon";

const OB = S.openingBalance;
const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/; // NPR: 2 decimals, negative nahi (DB me CHECK nahi hai, yahan enforce)
const int = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} is required.`);
  return n;
};
// numeric(18,6) "1000.000000" -> "1000.00"
const two = (v: string | null | undefined) => {
  const s = String(v ?? "0");
  return s.includes(".") ? s.replace(/(\.\d{2})\d*$/, "$1").replace(/\.(\d)$/, ".$10") : s + ".00";
};

async function loadFy(companyId: number, fyId: number) {
  const [fy] = await db.select().from(S.fiscalYear).where(and(eq(S.fiscalYear.id, fyId), eq(S.fiscalYear.companyId, companyId)));
  if (!fy) throw new HttpError(404, "Fiscal year not found in this company.");
  return fy;
}
async function assertBranch(companyId: number, branchId: number) {
  const [b] = await db.select({ id: S.branch.id }).from(S.branch).where(and(eq(S.branch.id, branchId), eq(S.branch.companyId, companyId)));
  if (!b) throw new HttpError(404, "Branch not found in this company.");
}
const sums = async (where: any) => {
  const [r] = await db.select({ d: sql<string>`coalesce(sum(${OB.debit}), 0)::text`, c: sql<string>`coalesce(sum(${OB.credit}), 0)::text` }).from(OB).where(where);
  return { debit: two(r.d), credit: two(r.c) };
};

// Opening Balance = ek (Company, Branch, Fiscal Year) ke saare ledgers ka grid. Master-form pattern yahan nahi chalta.
export const openingBalanceRouter = Router();

openingBalanceRouter.get("/", wrap(async (req, res) => {
  const companyId = int(req.query.companyId, "companyId"), branchId = int(req.query.branchId, "branchId"), fyId = int(req.query.fiscalYearId, "fiscalYearId");
  const fy = await loadFy(companyId, fyId);
  await assertBranch(companyId, branchId);

  const gls = await db
    .select({
      id: S.generalLedger.id, code: S.generalLedger.code, name: S.generalLedger.name, normalBalance: S.generalLedger.normalBalance,
      isActive: S.generalLedger.isActive, requiresSubLedger: S.generalLedger.requiresSubLedger,
      subGroupCode: S.accountSubGroup.code, groupCode: S.accountGroup.code, groupType: S.accountGroup.type,
    })
    .from(S.generalLedger)
    .innerJoin(S.accountSubGroup, eq(S.generalLedger.accountSubGroupId, S.accountSubGroup.id))
    .innerJoin(S.accountGroup, eq(S.accountSubGroup.accountGroupId, S.accountGroup.id))
    .where(eq(S.generalLedger.companyId, companyId))
    .orderBy(asc(S.generalLedger.code));

  const subs = gls.length ? await db.select().from(S.subLedger).where(inArray(S.subLedger.generalLedgerId, gls.map((g) => g.id))).orderBy(asc(S.subLedger.code)) : [];
  const obs = await db.select().from(OB).where(and(eq(OB.companyId, companyId), eq(OB.fiscalYearId, fyId), eq(OB.branchId, branchId)));
  const obBy = new Map(obs.map((o) => [`${o.generalLedgerId}:${o.subLedgerId ?? 0}`, o]));

  const rows: Record<string, unknown>[] = [];
  const push = (g: (typeof gls)[number], sub: (typeof subs)[number] | null, extra: Record<string, unknown> = {}) => {
    const o = obBy.get(`${g.id}:${sub?.id ?? 0}`);
    rows.push({
      key: `${g.id}:${sub?.id ?? 0}`, generalLedgerId: g.id, subLedgerId: sub?.id ?? null,
      code: g.code, name: g.name, subLedgerCode: sub?.code ?? null, subLedgerName: sub?.name ?? null,
      groupCode: g.groupCode, subGroupCode: g.subGroupCode, groupType: g.groupType, normalBalance: g.normalBalance,
      isActive: g.isActive, requiresSubLedger: g.requiresSubLedger, needsSubLedger: false,
      debit: two(o?.debit), credit: two(o?.credit), ...extra,
    });
  };
  for (const g of gls) {
    if (!g.requiresSubLedger) { push(g, null); continue; }
    // Sub-ledger wale GL: har sub ledger ki apni row. Purana bina-sub-ledger balance ho to wo bhi dikhao (data chhupna nahi chahiye)
    const mine = subs.filter((s) => s.generalLedgerId === g.id);
    for (const s of mine) push(g, s);
    const legacy = obBy.has(`${g.id}:0`);
    if (legacy || mine.length === 0) push(g, null, { needsSubLedger: mine.length === 0 && !legacy });
  }

  let lockedByName: string | null = null;
  if (fy.openingBalanceLockedBy) {
    const [u] = await db.select({ name: S.user.name }).from(S.user).where(eq(S.user.id, fy.openingBalanceLockedBy));
    lockedByName = u?.name ?? null;
  }
  res.json({
    fiscalYear: {
      id: fy.id, code: fy.code, startDate: fy.startDate, endDate: fy.endDate, isClosed: fy.isClosed,
      isOpeningBalanceLocked: fy.isOpeningBalanceLocked, lockedAt: fy.openingBalanceLockedAt, lockedByName,
    },
    rows,
    totals: {
      branch: await sums(and(eq(OB.companyId, companyId), eq(OB.fiscalYearId, fyId), eq(OB.branchId, branchId))),
      company: await sums(and(eq(OB.companyId, companyId), eq(OB.fiscalYearId, fyId))),
    },
  });
}));

openingBalanceRouter.put("/", wrap(async (req, res) => {
  const b = req.body ?? {};
  const companyId = int(b.companyId, "companyId"), branchId = int(b.branchId, "branchId"), fyId = int(b.fiscalYearId, "fiscalYearId");
  const userId = Number(b.userId) > 0 ? Number(b.userId) : null;
  const fy = await loadFy(companyId, fyId);
  await assertBranch(companyId, branchId);
  if (fy.isClosed) throw new HttpError(409, "This fiscal year is closed. Opening balances cannot be changed.");
  if (fy.isOpeningBalanceLocked) throw new HttpError(409, "Opening balance is locked for this fiscal year. Unlock it first.");
  const items: any[] = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new HttpError(400, "Nothing to save.");
  if (items.length > 5000) throw new HttpError(400, "Too many rows in one save.");

  const glIds = [...new Set(items.map((i) => int(i.generalLedgerId, "generalLedgerId")))];
  const gls = await db.select().from(S.generalLedger).where(and(inArray(S.generalLedger.id, glIds), eq(S.generalLedger.companyId, companyId)));
  const glMap = new Map(gls.map((g) => [g.id, g]));
  const subIds = [...new Set(items.map((i) => i.subLedgerId).filter((x) => x != null).map(Number))];
  const subs = subIds.length ? await db.select().from(S.subLedger).where(inArray(S.subLedger.id, subIds)) : [];
  const subMap = new Map(subs.map((s) => [s.id, s]));

  const seen = new Set<string>();
  const clean = items.map((i) => {
    const gl = glMap.get(Number(i.generalLedgerId));
    if (!gl) throw new HttpError(400, "Ledger not found in this company.");
    const subId = i.subLedgerId == null ? null : Number(i.subLedgerId);
    const label = `${gl.code} ${gl.name}`;
    if (subId != null) {
      const s = subMap.get(subId);
      if (!s || s.generalLedgerId !== gl.id) throw new HttpError(400, `Sub Ledger does not belong to ${label}.`);
      if (!gl.requiresSubLedger) throw new HttpError(400, `${label} does not use Sub Ledgers.`);
    }
    const k = `${gl.id}:${subId ?? 0}`;
    if (seen.has(k)) throw new HttpError(400, `${label} appears twice.`);
    seen.add(k);
    const dr = String(i.debit ?? "0"), cr = String(i.credit ?? "0");
    if (!AMOUNT.test(dr) || !AMOUNT.test(cr)) throw new HttpError(400, `Invalid amount for ${label} (max 2 decimals, no negatives).`);
    if (Number(dr) > 0 && Number(cr) > 0) throw new HttpError(400, `${label}: enter either Debit or Credit, not both.`);
    // Sub-ledger wale GL par naya amount bina Sub Ledger ke nahi (clear karna allowed: purana data hatane ke liye)
    if (gl.requiresSubLedger && subId == null && (Number(dr) > 0 || Number(cr) > 0)) throw new HttpError(400, `${label} requires a Sub Ledger.`);
    return { gl, subId, dr, cr };
  });

  let saved = 0, deleted = 0;
  await db.transaction(async (tx) => {
    for (const c of clean) {
      const [ex] = await tx.select({ id: OB.id }).from(OB).where(and(
        eq(OB.fiscalYearId, fyId), eq(OB.branchId, branchId), eq(OB.generalLedgerId, c.gl.id),
        c.subId == null ? isNull(OB.subLedgerId) : eq(OB.subLedgerId, c.subId),
      ));
      const zero = Number(c.dr) === 0 && Number(c.cr) === 0;
      if (zero) { if (ex) { await tx.delete(OB).where(eq(OB.id, ex.id)); deleted++; } continue; }
      if (ex) await tx.update(OB).set({ debit: c.dr, credit: c.cr }).where(eq(OB.id, ex.id));
      else await tx.insert(OB).values({ companyId, branchId, fiscalYearId: fyId, generalLedgerId: c.gl.id, subLedgerId: c.subId, debit: c.dr, credit: c.cr, createdBy: userId });
      saved++;
    }
  });
  res.json({ saved, deleted });
}));

// Lock: poori company ka opening balance us FY me balanced hona chahiye (Dr = Cr)
openingBalanceRouter.post("/lock", wrap(async (req, res) => {
  const companyId = int(req.body?.companyId, "companyId"), fyId = int(req.body?.fiscalYearId, "fiscalYearId");
  const userId = Number(req.body?.userId) > 0 ? Number(req.body.userId) : null;
  const fy = await loadFy(companyId, fyId);
  if (fy.isOpeningBalanceLocked) throw new HttpError(409, "Opening balance is already locked.");
  if (fy.isClosed) throw new HttpError(409, "This fiscal year is closed.");
  const t = await sums(and(eq(OB.companyId, companyId), eq(OB.fiscalYearId, fyId)));
  const [d] = await db.select({ diff: sql<string>`(${t.debit}::numeric - ${t.credit}::numeric)::text` }).from(S.company).limit(1);
  if (Number(d.diff) !== 0) throw new HttpError(409, `Opening balance is not balanced (Dr ${t.debit} vs Cr ${t.credit}). Fix the difference before locking.`);
  // Stock ka value stock ledger ke opening se match hona chahiye; mismatch par saaf message, "force" se hi lock
  if (!req.body?.force) {
    const bad = await stockMismatches(companyId, fyId);
    if (bad.length) {
      const first = bad.slice(0, 3).map((m) => `${m.branch} · ${m.ledger}: stock ${m.stock} vs ledger ${m.ledgerBalance}`).join("; ");
      throw new HttpError(409, `Stock opening does not match the stock ledger (${first}${bad.length > 3 ? `; +${bad.length - 3} more` : ""}).`, "stockMismatch");
    }
  }
  await db.update(S.fiscalYear).set({ isOpeningBalanceLocked: true, openingBalanceLockedAt: new Date(), openingBalanceLockedBy: userId }).where(eq(S.fiscalYear.id, fyId));
  res.json({ ok: true });
}));

openingBalanceRouter.post("/unlock", wrap(async (req, res) => {
  const companyId = int(req.body?.companyId, "companyId"), fyId = int(req.body?.fiscalYearId, "fiscalYearId");
  const fy = await loadFy(companyId, fyId);
  if (!fy.isOpeningBalanceLocked) throw new HttpError(409, "Opening balance is not locked.");
  if (fy.isClosed) throw new HttpError(409, "This fiscal year is closed; opening balance cannot be unlocked.");
  await db.update(S.fiscalYear).set({ isOpeningBalanceLocked: false, openingBalanceLockedAt: null, openingBalanceLockedBy: null }).where(eq(S.fiscalYear.id, fyId));
  res.json({ ok: true });
}));
