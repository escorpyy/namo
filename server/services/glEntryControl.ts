import { and, eq, inArray } from "drizzle-orm";
import type { GlEntryType, GlRoleKey } from "../../shared/glSetup";
import { GL_ENTRY_TYPES, GL_SETUP_ROLES } from "../../shared/glSetup";
import type { Tx } from "./purchase/common";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";

const controlFor = Object.fromEntries(GL_ENTRY_TYPES.map((item) => [item.entryType, item.key])) as Record<GlEntryType, (typeof GL_ENTRY_TYPES)[number]["key"]>;
const roleLabel = new Map<string, string>(GL_SETUP_ROLES.map((role) => [role.key, role.label]));

// Only GLs explicitly mapped in GL Setup are gated. Existing companies retain their current behavior until a role is assigned.
export async function assertGlEntryAllowed(tx: Tx, companyId: number, ledgerIds: number[], entryType: GlEntryType) {
  const ids = [...new Set(ledgerIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return;
  const rows = await tx.select({
    role: S.generalLedgerSetup.role,
    generalLedgerId: S.generalLedgerSetup.generalLedgerId,
    isLocked: S.generalLedgerSetup.isLocked,
    allowed: S.generalLedgerSetup[controlFor[entryType]],
    code: S.generalLedger.code,
  }).from(S.generalLedgerSetup)
    .innerJoin(S.generalLedger, eq(S.generalLedger.id, S.generalLedgerSetup.generalLedgerId))
    .where(and(eq(S.generalLedgerSetup.companyId, companyId), inArray(S.generalLedgerSetup.generalLedgerId, ids)));
  for (const row of rows) {
    const role = roleLabel.get(row.role) ?? row.role;
    if (row.isLocked) throw new HttpError(409, `Ledger ${row.code} is locked in GL Setup (${role}).`);
    if (!row.allowed) {
      const label = GL_ENTRY_TYPES.find((item) => item.entryType === entryType)?.label ?? entryType;
      throw new HttpError(409, `Ledger ${row.code} is not allowed for ${label} in GL Setup (${role}).`);
    }
  }
}

// Workflows such as stock opening post through product-specific GL mappings. Check named role
// assignments too, even when the workflow has not yet materialized journal lines.
export async function assertGlRolesAllowed(tx: Tx, companyId: number, roles: GlRoleKey[], entryType: GlEntryType) {
  if (!roles.length) return;
  const rows = await tx.select({
    role: S.generalLedgerSetup.role,
    generalLedgerId: S.generalLedgerSetup.generalLedgerId,
    isLocked: S.generalLedgerSetup.isLocked,
    allowed: S.generalLedgerSetup[controlFor[entryType]],
    code: S.generalLedger.code,
  }).from(S.generalLedgerSetup)
    .leftJoin(S.generalLedger, eq(S.generalLedger.id, S.generalLedgerSetup.generalLedgerId))
    .where(and(eq(S.generalLedgerSetup.companyId, companyId), inArray(S.generalLedgerSetup.role, roles)));
  for (const row of rows) {
    if (row.generalLedgerId === null) continue;
    const role = roleLabel.get(row.role) ?? row.role;
    if (row.isLocked) throw new HttpError(409, `Ledger ${row.code ?? ""} is locked in GL Setup (${role}).`);
    if (!row.allowed) {
      const label = GL_ENTRY_TYPES.find((item) => item.entryType === entryType)?.label ?? entryType;
      throw new HttpError(409, `Ledger ${row.code ?? ""} is not allowed for ${label} in GL Setup (${role}).`);
    }
  }
}
