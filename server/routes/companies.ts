import { Router } from "express";
import { z } from "zod";
import { createCompany } from "../services/companyDefaults";
import { listTrash, purgeCompany, restoreCompany } from "../services/companyTrash";
import { HttpError, wrap } from "./_util";
import { actorOf, idOf } from "./_input";

// POST /api/companies   { code, name, businessType, fiscalYearCode, startDate, endDate, setup: "DEFAULT" | "BLANK", userId? }
//   setup DEFAULT -> chart of accounts + GL Setup are filled in; BLANK -> only the company, Head Office and fiscal year.
// Deleting is DELETE /api/masters/companies/:id and only moves the company to the Trash. Then:
//   GET    /api/companies/trash
//   POST   /api/companies/:id/restore
//   DELETE /api/companies/:id/permanent   { confirmCode }   erases everything of that company; cannot be undone
export const companiesRouter = Router();

companiesRouter.get("/trash", wrap(async (_req, res) => { res.json(await listTrash()); }));
companiesRouter.post("/:id/restore", wrap(async (req, res) => {
  await restoreCompany(idOf(req));
  res.json({ ok: true });
}));
companiesRouter.delete("/:id/permanent", wrap(async (req, res) => {
  await purgeCompany(idOf(req), String(req.body?.confirmCode ?? ""));
  res.json({ ok: true });
}));

const isoDate = z.string({ required_error: "Date is required." }).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, "Enter a valid date (YYYY-MM-DD).");

const schema = z.object({
  code: z.string({ required_error: "Code is required." }).trim().min(1, "Code is required.").max(15, "Code can be at most 15 characters.")
    .regex(/^[A-Za-z0-9_-]+$/, "Code can use letters, digits, - and _ only.").transform((v) => v.toUpperCase()),
  name: z.string({ required_error: "Name is required." }).trim().min(1, "Name is required.").max(200, "Name can be at most 200 characters."),
  businessType: z.enum(["SOLE_PROPRIETORSHIP", "PARTNERSHIP", "PRIVATE_LIMITED", "PUBLIC_LIMITED", "OTHER"], { errorMap: () => ({ message: "Choose a business type." }) }),
  fiscalYearCode: z.string({ required_error: "Fiscal year code is required." }).trim().min(1, "Fiscal year code is required.").max(15, "Fiscal year code can be at most 15 characters."),
  startDate: isoDate,
  endDate: isoDate,
  // No default on purpose: the caller must say which kind of company it wants.
  setup: z.enum(["DEFAULT", "BLANK"], { errorMap: () => ({ message: "Choose how to set up the company: default data or blank." }) }),
}).refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "End date must be after the start date." });

companiesRouter.post("/", wrap(async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, issue.message, String(issue.path[0] ?? ""));
  }
  const created = await createCompany(parsed.data, await actorOf(req));
  res.status(201).json(created);
}));
