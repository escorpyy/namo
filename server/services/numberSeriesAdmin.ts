import { and, asc, eq, inArray, sql } from "drizzle-orm";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { documentType, exampleNumbers, seriesProblems, type SeriesRow } from "../../shared/numberSeries";
import { inActorTx, type Opts } from "./purchase/common";
import { DOC_TABLE, nextOfSeries, usableSeries, type SeriesRecord } from "./numberSeries";

// Number series settings: list, create / edit, and the series a user may pick on a document form.
// An edit changes future documents only: counters and the numbers already given are left alone.

const asNumbers = (v: unknown, name: string): number[] => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => !Number.isInteger(x) || x <= 0)) throw new HttpError(400, `${name} must be a list of ids.`, name);
  return [...new Set(v as number[])];
};
const nullableInt = (v: unknown, name: string): number | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `${name} must be a whole number.`, name);
  return v;
};
const int = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `${name} must be a whole number.`, name);
  return v;
};
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const text = (v: unknown, name: string) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new HttpError(400, `${name} must be text.`, name);
  return v.trim();
};

async function rows(tx: any, companyId: number, ids?: number[]): Promise<SeriesRow[]> {
  const list: SeriesRecord[] = await tx.select().from(S.numberSeries)
    .where(ids ? and(eq(S.numberSeries.companyId, companyId), inArray(S.numberSeries.id, ids)) : eq(S.numberSeries.companyId, companyId))
    .orderBy(asc(S.numberSeries.documentType), sql`${S.numberSeries.isDefault} desc`, asc(S.numberSeries.name));
  if (!list.length) return [];
  const sid = list.map((s) => s.id);
  const users: { seriesId: number; userId: number }[] = await tx.select().from(S.numberSeriesUser).where(inArray(S.numberSeriesUser.seriesId, sid));
  const brs: { seriesId: number; branchId: number }[] = await tx.select().from(S.numberSeriesBranch).where(inArray(S.numberSeriesBranch.seriesId, sid));
  const used = new Map<number, number>();
  for (const { table } of Object.values(DOC_TABLE)) {
    const r = (await tx.execute(sql`select "numberSeriesId" as id, count(*)::int as n from ${sql.identifier(table)} where "companyId" = ${companyId} and "numberSeriesId" is not null group by 1`)) as any[];
    for (const x of r) used.set(x.id, (used.get(x.id) ?? 0) + x.n);
  }
  return list.map((s) => ({
    id: s.id, documentType: s.documentType, name: s.name, prefix: s.prefix, suffix: s.suffix, padding: s.padding, startNumber: s.startNumber, endNumber: s.endNumber,
    increment: s.increment, mode: s.mode as SeriesRow["mode"], assignAt: s.assignAt as SeriesRow["assignAt"], resetPerFy: s.resetPerFy, perBranch: s.perBranch,
    isDefault: s.isDefault, isActive: s.isActive, allUsers: s.allUsers, allBranches: s.allBranches,
    userIds: users.filter((u) => u.seriesId === s.id).map((u) => u.userId), branchIds: brs.filter((b) => b.seriesId === s.id).map((b) => b.branchId),
    example: s.mode === "MANUAL" ? [] : exampleNumbers(s), used: used.get(s.id) ?? 0,
  }));
}

export const listSeries = async (companyId: number, o: Opts = {}) => rows((o.tx ?? (await import("../db")).db) as any, companyId);

export async function saveSeries(companyId: number, id: number | null, b: Record<string, unknown>, userId: number | null, o: Opts = {}): Promise<SeriesRow> {
  const dt = text(b.documentType, "documentType");
  if (!documentType(dt)) throw new HttpError(400, "Unknown kind of document.", "documentType");
  const mode: "AUTOMATIC" | "SUGGESTED" | "MANUAL" = b.mode as any;
  if (mode !== "AUTOMATIC" && mode !== "SUGGESTED" && mode !== "MANUAL") throw new HttpError(400, "Mode must be Automatic, Suggested or Manual.", "mode");
  const assignAt = b.assignAt === "POST" ? "POST" : "DRAFT";
  const v = {
    name: text(b.name, "name"), prefix: text(b.prefix, "prefix"), suffix: text(b.suffix, "suffix"),
    padding: b.padding === undefined ? 4 : int(b.padding, "padding"), startNumber: b.startNumber === undefined ? 1 : int(b.startNumber, "startNumber"),
    endNumber: nullableInt(b.endNumber, "endNumber"), increment: b.increment === undefined ? 1 : int(b.increment, "increment"), mode,
  };
  const problems = seriesProblems(v);
  if (problems.length) throw new HttpError(400, problems[0], "series");
  const allUsers = bool(b.allUsers, true), allBranches = bool(b.allBranches, true);
  const userIds = allUsers ? [] : asNumbers(b.userIds, "userIds"), branchIds = allBranches ? [] : asNumbers(b.branchIds, "branchIds");
  if (!allUsers && !userIds.length) throw new HttpError(400, "Choose at least one user, or allow all users.", "userIds");
  if (!allBranches && !branchIds.length) throw new HttpError(400, "Choose at least one branch, or allow all branches.", "branchIds");

  return inActorTx({ userId }, o.tx, async (tx) => {
    if (id !== null) {
      const [cur] = await tx.select().from(S.numberSeries).where(and(eq(S.numberSeries.id, id), eq(S.numberSeries.companyId, companyId)));
      if (!cur) throw new HttpError(404, "Number series not found.");
      if (cur.documentType !== dt) throw new HttpError(409, "The kind of document of a series cannot be changed.", "documentType");
    }
    if (branchIds.length) {
      const ok = await tx.select({ id: S.branch.id }).from(S.branch).where(and(eq(S.branch.companyId, companyId), inArray(S.branch.id, branchIds)));
      if (ok.length !== branchIds.length) throw new HttpError(400, "A chosen branch is not in this company.", "branchIds");
    }
    if (userIds.length) {
      const ok = await tx.select({ id: S.user.id }).from(S.user).where(and(eq(S.user.isActive, true), inArray(S.user.id, userIds)));
      if (ok.length !== userIds.length) throw new HttpError(400, "A chosen user does not exist or is not active.", "userIds");
    }
    const isDefault = bool(b.isDefault, false), isActive = bool(b.isActive, true);
    if (isDefault && !isActive) throw new HttpError(400, "A default series must be active.", "isDefault");
    if (isDefault) await tx.update(S.numberSeries).set({ isDefault: false }).where(and(eq(S.numberSeries.companyId, companyId), eq(S.numberSeries.documentType, dt), eq(S.numberSeries.isDefault, true)));
    const values = { ...v, assignAt, resetPerFy: bool(b.resetPerFy, true), perBranch: bool(b.perBranch, true), isDefault, isActive, allUsers, allBranches, updatedBy: userId };
    let sid = id;
    if (sid === null) {
      const dup = await tx.select({ id: S.numberSeries.id }).from(S.numberSeries).where(and(eq(S.numberSeries.companyId, companyId), eq(S.numberSeries.documentType, dt), eq(S.numberSeries.name, v.name)));
      if (dup.length) throw new HttpError(409, `A ${documentType(dt)!.label} series named "${v.name}" already exists.`, "name");
      [{ id: sid }] = await tx.insert(S.numberSeries).values({ companyId, documentType: dt, ...values }).returning({ id: S.numberSeries.id });
    } else {
      const dup = await tx.select({ id: S.numberSeries.id }).from(S.numberSeries).where(and(eq(S.numberSeries.companyId, companyId), eq(S.numberSeries.documentType, dt), eq(S.numberSeries.name, v.name), sql`${S.numberSeries.id} <> ${sid}`));
      if (dup.length) throw new HttpError(409, `A ${documentType(dt)!.label} series named "${v.name}" already exists.`, "name");
      await tx.update(S.numberSeries).set(values).where(eq(S.numberSeries.id, sid));
    }
    await tx.delete(S.numberSeriesUser).where(eq(S.numberSeriesUser.seriesId, sid!));
    await tx.delete(S.numberSeriesBranch).where(eq(S.numberSeriesBranch.seriesId, sid!));
    if (userIds.length) await tx.insert(S.numberSeriesUser).values(userIds.map((u) => ({ seriesId: sid!, userId: u })));
    if (branchIds.length) await tx.insert(S.numberSeriesBranch).values(branchIds.map((x) => ({ seriesId: sid!, branchId: x })));
    return (await rows(tx, companyId, [sid!]))[0];
  });
}

export interface AvailableSeries { id: number; name: string; mode: SeriesRow["mode"]; assignAt: SeriesRow["assignAt"]; isDefault: boolean; next: string | null; left: number | null; problem?: string }

/** the series a user may pick on a document form, each with the number it would give next (nothing is used up) */
export async function availableSeries(companyId: number, documentTypeKey: string, userId: number | null, branchId: number, fiscalYear: string, o: Opts = {}): Promise<AvailableSeries[]> {
  if (!documentType(documentTypeKey)) throw new HttpError(400, "Unknown kind of document.", "documentType");
  const { db } = await import("../db");
  const run = async (tx: any) => {
    const list = await usableSeries(tx, companyId, documentTypeKey, userId, branchId);
    const out: AvailableSeries[] = [];
    for (const s of list) {
      const a: AvailableSeries = { id: s.id, name: s.name, mode: s.mode as AvailableSeries["mode"], assignAt: s.assignAt as AvailableSeries["assignAt"], isDefault: s.isDefault, next: null, left: null };
      if (s.mode !== "MANUAL") {
        try { const n = await tx.transaction((t: any) => nextOfSeries(t, s, { companyId, branchId, fiscalYear }, false)); a.next = n.number; a.left = n.left; }
        catch (e: any) { a.problem = e?.message ?? "No number available."; }
      }
      out.push(a);
    }
    return out;
  };
  return o.tx ? run(o.tx) : db.transaction(run);
}
