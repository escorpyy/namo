import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { AUDITED_TABLES } from "../db/audit";
import { HttpError, wrap } from "./_util";

// ERP-024 part 2: read the audit trail (written by the database, migration 0008). Read-only on purpose: there is no route that
// writes, edits or deletes an entry, and the database refuses those too.
// No login yet (ERP-002): the company is whatever the caller asks for, like every other route. Do not expose real data.
export const auditRouter = Router();

const ACTIONS = ["INSERT", "UPDATE", "DELETE"] as const;
const DEFAULT_LIMIT = 50, MAX_LIMIT = 200;
const MAX_PG_INTEGER = 2_147_483_647n;
const MAX_PG_BIGINT = 9_223_372_036_854_775_807n;

const posInt = (s: string, name: string, max: bigint) => {
  if (!/^[1-9]\d{0,18}$/.test(s) || BigInt(s) > max) throw new HttpError(400, `${name} must be a positive whole number in range.`, name);
  return s;
};
const one = (v: unknown, name: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v === "") throw new HttpError(400, `${name} must be provided once as a non-empty value.`, name);
  return v;
};

// Fields whose value differs between the old and the new row. updatedAt always moves, so it would only be noise.
const changedFields = (o: any, n: any): string[] => {
  const keys = new Set([...Object.keys(o ?? {}), ...Object.keys(n ?? {})]);
  return [...keys].filter((k) => k !== "updatedAt" && JSON.stringify(o?.[k]) !== JSON.stringify(n?.[k])).sort();
};

// GET /api/audit?companyId=1[&tableName=][&recordId=][&changedBy=][&action=][&limit=50][&before=<id>]
// Newest first. `before` is the nextBefore of the previous page; nextBefore is null on the last page. Ids are strings (bigint).
auditRouter.get("/", wrap(async (req, res) => {
  const q = req.query;
  const companyValue = one(q.companyId, "companyId");
  if (companyValue === undefined) throw new HttpError(400, "companyId is required.", "companyId");
  const companyId = posInt(companyValue, "companyId", MAX_PG_INTEGER);

  const tableName = one(q.tableName, "tableName");
  if (tableName !== undefined && !(AUDITED_TABLES as readonly string[]).includes(tableName)) throw new HttpError(400, `tableName must be one of: ${AUDITED_TABLES.join(", ")}.`, "tableName");
  const action = one(q.action, "action");
  if (action !== undefined && !(ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, `action must be one of: ${ACTIONS.join(", ")}.`, "action");
  const changedByValue = one(q.changedBy, "changedBy");
  const changedBy = changedByValue === undefined ? undefined : posInt(changedByValue, "changedBy", MAX_PG_INTEGER);
  const beforeValue = one(q.before, "before");
  const before = beforeValue === undefined ? undefined : posInt(beforeValue, "before", MAX_PG_BIGINT);
  const recordId = one(q.recordId, "recordId");
  let limit = DEFAULT_LIMIT;
  const limitValue = one(q.limit, "limit");
  if (limitValue !== undefined) {
    const s = limitValue;
    limit = /^\d{1,4}$/.test(s) ? Number(s) : 0;
    if (limit < 1 || limit > MAX_LIMIT) throw new HttpError(400, `limit must be between 1 and ${MAX_LIMIT}.`, "limit");
  }

  const where = [sql`a."companyId" = ${companyId}::integer`];
  if (tableName) where.push(sql`a."tableName" = ${tableName}`);
  if (recordId) where.push(sql`a."recordId" = ${recordId}`);
  if (action) where.push(sql`a."action" = ${action}::"AuditAction"`);
  if (changedBy) where.push(sql`a."changedBy" = ${changedBy}::integer`);
  if (before) where.push(sql`a.id < ${before}::bigint`);

  const found = (await db.execute(sql`
    select a.id::text as id, a."companyId", a."tableName", a."recordId", a."action"::text as action,
           a."changedBy", u.name as "changedByName", a."reason", a."changedAt", a."oldData", a."newData"
      from "AuditLog" a left join "User" u on u.id = a."changedBy"
     where ${sql.join(where, sql` and `)}
     order by a.id desc
     limit ${limit + 1}`)) as any[];

  const page = found.slice(0, limit);
  res.json({
    rows: page.map((r) => ({
      id: r.id, companyId: r.companyId, tableName: r.tableName, recordId: r.recordId, action: r.action,
      changedBy: r.changedBy, changedByName: r.changedByName, reason: r.reason, changedAt: r.changedAt,
      changedFields: r.action === "UPDATE" ? changedFields(r.oldData, r.newData) : null,
      oldData: r.oldData, newData: r.newData,
    })),
    nextBefore: found.length > limit ? page[page.length - 1].id : null,
  });
}));
