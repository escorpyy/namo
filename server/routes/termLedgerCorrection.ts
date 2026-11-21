import { Router, type Request } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { applyTermLedgerCorrection, countOnLedger, previewTermLedgerCorrection, type CorrectionFilter, type CorrectionKind } from "../services/termLedgerCorrection";
import { HttpError, wrap } from "./_util";

// Move posted bills / invoices of one term from the ledger they were posted to onto the right ledger, with ONE correcting journal voucher.
//   GET  /api/term-ledger-correction/preview?companyId&kind=PURCHASE|SALES&termId&fromLedgerId&toLedgerId[&dateFrom&dateTo&branchId]
//   GET  /api/term-ledger-correction/count?companyId&kind&termId&ledgerId    -> posted documents still on that ledger (master warning)
//   POST /api/term-ledger-correction/apply   body: the preview fields + userId, date (voucher date, default today), reason (required)
export const termLedgerCorrectionRouter = Router();

const whole = (v: unknown, name: string): number => {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new HttpError(400, `${name} is required.`, name);
  return n;
};
const optWhole = (v: unknown, name: string) => (v === undefined || v === null || v === "" ? null : whole(v, name));
const optDate = (v: unknown, name: string) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, `${name} must be a date like 2026-07-15.`, name);
  return v;
};
const kindOf = (v: unknown): CorrectionKind => {
  if (v !== "PURCHASE" && v !== "SALES") throw new HttpError(400, "kind must be PURCHASE or SALES.", "kind");
  return v;
};
function filterOf(src: Record<string, unknown>): CorrectionFilter {
  return {
    kind: kindOf(src.kind), termId: whole(src.termId, "termId"), fromLedgerId: whole(src.fromLedgerId, "fromLedgerId"), toLedgerId: whole(src.toLedgerId, "toLedgerId"),
    dateFrom: optDate(src.dateFrom, "dateFrom"), dateTo: optDate(src.dateTo, "dateTo"), branchId: optWhole(src.branchId, "branchId"),
  };
}

termLedgerCorrectionRouter.get("/preview", wrap(async (req, res) => {
  res.json(await previewTermLedgerCorrection(whole(req.query.companyId, "companyId"), filterOf(req.query)));
}));

termLedgerCorrectionRouter.get("/count", wrap(async (req, res) => {
  const q = req.query;
  res.json(await countOnLedger(whole(q.companyId, "companyId"), kindOf(q.kind), whole(q.termId, "termId"), whole(q.ledgerId, "ledgerId")));
}));

async function actorOf(req: Request) {
  const raw = req.body?.userId;
  if (raw === undefined || raw === null || raw === "") return { userId: null };
  const id = whole(raw, "userId");
  const [u] = await db.select({ id: S.user.id, isActive: S.user.isActive }).from(S.user).where(eq(S.user.id, id));
  if (!u || !u.isActive) throw new HttpError(400, "Unknown or inactive user.", "userId");
  return { userId: id };
}

termLedgerCorrectionRouter.post("/apply", wrap(async (req, res) => {
  const b = req.body;
  if (b === null || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Send a JSON object.");
  if (typeof b.reason !== "string") throw new HttpError(400, "Give a reason for this correction.", "reason");
  const out = await applyTermLedgerCorrection(whole(b.companyId, "companyId"), { ...filterOf(b), date: optDate(b.date, "date"), reason: b.reason }, await actorOf(req));
  res.status(201).json(out);
}));
