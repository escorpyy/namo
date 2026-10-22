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
