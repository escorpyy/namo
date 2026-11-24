import { Router, type Request } from "express";
import { actorOf, companyOf, q, whole } from "./_input";
import { HttpError, wrap } from "./_util";
import { closeFiscalYear, previewYearEndClose, reopenFiscalYearClose, yearEndCloseStatus } from "../services/yearEndClose";

export const yearEndCloseRouter = Router();
function yearCode(req: Request) {
  const code = q(req, "fiscalYear") ?? (typeof req.body?.fiscalYear === "string" ? req.body.fiscalYear : undefined);
  if (!code || code.length > 15) throw new HttpError(400, "A fiscalYear code of at most 15 characters is required.", "fiscalYear");
  return code;
}
yearEndCloseRouter.get("/preview", wrap(async (req, res) => {
  res.json(await previewYearEndClose(companyOf(req), yearCode(req)));
}));
yearEndCloseRouter.get("/status/:fiscalYear", wrap(async (req, res) => {
  const code = req.params.fiscalYear;
  if (!code || code.length > 15) throw new HttpError(400, "A fiscalYear code of at most 15 characters is required.", "fiscalYear");
  res.json(await yearEndCloseStatus(companyOf(req), code));
}));
yearEndCloseRouter.post("/close", wrap(async (req, res) => {
  const actor = await actorOf(req);
  res.json(await closeFiscalYear(whole(req.body?.companyId, "companyId"), yearCode(req), actor));
}));
yearEndCloseRouter.post("/reopen/:fiscalYear", wrap(async (req, res) => {
  const actor = await actorOf(req);
  const code = req.params.fiscalYear;
  if (!code || code.length > 15) throw new HttpError(400, "A fiscalYear code of at most 15 characters is required.", "fiscalYear");
  const reason = req.body?.reason;
  if (typeof reason !== "string") throw new HttpError(400, "A reason is required to reopen a closed fiscal year.", "reason");
  res.json(await reopenFiscalYearClose(whole(req.body?.companyId, "companyId"), code, actor, reason));
}));
