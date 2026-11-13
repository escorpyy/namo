import type { Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import type { Actor } from "../services/purchase/common";
import type { LockOverride } from "../services/periodLock";
import { HttpError } from "./_util";

// Request-body and query parsing shared by the document routes (purchase, cash / bank voucher). Moved out of purchase.ts unchanged:
// ids are whole numbers, the optional lock override has the right shape, the acting user is a real active user, and `pick` / `rows`
// keep only the fields a route lists and refuse a value of the wrong type with a 400 before it can reach the service or the database.

export function whole(v: unknown, name: string): number {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new HttpError(400, `${name} is required.`, name);
  return n;
}
export const optWhole = (v: unknown, name: string): number | undefined => (v === undefined || v === null || v === "" ? undefined : whole(v, name));
export const q = (req: Request, name: string) => (typeof req.query[name] === "string" ? (req.query[name] as string) : undefined);
export const companyOf = (req: Request) => whole(q(req, "companyId"), "companyId");
export const idOf = (req: Request, name = "id") => whole(req.params[name], name);

// The optional { password, reason } that overrides the company lock date for ONE request (ERP-025). Only the shape is checked here;
// the service checks the password and the reason against the company's lock.
export function lockOverrideOf(req: Request): LockOverride | undefined {
  const o = req.body?.lockOverride;
  if (o === undefined || o === null) return undefined;
  if (typeof o !== "object" || Array.isArray(o)) throw new HttpError(400, "lockOverride must be an object with password and reason.", "lockOverride");
  const { password, reason } = o as Record<string, unknown>;
  if (typeof password !== "string" || password === "" || password.length > 200) throw new HttpError(400, "lockOverride.password is required.", "lockOverride.password");
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 500) throw new HttpError(400, "lockOverride.reason is required (500 characters at most).", "lockOverride.reason");
  return { password, reason };
}

export async function actorOf(req: Request): Promise<Actor> {
  const raw = req.body?.userId ?? q(req, "userId");
  if (raw === undefined || raw === null || raw === "") return { userId: null };
  const id = whole(raw, "userId");
  const [u] = await db.select({ id: S.user.id, isActive: S.user.isActive }).from(S.user).where(eq(S.user.id, id));
  if (!u || !u.isActive) throw new HttpError(400, "Unknown or inactive user.", "userId");
  return { userId: id };
}

export type Kind = "int" | "str" | "date" | "num" | "bool" | string[]; // string[] = one of these words
export function checkKind(v: unknown, kind: Kind, label: string, field: string) {
  const bad = (what: string) => new HttpError(400, `${label}${what}`, field);
  if (kind === "int") { if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 2_000_000_000) throw bad(" must be a whole number."); }
  else if (kind === "num") { if (!(typeof v === "number" && Number.isFinite(v)) && !(typeof v === "string" && v.length <= 40)) throw bad(" must be a number."); }
  else if (kind === "bool") { if (typeof v !== "boolean") throw bad(" must be true or false."); }
  else if (kind === "str" || kind === "date") { if (typeof v !== "string" || v.length > 2000) throw bad(" must be text."); }
  else if (typeof v !== "string" || !kind.includes(v)) throw bad(` must be one of ${kind.join(", ")}.`);
}
// Keeps only the fields in `spec` (anything else the client sent is dropped) and refuses a value of the wrong type with a 400,
// so a bad request never reaches the service or the database as a type error.
export function pick(obj: unknown, spec: Record<string, Kind>, label: string): Record<string, any> {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) throw new HttpError(400, `${label} must be an object.`);
  const out: Record<string, any> = {};
  for (const [k, kind] of Object.entries(spec)) {
    const v = (obj as any)[k];
    if (v === undefined) continue;
    if (v !== null && v !== "") checkKind(v, kind, `${label}: ${k}`, k);
    out[k] = v;
  }
  return out;
}
export function rows(v: unknown, spec: Record<string, Kind>, name: string, max: number, label: string) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${name} must be a list.`, name);
  if (v.length > max) throw new HttpError(400, `At most ${max} ${name} per document.`, name);
  return v.map((r, i) => pick(r, spec, `${label} ${i + 1}`));
}
