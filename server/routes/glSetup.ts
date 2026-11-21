import { and, asc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { GL_ENTRY_TYPES, GL_SETUP_ROLES, type GlRoleKey } from "../../shared/glSetup";
import { db } from "../db";
import * as S from "../db/schema";
import { inActorTx } from "../services/purchase/common";
import { HttpError, wrap } from "./_util";
import { actorOf, companyOf, whole } from "./_input";

export const glSetupRouter = Router();
const roleKeys = new Set<string>(GL_SETUP_ROLES.map((role) => role.key));
const boolKeys = [...GL_ENTRY_TYPES.map((entry) => entry.key), "isLocked"] as const;

async function setupOf(companyId: number) {
  const [saved, ledgers] = await Promise.all([
    db.select().from(S.generalLedgerSetup).where(eq(S.generalLedgerSetup.companyId, companyId)),
    db.select({
      id: S.generalLedger.id, code: S.generalLedger.code, name: S.generalLedger.name,
      normalBalance: S.generalLedger.normalBalance, isActive: S.generalLedger.isActive,
      isCashOrBank: S.generalLedger.isCashOrBank, requiresSubLedger: S.generalLedger.requiresSubLedger,
    }).from(S.generalLedger).where(eq(S.generalLedger.companyId, companyId)).orderBy(asc(S.generalLedger.code)),
  ]);
  const byRole = new Map(saved.map((row) => [row.role, row]));
  const roles = GL_SETUP_ROLES.map((definition) => {
    const row = byRole.get(definition.key);
    return {
      role: definition.key,
      label: definition.label,
      hint: definition.hint,
      generalLedgerId: row?.generalLedgerId ?? null,
      ...Object.fromEntries(boolKeys.map((key) => [key, row?.[key] ?? definition.defaults[key]])),
    };
  });
  return { roles, ledgers };
}

glSetupRouter.get("/", wrap(async (req, res) => {
  res.json(await setupOf(companyOf(req)));
}));

glSetupRouter.put("/", wrap(async (req, res) => {
  const companyId = whole(req.body?.companyId, "companyId");
  const actor = await actorOf(req);
  if (!Array.isArray(req.body?.roles) || req.body.roles.length !== GL_SETUP_ROLES.length) {
    throw new HttpError(400, `Provide all ${GL_SETUP_ROLES.length} GL Setup roles.`, "roles");
  }

  const parsed = req.body.roles.map((row: unknown, index: number) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new HttpError(400, `Role ${index + 1} must be an object.`, "roles");
    const value = row as Record<string, unknown>;
    if (typeof value.role !== "string" || !roleKeys.has(value.role)) throw new HttpError(400, `Role ${index + 1} is not a supported GL Setup role.`, "roles");
    if (value.generalLedgerId !== null && (!Number.isInteger(value.generalLedgerId) || Number(value.generalLedgerId) <= 0)) {
      throw new HttpError(400, `${value.role}: General Ledger must be selected or left blank.`, "generalLedgerId");
    }
    const controls: Record<string, boolean> = {};
    for (const key of boolKeys) {
      if (typeof value[key] !== "boolean") throw new HttpError(400, `${value.role}: ${key} must be true or false.`, key);
      controls[key] = value[key] as boolean;
    }
    return { role: value.role as GlRoleKey, generalLedgerId: value.generalLedgerId as number | null, ...controls };
  });
  const keys = parsed.map((row: { role: string }) => row.role);
  if (new Set(keys).size !== GL_SETUP_ROLES.length || GL_SETUP_ROLES.some((role) => !keys.includes(role.key))) {
    throw new HttpError(400, "Each GL Setup role must appear exactly once.", "roles");
  }

  const ledgerIds: number[] = [...new Set<number>((parsed as { generalLedgerId: number | null }[]).map((row) => row.generalLedgerId).filter((id): id is number => id !== null))];
  if (ledgerIds.length) {
    const valid = await db.select({ id: S.generalLedger.id, isActive: S.generalLedger.isActive }).from(S.generalLedger)
      .where(and(eq(S.generalLedger.companyId, companyId), inArray(S.generalLedger.id, ledgerIds)));
    const byId = new Map(valid.map((row) => [row.id, row]));
    for (const row of parsed as { role: string; generalLedgerId: number | null }[]) {
      if (row.generalLedgerId === null) continue;
      const ledger = byId.get(row.generalLedgerId);
      if (!ledger) throw new HttpError(400, `${row.role}: the selected ledger does not belong to this company.`, "generalLedgerId");
      if (!ledger.isActive) throw new HttpError(409, `${row.role}: the selected ledger is inactive.`, "generalLedgerId");
    }
  }

  await inActorTx(actor, undefined, async (tx) => {
    for (const row of parsed) {
      const { role, ...values } = row;
      await tx.insert(S.generalLedgerSetup).values({ companyId, role, ...values })
        .onConflictDoUpdate({
          target: [S.generalLedgerSetup.companyId, S.generalLedgerSetup.role],
          set: { ...values, updatedAt: new Date() },
        });
    }
  });
  res.json(await setupOf(companyId));
}));
