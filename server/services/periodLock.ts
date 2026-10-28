import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { grantLockOverride } from "../db/audit";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { type Actor, type Opts, type Tx, inActorTx, inTx, parseDate } from "./purchase/common";

// ERP-025: the company lock (closing) date and its override. Decision S9 (c)(d), design S12.
//
//   lock date   documents dated ON OR BEFORE it cannot be created, edited or deleted. The DATABASE refuses them (migration 0011,
//               trigger "Audit_lock"); the purchase service pre-checks (assertPeriodOpen) only to answer clearly before work is done.
//   password    a scrypt hash in CompanyLock, never the password. Required whenever a lock date is set, so the lock cannot be lifted by
//               just anyone. There is no "admin permission" path yet: roles are recorded but not enforced until login (ERP-002).
//   override    ONE edit at a time (S9 answer 2): the caller sends { password, reason } with the request; the password is checked here,
//               then the database is told (grantLockOverride) for this transaction only. The next edit asks again. A reason is required
//               and is stored in the audit log, whose entry is flagged lockOverride = true.
//
// Limits, stated plainly: there is no login (ERP-002), so the acting user is whatever the caller says; the password check has no
// attempt limit or delay (do not expose this API); a role that can run arbitrary SQL can set the transaction setting itself.
// The helpers `Tx`, `Opts`, `inActorTx` come from the purchase service for now; they move up when ERP-005 adds generic vouchers.

export type LockOverride = { password: string; reason: string };

export type PeriodLockState = {
  companyId: number;
  lockDate: string | null; // "2026-07-15"
  passwordSet: boolean;
  updatedAt: string | null;
  updatedBy: number | null;
};

export const MIN_LOCK_PASSWORD = 6;
export const MAX_LOCK_PASSWORD = 200;

// ---------- password hashing (scrypt from node:crypto: no new dependency) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 } as const;
const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keylen, opts, (e, key) => (e ? reject(e) : resolve(key))));

// "scrypt$N$r$p$salt$hash" (base64). The cost is stored with the hash so it can be raised later without breaking old ones.
export async function hashLockPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltBytes);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

// false for a wrong password AND for a stored value that is not a hash we made (never throws, never says which).
export async function checkLockPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || N > 1 << 20 || r > 32 || p > 16) return false;
  try {
    const salt = Buffer.from(parts[4], "base64");
    const expected = Buffer.from(parts[5], "base64");
    if (!salt.length || !expected.length) return false;
    const key = await scrypt(password, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const stateOf = (companyId: number, row?: typeof S.companyLock.$inferSelect | null): PeriodLockState => ({
  companyId,
  lockDate: row?.lockDate ? isoDay(row.lockDate) : null,
  passwordSet: !!row?.passwordHash,
  updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  updatedBy: row?.updatedBy ?? null,
});

async function loadRow(tx: Tx, companyId: number) {
  const [row] = await tx.select().from(S.companyLock).where(eq(S.companyLock.companyId, companyId));
  return row ?? null;
}

// ---------- read ----------
export function getPeriodLock(companyId: number, opts: Opts = {}): Promise<PeriodLockState> {
  return inTx(opts.tx, async (tx) => {
    const [co] = await tx.select({ id: S.company.id }).from(S.company).where(eq(S.company.id, companyId));
    if (!co) throw new HttpError(404, "Company not found.", "companyId");
    return stateOf(companyId, await loadRow(tx, companyId));
  });
}

// ---------- the password gate ----------
// Throws unless `password` is the company's lock password. 403 for a wrong one.
async function requireLockPassword(row: typeof S.companyLock.$inferSelect | null, password: unknown, field: string) {
  if (!row?.passwordHash) throw new HttpError(409, "No lock password is set for this company.", field, "LOCK_NOT_SET");
  if (typeof password !== "string" || password === "") throw new HttpError(400, "The lock password is required.", field, "LOCK_PASSWORD_REQUIRED");
  if (!(await checkLockPassword(password, row.passwordHash))) throw new HttpError(403, "The lock password is wrong.", field, "LOCK_PASSWORD_WRONG");
}

const needReason = (reason: unknown, what: string, field = "reason"): string => {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r) throw new HttpError(400, `A reason is required ${what}.`, field);
  return r;
};

// Adds `reason` to the audit reason of the current transaction (keeps one the service already set, e.g. a reversal reason).
const addReason = (tx: Tx, reason: string) =>
  tx.execute(sql`select set_config('namo.change_reason', concat_ws(' | ', nullif(btrim(coalesce(current_setting('namo.change_reason', true), '')), ''), ${reason}::text), true)`);

// For a service that changes a covered document: call it once the company is known, inside the write transaction. With no override
// it does nothing and returns false. With one it checks the password and the reason, then tells the database for THIS transaction
// only (the next call to inActorTx / setAuditContext clears it again). A company with no lock date needs no override: nothing is
// checked and false is returned, so a screen may send the same fields every time.
export async function useLockOverride(tx: Tx, companyId: number, override: LockOverride | null | undefined): Promise<boolean> {
  if (!override) return false;
  const row = await loadRow(tx, companyId);
  if (!row?.lockDate) return false;
  const reason = needReason(override.reason, "to change a document in a locked period", "lockOverride.reason");
  await requireLockPassword(row, override.password, "lockOverride.password");
  await addReason(tx, reason);
  await grantLockOverride(tx, companyId);
  return true;
}

// The friendly early answer (the database guard is the authority and refuses anyway). `dates` are the dates the write would touch:
// the document's new date and, for an edit, its old date. Skipped when an override was granted.
export async function assertPeriodOpen(tx: Tx, companyId: number, dates: (Date | null | undefined)[], overridden = false, field?: string) {
  if (overridden) return;
  const row = await loadRow(tx, companyId);
  if (!row?.lockDate) return;
  const hit = dates.some((d) => d && d.getTime() <= row.lockDate!.getTime());
  if (hit) {
    throw new HttpError(
      409,
      `The books are locked up to ${isoDay(row.lockDate)}. A document dated on or before that day cannot be created, changed or deleted without the lock password and a reason.`,
      field,
      "PERIOD_LOCKED",
    );
  }
}

// What a purchase-bill service does first, in one call.
export async function guardPeriod(tx: Tx, companyId: number, dates: (Date | null | undefined)[], override: LockOverride | null | undefined, field?: string) {
  const overridden = await useLockOverride(tx, companyId, override);
  await assertPeriodOpen(tx, companyId, dates, overridden, field);
}

// ---------- write ----------
export type SetPeriodLockInput = {
  companyId: number;
  lockDate?: string | Date | null; // undefined = leave as is, null = remove the lock date
  newPassword?: string | null; // set (first time) or change the lock password
  currentPassword?: string | null; // needed to lower / remove the date or to change the password
  reason?: string | null; // needed whenever currentPassword is
};

// Rules (all also enforced by the database, CompanyLock_guard / CHECK):
//   - a lock date needs a password: set one together with the date the first time;
//   - raising the date, or setting it for the first time, needs nothing more;
//   - lowering or removing the date, or changing the password, needs the CURRENT password and a reason (an override, audit-logged).
export function setPeriodLock(input: SetPeriodLockInput, actor: Actor, opts: Opts = {}): Promise<PeriodLockState> {
  return inActorTx({ ...actor, reason: input.reason }, opts.tx, async (tx) => {
    const companyId = input.companyId;
    const [co] = await tx.select({ id: S.company.id }).from(S.company).where(eq(S.company.id, companyId));
    if (!co) throw new HttpError(404, "Company not found.", "companyId");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`CompanyLock:${companyId}`}))`); // two people saving at once

    const row = await loadRow(tx, companyId);
    const newPassword = input.newPassword === undefined || input.newPassword === null || input.newPassword === "" ? null : input.newPassword;
    if (newPassword !== null && (newPassword.length < MIN_LOCK_PASSWORD || newPassword.length > MAX_LOCK_PASSWORD)) {
      throw new HttpError(400, `The lock password must be ${MIN_LOCK_PASSWORD} to ${MAX_LOCK_PASSWORD} characters.`, "newPassword");
    }

    const target: Date | null =
      input.lockDate === undefined ? (row?.lockDate ?? null) : input.lockDate === null || input.lockDate === "" ? null : parseDate(input.lockDate, "lockDate");
    const dateChanged = (target?.getTime() ?? null) !== (row?.lockDate?.getTime() ?? null);
    if (!dateChanged && newPassword === null) return stateOf(companyId, row); // nothing to do

    const finalHash = newPassword !== null ? await hashLockPassword(newPassword) : (row?.passwordHash ?? null);
    if (target && !finalHash) {
      throw new HttpError(400, "Set a lock password together with the lock date; without one the lock could be lifted by anyone.", "newPassword");
    }

    const weakening = !!row?.lockDate && (target === null || target.getTime() < row.lockDate.getTime());
    const changingPassword = !!row?.passwordHash && newPassword !== null;
    if (weakening || changingPassword) {
      await requireLockPassword(row, input.currentPassword, "currentPassword");
      needReason(input.reason, weakening ? "to lower or remove the lock date" : "to change the lock password");
      await grantLockOverride(tx, companyId);
    }

    const values = { lockDate: target, passwordHash: finalHash, updatedAt: new Date(), updatedBy: actor.userId };
    if (row) await tx.update(S.companyLock).set(values).where(eq(S.companyLock.companyId, companyId));
    else await tx.insert(S.companyLock).values({ companyId, ...values });
    return stateOf(companyId, await loadRow(tx, companyId));
  });
}
