import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { listRules, saveRule, suggestCode } from "../services/codeRules";
import { HttpError, wrap } from "./_util";

// Code numbering rules (shared/codeRules.ts). No login yet (ERP-002): the company and user come from the request, like every other route.
//   GET  /api/code-rules?companyId=                     -> the rule of every master (built-in default where none is saved) with an example
//   PUT  /api/code-rules/:key        { companyId, userId?, mode, template }   -> save one master's rule
//   POST /api/code-rules/:key/suggest { companyId, parentId?, name?, type? }  -> { mode, code | null, reason? } the code to propose for a new record
export const codeRulesRouter = Router();

const whole = (v: unknown, name: string): number => {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > 2_000_000_000) throw new HttpError(400, `${name} is required.`, name);
  return n;
};
const object = (b: unknown): Record<string, unknown> => {
  if (b === null || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "Send a JSON object.");
  return b as Record<string, unknown>;
};

codeRulesRouter.get("/", wrap(async (req, res) => {
  const c = req.query.companyId;
  res.json(await listRules(whole(typeof c === "string" ? c : undefined, "companyId")));
}));

codeRulesRouter.put("/:key", wrap(async (req, res) => {
  const b = object(req.body), companyId = whole(b.companyId, "companyId");
  let userId: number | null = null;
  if (b.userId !== undefined && b.userId !== null && b.userId !== "") {
    userId = whole(b.userId, "userId");
    const [u] = await db.select({ isActive: S.user.isActive }).from(S.user).where(eq(S.user.id, userId));
    if (!u || !u.isActive) throw new HttpError(400, "Unknown or inactive user.", "userId");
  }
  res.json(await saveRule(companyId, req.params.key, { mode: b.mode, template: b.template }, userId));
}));

codeRulesRouter.post("/:key/suggest", wrap(async (req, res) => {
  const b = object(req.body), companyId = whole(b.companyId, "companyId");
  const text = (v: unknown, n: string) => { if (v === undefined || v === null || v === "") return null; if (typeof v !== "string" || v.length > 300) throw new HttpError(400, `${n} must be text.`, n); return v; };
  const parentId = b.parentId === undefined || b.parentId === null || b.parentId === "" ? null : whole(typeof b.parentId === "string" ? b.parentId : b.parentId, "parentId");
  res.json(await suggestCode(companyId, req.params.key, { parentId, name: text(b.name, "name"), type: text(b.type, "type") }));
}));
