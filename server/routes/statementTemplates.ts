import { Router, type Request } from "express";
import {
  copyStatementTemplate,
  createStatementTemplate,
  deleteStatementTemplate,
  getStatementTemplate,
  listStatementTemplates,
  reportFromStatementTemplate,
  replaceStatementTemplateDefinition,
  setDefaultStatementTemplate,
  updateStatementTemplate,
  type TemplateDefinition,
} from "../services/statementTemplates";
import { actorOf, companyOf, idOf, q, whole } from "./_input";
import { HttpError, wrap } from "./_util";

export const statementTemplatesRouter = Router();

type StatementCode = "PL" | "BS";
function record(v: unknown, field: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, `${field} must be an object.`, field);
  return v as Record<string, unknown>;
}
function requiredText(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new HttpError(400, `${field} is required (maximum ${max} characters).`, field);
  return v;
}
function reportInput(req: Request) {
  const rawStatement = q(req, "statement");
  if (rawStatement !== "PL" && rawStatement !== "BS") throw new HttpError(400, "statement must be PL or BS.", "statement");
  const from = q(req, "from"), to = q(req, "to"), fiscalYear = q(req, "fiscalYear");
  if (!from) throw new HttpError(400, "from is required.", "from");
  if (!to) throw new HttpError(400, "to is required.", "to");
  if (!fiscalYear) throw new HttpError(400, "fiscalYear is required.", "fiscalYear");
  return {
    companyId: companyOf(req), templateId: idOf(req), statement: rawStatement as StatementCode,
    branchId: whole(q(req, "branchId"), "branchId"), fiscalYear, from, to,
  };
}

// Company scoping is required on every endpoint. The application does not have an authentication middleware yet;
// the optional userId only supplies the existing audit actor context and is not an authorization check.
statementTemplatesRouter.get("/", wrap(async (req, res) => {
  res.json(await listStatementTemplates(companyOf(req)));
}));

statementTemplatesRouter.post("/", wrap(async (req, res) => {
  const body = record(req.body, "body");
  const name = requiredText(body.name, "name", 100);
  if (body.description !== undefined && body.description !== null && (typeof body.description !== "string" || body.description.length > 500)) throw new HttpError(400, "description must be 500 characters or fewer.", "description");
  const description = body.description === undefined ? null : body.description as string | null;
  const created = await createStatementTemplate(companyOf(req), name, description, await actorOf(req));
  res.status(201).json(created);
}));

statementTemplatesRouter.post("/:id/copy", wrap(async (req, res) => {
  const body = record(req.body, "body");
  const name = requiredText(body.name, "name", 100);
  const copied = await copyStatementTemplate(companyOf(req), idOf(req), name, await actorOf(req));
  res.status(201).json(copied);
}));

statementTemplatesRouter.put("/:id/definition", wrap(async (req, res) => {
  const body = record(req.body, "body") as unknown as TemplateDefinition;
  res.json(await replaceStatementTemplateDefinition(companyOf(req), idOf(req), body, await actorOf(req)));
}));

statementTemplatesRouter.patch("/:id/default", wrap(async (req, res) => {
  res.json(await setDefaultStatementTemplate(companyOf(req), idOf(req), await actorOf(req)));
}));

statementTemplatesRouter.get("/:id/report", wrap(async (req, res) => {
  res.json(await reportFromStatementTemplate(reportInput(req)));
}));

statementTemplatesRouter.get("/:id/unmapped", wrap(async (req, res) => {
  const report = await reportFromStatementTemplate(reportInput(req));
  res.json({ statement: report.statement, fiscalYear: report.fiscalYear, from: report.from, to: report.to, unmapped: report.unmapped });
}));

statementTemplatesRouter.patch("/:id", wrap(async (req, res) => {
  const body = record(req.body, "body");
  const patch: { name?: string; description?: string | null; isActive?: boolean } = {};
  if (body.name !== undefined) patch.name = requiredText(body.name, "name", 100);
  if (body.description !== undefined) {
    if (body.description !== null && (typeof body.description !== "string" || body.description.length > 500)) throw new HttpError(400, "description must be 500 characters or fewer.", "description");
    patch.description = body.description as string | null;
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new HttpError(400, "isActive must be true or false.", "isActive");
    patch.isActive = body.isActive;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "Provide name, description, or isActive.");
  res.json(await updateStatementTemplate(companyOf(req), idOf(req), patch, await actorOf(req)));
}));

statementTemplatesRouter.delete("/:id", wrap(async (req, res) => {
  res.json(await deleteStatementTemplate(companyOf(req), idOf(req), await actorOf(req)));
}));

statementTemplatesRouter.get("/:id", wrap(async (req, res) => {
  res.json(await getStatementTemplate(companyOf(req), idOf(req)));
}));
