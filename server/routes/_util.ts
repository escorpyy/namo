import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 async errors ko handle karne ke liye wrapper
export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public field?: string,
    // A stable word a screen can act on (ERP-025: "PERIOD_LOCKED" = ask for the lock password and a reason, "LOCK_PASSWORD_WRONG").
    // Left out of the answer when not set, so every other answer keeps its shape.
    public code?: string,
  ) {
    super(message);
  }
}

// The real Postgres error behind whatever the route threw, or null when it is not a database error.
// drizzle-orm (0.44+) wraps every database error in a DrizzleQueryError whose own `code` is undefined and whose message is the SQL
// plus its parameters; the Postgres code (SQLSTATE) and the clean message live on `.cause` (postgres.js: name "PostgresError").
// Matching on that name keeps a lost connection (code ECONNREFUSED) or any other object with a `code` from passing as a constraint error.
export type PgError = Error & { code: string };
export function pgError(e: unknown): PgError | null {
  let cur: any = e;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    if (cur.name === "PostgresError" && typeof cur.code === "string") return cur as PgError;
    cur = cur.cause;
  }
  return null;
}

// A record id from the URL: a positive whole number that fits a Postgres integer. Anything else (abc, 1.5, -3, 99999999999) is "not found",
// never a database error.
export function idParam(v: unknown, what: string): number {
  if (typeof v !== "string" || !/^\d{1,10}$/.test(v)) throw new HttpError(404, `${what} not found.`);
  const n = Number(v);
  if (n < 1 || n > 2_147_483_647) throw new HttpError(404, `${what} not found.`);
  return n;
}

// Guard for edit / delete by id: when the request names a company (?companyId=), the record must belong to it, else "not found" (never
// "forbidden", so another company's ids are not confirmed). With no ?companyId nothing is checked, for older callers.
// This is a consistency guard, NOT access control: without login (ERP-002) a caller can still name any company.
export function sameCompany(companyIdQuery: unknown, ownerCompanyId: number | null | undefined, what: string): void {
  if (companyIdQuery === undefined) return;
  const c = typeof companyIdQuery === "string" && /^\d{1,10}$/.test(companyIdQuery) ? Number(companyIdQuery) : NaN;
  if (c !== ownerCompanyId) throw new HttpError(404, `${what} not found.`);
}
