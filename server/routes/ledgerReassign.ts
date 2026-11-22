import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { jobsFor, markSeen, productImpact, retryJob, termImpact } from "../services/ledgerReassign";
import { HttpError, wrap } from "./_util";

// What a ledger change on a master would touch, and the background jobs that move posted transactions to the new ledger.
//   GET  /api/ledger-reassign/impact?companyId&kind=PURCHASE_TERM|SALES_TERM&masterId  -> how many documents carry the master's current ledger
//   GET  /api/ledger-reassign/jobs?companyId[&userId]                                  -> running jobs and finished ones not yet announced
//   POST /api/ledger-reassign/jobs/:id/seen?companyId                                  -> the person has been told
//   POST /api/ledger-reassign/jobs/:id/retry?companyId                                 -> carry on a failed job
export const ledgerReassignRouter = Router();

const whole = (v: unknown, name: string): number => {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `${name} is required.`, name);
  return n;
};

ledgerReassignRouter.get("/impact", wrap(async (req, res) => {
  const companyId = whole(req.query.companyId, "companyId"), masterId = whole(req.query.masterId, "masterId");
  const kind = req.query.kind;
  if (kind === "PRODUCT_PURCHASE" || kind === "PRODUCT_SALES") {
    res.json(await productImpact(companyId, masterId, kind === "PRODUCT_PURCHASE" ? "PURCHASE" : "SALES"));
    return;
  }
  if (kind !== "PURCHASE_TERM" && kind !== "SALES_TERM") throw new HttpError(400, "kind must be PURCHASE_TERM, SALES_TERM, PRODUCT_PURCHASE or PRODUCT_SALES.", "kind");
  const term = kind === "PURCHASE_TERM" ? S.purchaseTerm : S.salesTerm;
  const [m] = await db.select({ name: term.name, generalLedgerId: term.generalLedgerId }).from(term).where(and(eq(term.id, masterId), eq(term.companyId, companyId)));
  if (!m) throw new HttpError(404, "Term not found in this company.");
  const impact = m.generalLedgerId ? await termImpact(companyId, kind, masterId, m.generalLedgerId) : { documents: 0, posted: 0, lines: 0 };
  res.json({ masterName: m.name, ledgerId: m.generalLedgerId, ...impact });
}));

ledgerReassignRouter.get("/jobs", wrap(async (req, res) => {
  const userId = req.query.userId ? whole(req.query.userId, "userId") : null;
  res.json(await jobsFor(whole(req.query.companyId, "companyId"), userId));
}));

ledgerReassignRouter.post("/jobs/:id/seen", wrap(async (req, res) => {
  await markSeen(whole(req.query.companyId, "companyId"), whole(req.params.id, "id"));
  res.json({ ok: true });
}));

ledgerReassignRouter.post("/jobs/:id/retry", wrap(async (req, res) => {
  await retryJob(whole(req.query.companyId, "companyId"), whole(req.params.id, "id"));
  res.json({ ok: true });
}));
