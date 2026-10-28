import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { getPeriodLock, setPeriodLock, MAX_LOCK_PASSWORD } from "../services/periodLock";
import { HttpError, wrap } from "./_util";

// ERP-025: the company lock (closing) date. Documents dated on or before it cannot be created, changed or deleted (see
// server/services/periodLock.ts and migration 0011). The password hash is never returned.
//
//   GET /api/period-lock?companyId=            -> { companyId, lockDate: "2026-07-15" | null, passwordSet, updatedAt, updatedBy }
//   PUT /api/period-lock                       body: companyId, userId, lockDate (YYYY-MM-DD, null = remove, absent = unchanged),
//                                                    newPassword, currentPassword, reason
//     - a lock date needs a password: send newPassword together with the first lockDate;
//     - raising the date or setting it the first time needs nothing more;
//     - lowering or removing the date, or changing the password, needs currentPassword and a reason (403 LOCK_PASSWORD_WRONG, 400 otherwise).
// No login yet (ERP-002): the user comes from `userId` and must be an active user; there is no attempt limit on the password.
// Do not expose this API with real data.
export const periodLockRouter = Router();

function whole(v: unknown, name: string): number {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new HttpError(400, `${name} is required.`, name);
  return n;
}

async function actorOf(req: Request) {
  const raw = req.body?.userId;
  if (raw === undefined || raw === null || raw === "") return { userId: null };
  const id = whole(raw, "userId");
  const [u] = await db.select({ id: S.user.id, isActive: S.user.isActive }).from(S.user).where(eq(S.user.id, id));
  if (!u || !u.isActive) throw new HttpError(400, "Unknown or inactive user.", "userId");
  return { userId: id };
}

const text = (v: unknown, name: string, max: number): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, `${name} must be text of at most ${max} characters.`, name);
  return v;
};

periodLockRouter.get("/", wrap(async (req, res) => {
  const c = req.query.companyId;
  res.json(await getPeriodLock(whole(typeof c === "string" ? c : undefined, "companyId")));
}));

periodLockRouter.put("/", wrap(async (req, res) => {
  const b = req.body;
  if (b === null || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Send a JSON object.");
  const companyId = whole(b.companyId, "companyId");
  if (b.lockDate !== undefined && b.lockDate !== null && typeof b.lockDate !== "string") throw new HttpError(400, "lockDate must be a date like 2026-07-15, or null to remove the lock.", "lockDate");
  const state = await setPeriodLock(
    {
      companyId,
      lockDate: b.lockDate,
      newPassword: text(b.newPassword, "newPassword", MAX_LOCK_PASSWORD),
      currentPassword: text(b.currentPassword, "currentPassword", MAX_LOCK_PASSWORD),
      reason: text(b.reason, "reason", 500),
    },
    await actorOf(req),
  );
  res.json(state);
}));
