import { sql, type SQL } from "drizzle-orm";

// ERP-024: who made a change, and why, for the audit trail the DATABASE writes (trigger namo.audit_row, migration 0008).
// The trigger reads two settings that belong to the current transaction only (set_config(..., true)): they end when the
// transaction ends, so they can never leak to another request that reuses the same connection. Call this at the START of
// every transaction that writes an audited table. A call without a user (or with none) clears the previous one, so a
// stale user is never recorded.
//
// Until login exists (ERP-002) the user is whatever the caller says it is; the routes check that it is a real, active user.
// The tables the audit trigger watches (migration 0008). The audit API accepts only these; a test keeps the list equal to the database.
export const AUDITED_TABLES = [
  "CashBankVoucher", "CashBankVoucherLine", "JournalVoucher", "JournalVoucherLine", "OpeningBalance",
  "PurchaseBill", "PurchaseBillImportDetail", "PurchaseBillLine", "PurchaseDocumentTerm", "PurchaseDocumentTermAllocation",
] as const;

export type AuditContext = { userId?: number | null; reason?: string | null };

// Anything that can run a statement: a drizzle transaction, or the db itself.
type Execer = { execute: (query: SQL) => PromiseLike<unknown> };

export async function setAuditContext(tx: Execer, ctx: AuditContext = {}): Promise<void> {
  const id = ctx.userId;
  const user = typeof id === "number" && Number.isInteger(id) && id > 0 ? String(id) : "";
  const reason = (ctx.reason ?? "").trim();
  await tx.execute(sql`select set_config('namo.actor_user_id', ${user}, true), set_config('namo.change_reason', ${reason}, true)`);
}

// The raw values of the two settings (empty text when unset), so a nested caller can put the outer ones back.
export type RawAuditContext = { user: string; reason: string };

export async function readAuditContext(tx: Execer): Promise<RawAuditContext> {
  const rows = (await tx.execute(sql`select coalesce(current_setting('namo.actor_user_id', true), '') as "user", coalesce(current_setting('namo.change_reason', true), '') as "reason"`)) as unknown as RawAuditContext[];
  return { user: rows[0].user, reason: rows[0].reason };
}

export async function restoreAuditContext(tx: Execer, raw: RawAuditContext): Promise<void> {
  await tx.execute(sql`select set_config('namo.actor_user_id', ${raw.user}, true), set_config('namo.change_reason', ${raw.reason}, true)`);
}
