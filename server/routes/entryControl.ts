import { Router } from "express";
import { db } from "../db";
import * as S from "../db/schema";
import { ENTRY_MODULES, ENTRY_RULE_LEVELS, resolveEntry, type EntryControlMap } from "../../shared/entryControl";
import { inActorTx } from "../services/purchase/common";
import { HttpError, wrap } from "./_util";
import { actorOf, companyOf, whole } from "./_input";
import { entryControlsOf } from "../services/entryControl";

export const entryControlRouter = Router();
const LEVELS = new Set(ENTRY_RULE_LEVELS.map((l) => l.value));

entryControlRouter.get("/", wrap(async (req, res) => {
  res.json({ modules: ENTRY_MODULES, controls: await entryControlsOf(db, companyOf(req)) });
}));

// One call saves the whole page: { companyId, controls: { MODULE: { feature: { show, edit, mandatory, rule } } } }.
entryControlRouter.put("/", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId, "companyId");
  const actor = await actorOf(req);
  const input = req.body?.controls;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "controls must be an object.", "controls");
  const rows: { module: string; feature: string; isShown: boolean; isEditable: boolean; isMandatory: boolean; ruleLevel: string }[] = [];
  for (const m of ENTRY_MODULES) {
    for (const f of m.features) {
      const v = (input as EntryControlMap)[m.key]?.[f.key];
      if (v === undefined) continue;
      if (typeof v !== "object" || v === null) throw new HttpError(400, `${m.label} / ${f.label}: invalid value.`, "controls");
      for (const k of ["show", "edit", "mandatory"] as const) if (v[k] !== undefined && typeof v[k] !== "boolean") throw new HttpError(400, `${m.label} / ${f.label}: ${k} must be true or false.`, "controls");
      if (v.rule !== undefined && !LEVELS.has(v.rule)) throw new HttpError(400, `${m.label} / ${f.label}: rule must be Ignore, Warn or Block.`, "controls");
      const r = resolveEntry(f, v);
      rows.push({ module: m.key, feature: f.key, isShown: r.show, isEditable: r.edit, isMandatory: r.mandatory, ruleLevel: r.rule });
    }
  }
  await inActorTx(actor, undefined, async (tx) => {
    for (const r of rows) {
      await tx.insert(S.entryControl).values({ companyId, ...r })
        .onConflictDoUpdate({ target: [S.entryControl.companyId, S.entryControl.module, S.entryControl.feature], set: { isShown: r.isShown, isEditable: r.isEditable, isMandatory: r.isMandatory, ruleLevel: r.ruleLevel, updatedAt: new Date() } });
    }
  });
  res.json({ modules: ENTRY_MODULES, controls: await entryControlsOf(db, companyId) });
}));
