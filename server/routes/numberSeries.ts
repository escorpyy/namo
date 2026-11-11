import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { availableSeries, listSeries, saveSeries } from "../services/numberSeriesAdmin";
import { HttpError, wrap } from "./_util";

// Number series (shared/numberSeries.ts). Like every route, the company and user come from the request (no login yet, ERP-002).
//   GET  /api/number-series?companyId=                                   -> every series with its users, branches, examples and how many documents used it
//   POST /api/number-series        { companyId, userId?, ...series }     -> create
//   PUT  /api/number-series/:id    { companyId, userId?, ...series }     -> edit (future documents only)
//   GET  /api/number-series/available?companyId&documentType&branchId&fiscalYear&userId?  -> what a document form offers, with the next number of each
export const numberSeriesRouter = Router();

const whole = (v: unknown, name: string): number => {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new HttpError(400, `${name} is required.`, name);
  return n;
};
const object = (b: unknown): Record<string, unknown> => {
  if (b === null || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Send a JSON object.");
  return b as Record<string, unknown>;
};
const actor = async (v: unknown): Promise<number | null> => {
  if (v === undefined || v === null || v === "") return null;
  const id = whole(v, "userId");
  const [u] = await db.select({ isActive: S.user.isActive }).from(S.user).where(eq(S.user.id, id));
  if (!u || !u.isActive) throw new HttpError(400, "Unknown or inactive user.", "userId");
  return id;
};
const q = (v: unknown) => (typeof v === "string" ? v : undefined);

// "available" first: it must not be read as an :id
numberSeriesRouter.get("/available", wrap(async (req, res) => {
  const fy = q(req.query.fiscalYear);
  if (!fy || fy.length > 15) throw new HttpError(400, "fiscalYear is required.", "fiscalYear");
  res.json(await availableSeries(whole(q(req.query.companyId), "companyId"), q(req.query.documentType) ?? "", await actor(q(req.query.userId)), whole(q(req.query.branchId), "branchId"), fy));
}));

// the people a series can be limited to
numberSeriesRouter.get("/users", wrap(async (_req, res) => {
  res.json(await db.select({ id: S.user.id, name: S.user.name }).from(S.user).where(eq(S.user.isActive, true)).orderBy(S.user.name));
}));

numberSeriesRouter.get("/", wrap(async (req, res) => { res.json(await listSeries(whole(q(req.query.companyId), "companyId"))); }));

numberSeriesRouter.post("/", wrap(async (req, res) => {
  const b = object(req.body);
  res.status(201).json(await saveSeries(whole(b.companyId, "companyId"), null, b, await actor(b.userId)));
}));

numberSeriesRouter.put("/:id", wrap(async (req, res) => {
  const b = object(req.body);
  res.json(await saveSeries(whole(b.companyId, "companyId"), whole(req.params.id, "id"), b, await actor(b.userId)));
}));
