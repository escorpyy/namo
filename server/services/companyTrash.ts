import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";

// Company Trash: deleting a company only hides it. It can be restored for TRASH_DAYS days; after that, or when the user asks for it,
// namo.purge_company (migration 0060) erases it with everything that belongs to it.
export const TRASH_DAYS = 30;

const expired = sql`${S.company.deletedAt} <= now() - make_interval(days => ${TRASH_DAYS})`;

export async function trashCompany(id: number) {
  await db.transaction(async (tx) => {
    // Lock every live company, so two requests cannot trash the last two at the same moment.
    const live = await tx.select({ id: S.company.id }).from(S.company).where(and(isNull(S.company.deletedAt), eq(S.company.isActive, true))).for("update");
    if (!live.some((c) => c.id !== id)) throw new HttpError(409, "This is the only active company. Create another company before deleting this one.");
    await tx.update(S.company).set({ deletedAt: sql`now()` }).where(and(eq(S.company.id, id), isNull(S.company.deletedAt)));
  });
}

export function listTrash() {
  return db.select({
    id: S.company.id, code: S.company.code, name: S.company.name, deletedAt: S.company.deletedAt,
    daysLeft: sql<number>`greatest(0, ceil(extract(epoch from (${S.company.deletedAt} + make_interval(days => ${TRASH_DAYS}) - now())) / 86400))::int`,
  }).from(S.company).where(isNotNull(S.company.deletedAt)).orderBy(asc(S.company.deletedAt));
}

export async function restoreCompany(id: number) {
  const done = await db.update(S.company).set({ deletedAt: null })
    .where(and(eq(S.company.id, id), isNotNull(S.company.deletedAt), sql`not (${expired})`)).returning({ id: S.company.id });
  if (!done.length) throw new HttpError(409, `This company is not in the Trash, or its ${TRASH_DAYS} days to restore have passed.`);
}

export async function purgeCompany(id: number, confirmCode: string) {
  const [c] = await db.select({ code: S.company.code, deletedAt: S.company.deletedAt }).from(S.company).where(eq(S.company.id, id));
  if (!c || !c.deletedAt) throw new HttpError(409, "Only a company in the Trash can be deleted permanently.");
  if (confirmCode.trim().toUpperCase() !== c.code.toUpperCase()) throw new HttpError(400, `Type the company code ${c.code} to confirm.`, "confirmCode");
  await db.execute(sql`select namo.purge_company(${id})`);
}

// Erases every company whose restore window has passed. One transaction each, so one failure does not hold back the others.
export async function purgeExpiredCompanies() {
  const due = await db.select({ id: S.company.id, code: S.company.code }).from(S.company).where(and(isNotNull(S.company.deletedAt), expired));
  const purged: string[] = [];
  for (const c of due) {
    try {
      await db.transaction(async (tx) => {
        // Checked again under a lock: it may have been restored or purged since the list was read.
        const [still] = await tx.select({ id: S.company.id }).from(S.company).where(and(eq(S.company.id, c.id), expired)).for("update");
        if (!still) return;
        await tx.execute(sql`select namo.purge_company(${c.id})`);
        purged.push(c.code);
      });
    } catch (e) {
      console.error(`Could not permanently delete expired company ${c.code}:`, e);
    }
  }
  return purged;
}

export async function isTrashed(id: number) {
  const [c] = await db.select({ deletedAt: S.company.deletedAt }).from(S.company).where(eq(S.company.id, id));
  return !!c?.deletedAt;
}
