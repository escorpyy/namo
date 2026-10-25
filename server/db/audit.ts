import { sql, type SQL } from "drizzle-orm";

// ERP-024: who made a change, and why, for the audit trail the DATABASE writes (trigger namo.audit_row, migration 0008).
// The trigger reads two settings that belong to the current transaction only (set_config(..., true)): they end when the
// transaction ends, so they can never leak to another request that reuses the same connection. Call this at the START of
// every transaction that writes an audited table. A call without a user (or with none) clears the previous one, so a
// stale user is never recorded.
//
// Until login exists (ERP-002) the user is whatever the caller says it is; the routes check that it is a real, active user.
export type AuditContext = { userId?: number | null; reason?: string | null };

// Anything that can run a statement: a drizzle transaction, or the db itself.
type Execer = { execute: (query: SQL) => PromiseLike<unknown> };

export async function setAuditContext(tx: Execer, ctx: AuditContext = {}): Promise<void> {
  const id = ctx.userId;
  const user = typeof id === "number" && Number.isInteger(id) && id > 0 ? String(id) : "";
  const reason = (ctx.reason ?? "").trim();
  await tx.execute(sql`select set_config('namo.actor_user_id', ${user}, true), set_config('namo.change_reason', ${reason}, true)`);
}
