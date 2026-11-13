import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import * as J from "../services/journalVoucher";
import type { Actor } from "../services/purchase/common";
import type { LockOverride } from "../services/periodLock";
import { HttpError, wrap } from "./_util";

// Journal vouchers over HTTP. Like the purchase routes, these check only what the HTTP layer must (ids are whole numbers, the voucher
// belongs to the company in the URL, field types are right) and leave every business rule to services/journalVoucher.ts.
//
//   GET    /api/journal-vouchers/lookups?companyId=
//   GET    /api/journal-vouchers?companyId=&branchId=&fiscalYear=&status=&search=&limit=
//   GET    /api/journal-vouchers/:id?companyId=
//   POST   /api/journal-vouchers                    body: companyId, branchId, voucherDate, remarks, lines[, voucherNumber, numberSeriesId, userId]
//   PUT    /api/journal-vouchers/:id?companyId=     draft, or posted with `reason`; company and branch cannot change
//   DELETE /api/journal-vouchers/:id?companyId=     draft, or posted with `reason`
//   POST   /api/journal-vouchers/:id/post           POST /api/journal-vouchers/:id/reverse   body: { date?, reason? }
//
// Writes dated on or before the company lock date answer 409 PERIOD_LOCKED unless the body carries `lockOverride: { password, reason }`
// (the same override as the purchase bills). No login yet (ERP-002): the acting user is `userId` (body or query), an active user.

export const journalVoucherRouter = Router();

const MAX_LINES = 500;
function whole(v: unknown, name: string): number {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new HttpError(400, `${name} is required.`, name);
  return n;
}
const optWhole = (v: unknown, name: string): number | undefined => (v === undefined || v === null || v === "" ? undefined : whole(v, name));
const q = (req: Request, name: string) => (typeof req.query[name] === "string" ? (req.query[name] as string) : undefined);
const companyOf = (req: Request) => whole(q(req, "companyId"), "companyId");
const idOf = (req: Request) => whole(req.params.id, "id");
const text = (v: unknown, name: string, max: number): string | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, `${name} must be text of at most ${max} characters.`, name);
  return v;
};
const amount = (v: unknown, name: string): string | number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (!(typeof v === "number" && Number.isFinite(v)) && !(typeof v === "string" && v.length <= 40)) throw new HttpError(400, `${name} must be a number.`, name);
  return v;
};

function lockOverrideOf(req: Request): LockOverride | undefined {
  const o = req.body?.lockOverride;
  if (o === undefined || o === null) return undefined;
  if (typeof o !== "object" || Array.isArray(o)) throw new HttpError(400, "lockOverride must be an object with password and reason.", "lockOverride");
  const { password, reason } = o as Record<string, unknown>;
  if (typeof password !== "string" || password === "" || password.length > 200) throw new HttpError(400, "lockOverride.password is required.", "lockOverride.password");
  if (typeof reason !== "string" || reason.trim() === "" || reason.length > 500) throw new HttpError(400, "lockOverride.reason is required (500 characters at most).", "lockOverride.reason");
  return { password, reason };
}

async function actorOf(req: Request): Promise<Actor> {
  const raw = req.body?.userId ?? q(req, "userId");
  if (raw === undefined || raw === null || raw === "") return { userId: null };
  const id = whole(raw, "userId");
  const [u] = await db.select({ id: S.user.id, isActive: S.user.isActive }).from(S.user).where(eq(S.user.id, id));
  if (!u || !u.isActive) throw new HttpError(400, "Unknown or inactive user.", "userId");
  return { userId: id };
}

const reasonOf = (req: Request) => text(req.body?.reason ?? q(req, "reason"), "reason", 500);

function linesOf(v: unknown): J.JvLineInput[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, "lines must be a list.", "lines");
  if (v.length > MAX_LINES) throw new HttpError(400, `At most ${MAX_LINES} lines per voucher.`, "lines");
  return v.map((r, i) => {
    if (r === null || typeof r !== "object" || Array.isArray(r)) throw new HttpError(400, `Line ${i + 1} must be an object.`, "lines");
    const o = r as Record<string, unknown>;
    return {
      generalLedgerId: optWhole(o.generalLedgerId, `Line ${i + 1}: generalLedgerId`) ?? 0,
      subLedgerId: optWhole(o.subLedgerId, `Line ${i + 1}: subLedgerId`) ?? null,
      agentId: optWhole(o.agentId, `Line ${i + 1}: agentId`) ?? null,
      debit: amount(o.debit, `Line ${i + 1}: Dr`), credit: amount(o.credit, `Line ${i + 1}: Cr`),
      narration: text(o.narration, `Line ${i + 1}: narration`, 2000) ?? null,
    };
  });
}

function inputOf(req: Request, companyId: number): J.JournalVoucherInput {
  const b = req.body ?? {};
  if (typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "The request body must be an object.");
  if (typeof b.voucherDate !== "string") throw new HttpError(400, "voucherDate is required.", "voucherDate");
  return {
    companyId, branchId: whole(b.branchId, "branchId"), voucherNumber: text(b.voucherNumber, "voucherNumber", 60), numberSeriesId: optWhole(b.numberSeriesId, "numberSeriesId") ?? null,
    voucherDate: b.voucherDate, fiscalYear: text(b.fiscalYear, "fiscalYear", 15) || undefined, remarks: text(b.remarks, "remarks", 5000) ?? null, lines: linesOf(b.lines),
  };
}

async function owned(id: number, companyId: number) {
  const [r] = await db.select({ id: S.journalVoucher.id }).from(S.journalVoucher).where(eq(S.journalVoucher.id, id));
  if (!r) throw new HttpError(404, "Journal voucher not found.");
  void companyId; // the services and getJournalVoucher check the company themselves
}

// Declared before "/:id" so "lookups" is not read as an id.
journalVoucherRouter.get("/lookups", wrap(async (req, res) => { res.json(await J.journalLookups(companyOf(req))); }));

journalVoucherRouter.get("/", wrap(async (req, res) => {
  res.json(await J.listJournalVouchers({
    companyId: companyOf(req), branchId: optWhole(q(req, "branchId"), "branchId"), fiscalYear: q(req, "fiscalYear")?.slice(0, 15), status: q(req, "status"),
    search: q(req, "search")?.slice(0, 60), limit: optWhole(q(req, "limit"), "limit"),
  }));
}));

journalVoucherRouter.get("/:id", wrap(async (req, res) => { res.json(await J.getJournalVoucher(idOf(req), companyOf(req))); }));

journalVoucherRouter.post("/", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId, "companyId");
  const result = await J.saveJournalVoucher(inputOf(req, companyId), await actorOf(req), { lockOverride: lockOverrideOf(req) });
  res.status(201).json({ result, document: await J.getJournalVoucher(result.id, companyId) });
}));

journalVoucherRouter.put("/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  await owned(id, companyId);
  const result = await J.saveJournalVoucher({ ...inputOf(req, companyId), id }, await actorOf(req), { lockOverride: lockOverrideOf(req), reason: reasonOf(req) });
  res.json({ result, document: await J.getJournalVoucher(id, companyId) });
}));

journalVoucherRouter.delete("/:id", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  await owned(id, companyId);
  res.json({ result: await J.deleteJournalVoucher(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req), reason: reasonOf(req) }) });
}));

journalVoucherRouter.post("/:id/post", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  await owned(id, companyId);
  const result = await J.postJournalVoucher(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req) });
  res.json({ result, document: await J.getJournalVoucher(id, companyId) });
}));

journalVoucherRouter.post("/:id/reverse", wrap(async (req, res) => {
  const id = idOf(req), companyId = companyOf(req);
  await owned(id, companyId);
  const date = text(req.body?.date, "date", 10);
  const result = await J.reverseJournalVoucher(id, companyId, await actorOf(req), { lockOverride: lockOverrideOf(req), reason: reasonOf(req), date });
  res.json({ result, document: await J.getJournalVoucher(result.reversalVoucherId, companyId) });
}));
