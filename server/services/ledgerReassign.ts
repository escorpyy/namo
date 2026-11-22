import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { inActorTx, type Tx } from "./purchase/common";
import { moveOnVoucher, propagateAssessmentTerm, propagateTermLedger, type TermKind } from "./termLedgerPropagate";

// Background move of already-posted transactions when the ledger of a master is changed (see schema/ledgerReassignJob.ts).
export type JobKind = "PURCHASE_TERM" | "SALES_TERM" | "PRODUCT_PURCHASE" | "PRODUCT_SALES";
export type ProductSide = "PURCHASE" | "SALES";
const BATCH = 25; // documents per transaction
const running = new Set<number>();

const kindOf = (k: JobKind): TermKind => (k === "PURCHASE_TERM" ? "PURCHASE" : "SALES");
const isProduct = (k: string): k is "PRODUCT_PURCHASE" | "PRODUCT_SALES" => k === "PRODUCT_PURCHASE" || k === "PRODUCT_SALES";
const tables = (k: "PURCHASE_TERM" | "SALES_TERM") => k === "PURCHASE_TERM"
  ? { term: "PurchaseDocumentTerm", bill: "PurchaseBill", type: "PURCHASE_BILL" }
  : { term: "SalesDocumentTerm", bill: "SalesInvoice", type: "SALES_INVOICE" };

// Documents (and their term lines) of one term that still carry `ledgerId`. Posted and draft are counted apart: a draft needs no voucher move.
export async function termImpact(companyId: number, kind: "PURCHASE_TERM" | "SALES_TERM", termId: number, ledgerId: number) {
  const t = tables(kind);
  const [r] = (await db.execute(sql`
    select count(distinct b.id)::int as documents, count(distinct b.id) filter (where b."isPosted")::int as posted, count(*)::int as lines
      from ${sql.identifier(t.term)} d join ${sql.identifier(t.bill)} b on b.id = d."documentId" and d."documentType" = ${t.type}
     where b."companyId" = ${companyId} and d."termId" = ${termId} and d."generalLedgerId" = ${ledgerId}`)) as unknown as { documents: number; posted: number; lines: number }[];
  if (kind === "PURCHASE_TERM") {
    const [a] = (await db.execute(sql`
      select count(distinct a.id)::int as documents, count(distinct a.id) filter (where a."isPosted")::int as posted, count(*)::int as lines
        from "PurchaseImportAssessmentTerm" d join "PurchaseImportAssessment" a on a.id = d."assessmentId"
       where a."companyId" = ${companyId} and d."termId" = ${termId} and d."generalLedgerId" = ${ledgerId}`)) as unknown as { documents: number; posted: number; lines: number }[];
    return { documents: r.documents + a.documents, posted: r.posted + a.posted, lines: r.lines + a.lines };
  }
  return r;
}

export async function activeJobFor(companyId: number, kind: JobKind, masterId: number) {
  const [j] = await db.select({ id: S.ledgerReassignJob.id }).from(S.ledgerReassignJob)
    .where(and(eq(S.ledgerReassignJob.companyId, companyId), eq(S.ledgerReassignJob.kind, kind), eq(S.ledgerReassignJob.masterId, masterId), inArray(S.ledgerReassignJob.status, ["QUEUED", "RUNNING"]))).limit(1);
  return j ?? null;
}

export async function startJob(o: { companyId: number; kind: "PURCHASE_TERM" | "SALES_TERM"; masterId: number; masterName: string; fromLedgerId: number; toLedgerId: number; userId: number | null }) {
  const impact = await termImpact(o.companyId, o.kind, o.masterId, o.fromLedgerId);
  const [job] = await db.insert(S.ledgerReassignJob).values({
    companyId: o.companyId, kind: o.kind, masterId: o.masterId, masterName: o.masterName, fromLedgerId: o.fromLedgerId, toLedgerId: o.toLedgerId, total: impact.documents, createdBy: o.userId,
  }).returning();
  setImmediate(() => void runJob(job.id));
  return job;
}


// ---------------------------------------------------------------------------------------------------------------------
// PRODUCTS: the ledger a product posts to (purchase side: purchase / asset ledger, sales side: sales ledger)
// ---------------------------------------------------------------------------------------------------------------------
const PRODUCT_COLS: Record<ProductSide, Record<string, { table: string; column: string }>> = {
  PURCHASE: { STOCK: { table: "StockDetail", column: "purchaseGLId" }, NON_STOCK: { table: "NonStockDetail", column: "purchaseGLId" }, SERVICE: { table: "ServiceDetail", column: "purchaseGLId" }, FIXED_ASSET: { table: "FixedAssetDetail", column: "assetGLId" } },
  SALES: { STOCK: { table: "StockDetail", column: "salesGLId" }, NON_STOCK: { table: "NonStockDetail", column: "salesGLId" }, SERVICE: { table: "ServiceDetail", column: "salesGLId" } },
};
export { windowsOf };
export const productKind = (side: ProductSide): JobKind => (side === "PURCHASE" ? "PRODUCT_PURCHASE" : "PRODUCT_SALES");

type Window = { from: string | null; to: string | null };
export type ProductPeriod = Window & { ledgerId: number | null };
const UTC_STAMP = (col: string) => `to_char((${col} at time zone current_setting('TimeZone')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`; // the audit trail stamps in the database's time zone; postedAt is UTC

// The ledger a product posts to on one side now, and the periods in which that same ledger was in force (rebuilt from the audit trail: before the audit
// trail started nothing is known, so the ledger is taken to have been the same since the beginning).
export async function productLedger(q: { execute: typeof db.execute }, productId: number, side: ProductSide) {
  const [p] = (await q.execute(sql`select id, "companyId", type, code, description from "Product" where id = ${productId}`)) as unknown as { id: number; companyId: number; type: string; code: string; description: string }[];
  if (!p) return null;
  const m = PRODUCT_COLS[side][p.type];
  const none = { product: p, ledgerId: null as number | null, periods: [] as (Window & { ledgerId: number | null })[] };
  if (!m) return none;
  const [d] = (await q.execute(sql`select id, ${sql.identifier(m.column)} as gl from ${sql.identifier(m.table)} where "productId" = ${productId}`)) as unknown as { id: number; gl: number | null }[];
  if (!d) return none;
  const ch = (await q.execute(sql.raw(`select ${UTC_STAMP('"changedAt"')} as at, "oldData"->>'${m.column}' as o, "newData"->>'${m.column}' as n from "AuditLog"
     where "tableName" = '${m.table}' and "recordId" = '${d.id}' and action = 'UPDATE' and "oldData"->>'${m.column}' is distinct from "newData"->>'${m.column}' order by id`))) as unknown as { at: string; o: string | null; n: string | null }[];
  const periods: (Window & { ledgerId: number | null })[] = [];
  let from: string | null = null, ledger: number | null = ch.length ? (ch[0].o ? Number(ch[0].o) : null) : d.gl;
  for (const c of ch) { periods.push({ from, to: c.at, ledgerId: ledger }); from = c.at; ledger = c.n ? Number(c.n) : null; }
  periods.push({ from, to: null, ledgerId: ledger });
  return { product: p, ledgerId: d.gl, periods };
}
const windowsOf = (periods: (Window & { ledgerId: number | null })[], ledgerId: number, closeAt: string | null): Window[] =>
  periods.filter((x) => x.ledgerId === ledgerId).map((x) => ({ from: x.from, to: x.to ?? closeAt }));

const productDocs = (side: ProductSide) => side === "PURCHASE"
  ? { bill: "PurchaseBill", line: "PurchaseBillLine", fk: "purchaseBillId", type: "PURCHASE_BILL", drSide: true }
  : { bill: "SalesInvoice", line: "SalesInvoiceLine", fk: "salesInvoiceId", type: "SALES_INVOICE", drSide: false };

// Posted bills / invoices (not their reversals: those follow their original) of this product that used the old ledger: posted inside one of its periods.
const productWhere = (side: ProductSide, companyId: number, productId: number, windows: Window[]) => {
  const d = productDocs(side);
  const inWindow = windows.length
    ? sql`(${sql.join(windows.map((w) => sql`(${w.from ? sql`b."postedAt" > ${w.from}::timestamp` : sql`true`} and ${w.to ? sql`b."postedAt" <= ${w.to}::timestamp` : sql`true`})`), sql` or `)})`
    : sql`false`;
  return sql`b."companyId" = ${companyId} and b."isPosted" and b."reversalOfId" is null and b."journalVoucherId" is not null and ${inWindow}
    and exists (select 1 from ${sql.identifier(d.line)} l where l.${sql.identifier(d.fk)} = b.id and l."productId" = ${productId})`;
};

export async function productImpact(companyId: number, productId: number, side: ProductSide) {
  const cur = await productLedger(db, productId, side);
  if (!cur || cur.product.companyId !== companyId) throw new HttpError(404, "Product not found in this company.");
  const d = productDocs(side);
  const [r] = (await db.execute(sql`select count(*)::int as documents from ${sql.identifier(d.bill)} b where ${productWhere(side, companyId, productId, cur.ledgerId ? windowsOf(cur.periods, cur.ledgerId, null) : [])}`)) as unknown as { documents: number }[];
  return { masterName: `${cur.product.code} — ${cur.product.description}`, ledgerId: cur.ledgerId, documents: r.documents, posted: r.documents, lines: r.documents };
}

export async function startProductJob(o: { companyId: number; productId: number; side: ProductSide; masterName: string; fromLedgerId: number; toLedgerId: number; windows: Window[]; userId: number | null }) {
  const d = productDocs(o.side);
  const [c] = (await db.execute(sql`select count(*)::int as n from ${sql.identifier(d.bill)} b where ${productWhere(o.side, o.companyId, o.productId, o.windows)}`)) as unknown as { n: number }[];
  const [job] = await db.insert(S.ledgerReassignJob).values({
    companyId: o.companyId, kind: productKind(o.side), masterId: o.productId, masterName: o.masterName, fromLedgerId: o.fromLedgerId, toLedgerId: o.toLedgerId, total: c.n,
    createdBy: o.userId, windows: o.windows,
  }).returning();
  setImmediate(() => void runJob(job.id));
  return job;
}

// One batch: each bill with this product moves the product's lines (voucher Dr for purchase, Cr for sales) from the old ledger to the new one,
// together with the reversal vouchers of that bill (the opposite side), and is noted in LedgerReassignItem so it is never moved twice.
async function productBatch(job: typeof S.ledgerReassignJob.$inferSelect, side: ProductSide, ids: number[], tx: Tx) {
  const d = productDocs(side);
  let skipped = 0;
  for (const id of ids) {
    const [{ amount }] = (await tx.execute(sql`select coalesce(sum(l."basicAmount"), 0)::text as amount from ${sql.identifier(d.line)} l where l.${sql.identifier(d.fk)} = ${id} and l."productId" = ${job.masterId}`)) as unknown as { amount: string }[];
    const vouchers = (await tx.execute(sql`
      select b."journalVoucherId" as jv, false as reversal from ${sql.identifier(d.bill)} b where b.id = ${id}
      union all select r."journalVoucherId", true from ${sql.identifier(d.bill)} r where r."reversalOfId" = ${id} and r."isPosted" and r."journalVoucherId" is not null`)) as unknown as { jv: number; reversal: boolean }[];
    // all of this bill's vouchers move, or none of them (a savepoint undoes the vouchers already moved when one does not carry the amount)
    class Nothing extends Error {}
    let ok = Number(amount) > 0;
    if (ok) {
      try {
        await tx.transaction(async (sp) => {
          for (const v of vouchers) {
            const sideHere = d.drSide !== v.reversal ? "DR" : "CR";
            if (!(await moveOnVoucher(sp as Tx, v.jv, sideHere, amount, job.fromLedgerId, job.toLedgerId))) throw new Nothing();
          }
        });
      } catch (e) { if (e instanceof Nothing) ok = false; else throw e; }
    }
    if (!ok) skipped++; // the vouchers do not carry this amount on the old ledger: left exactly as they were
    await tx.insert(S.ledgerReassignItem).values({ jobId: job.id, documentType: d.type, documentId: id });
  }
  return { documents: ids.length, skipped };
}

export async function runJob(id: number): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    const [job] = await db.select().from(S.ledgerReassignJob).where(eq(S.ledgerReassignJob.id, id));
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) return;
    await db.update(S.ledgerReassignJob).set({ status: "RUNNING", startedAt: job.startedAt ?? new Date(), message: null }).where(eq(S.ledgerReassignJob.id, id));
    if (isProduct(job.kind)) {
      const side: ProductSide = job.kind === "PRODUCT_PURCHASE" ? "PURCHASE" : "SALES", d = productDocs(side);
      for (;;) {
        const ids = ((await db.execute(sql`
          select b.id from ${sql.identifier(d.bill)} b where ${productWhere(side, job.companyId, job.masterId, job.windows ?? [])}
             and not exists (select 1 from "LedgerReassignItem" i where i."jobId" = ${id} and i."documentType" = ${d.type} and i."documentId" = b.id) order by b.id limit ${BATCH}`)) as unknown as { id: number }[]).map((r) => r.id);
        if (!ids.length) break;
        const res = await inActorTx({ userId: job.createdBy, reason: `Ledger of product "${job.masterName}" reassigned (job #${id})` }, undefined, (tx) => productBatch(job, side, ids, tx));
        await db.update(S.ledgerReassignJob).set({ processed: sql`${S.ledgerReassignJob.processed} + ${res.documents}`, skipped: sql`${S.ledgerReassignJob.skipped} + ${res.skipped}` }).where(eq(S.ledgerReassignJob.id, id));
      }
      await db.update(S.ledgerReassignJob).set({ status: "DONE", finishedAt: new Date() }).where(eq(S.ledgerReassignJob.id, id));
      return;
    }
    const kind = job.kind as "PURCHASE_TERM" | "SALES_TERM", t = tables(kind);
    for (;;) {
      const ids = ((await db.execute(sql`
        select distinct b.id from ${sql.identifier(t.term)} d join ${sql.identifier(t.bill)} b on b.id = d."documentId" and d."documentType" = ${t.type}
         where b."companyId" = ${job.companyId} and d."termId" = ${job.masterId} and d."generalLedgerId" = ${job.fromLedgerId} order by b.id limit ${BATCH}`)) as unknown as { id: number }[]).map((r) => r.id);
      if (!ids.length) break;
      const res = await inActorTx({ userId: job.createdBy, reason: `Ledger of term "${job.masterName}" reassigned (job #${id})` }, undefined,
        (tx) => propagateTermLedger(tx, job.companyId, kindOf(kind), job.masterId, job.fromLedgerId, job.toLedgerId, ids));
      await db.update(S.ledgerReassignJob).set({ processed: sql`${S.ledgerReassignJob.processed} + ${res.documents}`, skipped: sql`${S.ledgerReassignJob.skipped} + ${res.skipped}` }).where(eq(S.ledgerReassignJob.id, id));
    }
    if (kind === "PURCHASE_TERM") {
      for (;;) {
        const ids = ((await db.execute(sql`
          select distinct a.id from "PurchaseImportAssessmentTerm" d join "PurchaseImportAssessment" a on a.id = d."assessmentId"
           where a."companyId" = ${job.companyId} and d."termId" = ${job.masterId} and d."generalLedgerId" = ${job.fromLedgerId} order by a.id limit ${BATCH}`)) as unknown as { id: number }[]).map((r) => r.id);
        if (!ids.length) break;
        const res = await inActorTx({ userId: job.createdBy, reason: `Ledger of term "${job.masterName}" reassigned (job #${id})` }, undefined,
          (tx) => propagateAssessmentTerm(tx, job.companyId, job.masterId, job.fromLedgerId, job.toLedgerId, ids));
        await db.update(S.ledgerReassignJob).set({ processed: sql`${S.ledgerReassignJob.processed} + ${res.documents}`, skipped: sql`${S.ledgerReassignJob.skipped} + ${res.skipped}` }).where(eq(S.ledgerReassignJob.id, id));
      }
    }
    await db.update(S.ledgerReassignJob).set({ status: "DONE", finishedAt: new Date() }).where(eq(S.ledgerReassignJob.id, id));
  } catch (e) {
    await db.update(S.ledgerReassignJob).set({ status: "FAILED", finishedAt: new Date(), message: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).where(eq(S.ledgerReassignJob.id, id)).catch(() => {});
  } finally {
    running.delete(id);
  }
}

// After a restart, jobs that were queued or running carry on where they stopped.
export async function resumeJobs() {
  const rows = await db.select({ id: S.ledgerReassignJob.id }).from(S.ledgerReassignJob).where(inArray(S.ledgerReassignJob.status, ["QUEUED", "RUNNING"]));
  for (const r of rows) setImmediate(() => void runJob(r.id));
}

export async function retryJob(companyId: number, id: number) {
  const [job] = await db.select().from(S.ledgerReassignJob).where(and(eq(S.ledgerReassignJob.id, id), eq(S.ledgerReassignJob.companyId, companyId)));
  if (!job) throw new HttpError(404, "Job not found.");
  if (job.status !== "FAILED") throw new HttpError(409, "Only a failed job can be retried.");
  await db.update(S.ledgerReassignJob).set({ status: "QUEUED", finishedAt: null, seenAt: null, message: null }).where(eq(S.ledgerReassignJob.id, id));
  setImmediate(() => void runJob(id));
}

// Jobs the person should know about: still running, or finished and not yet announced.
export async function jobsFor(companyId: number, userId: number | null) {
  return db.select({
    id: S.ledgerReassignJob.id, kind: S.ledgerReassignJob.kind, masterName: S.ledgerReassignJob.masterName, status: S.ledgerReassignJob.status, total: S.ledgerReassignJob.total,
    processed: S.ledgerReassignJob.processed, skipped: S.ledgerReassignJob.skipped, message: S.ledgerReassignJob.message, createdAt: S.ledgerReassignJob.createdAt, finishedAt: S.ledgerReassignJob.finishedAt,
  }).from(S.ledgerReassignJob)
    .where(and(eq(S.ledgerReassignJob.companyId, companyId), userId ? or(eq(S.ledgerReassignJob.createdBy, userId), isNull(S.ledgerReassignJob.createdBy)) : undefined,
      or(inArray(S.ledgerReassignJob.status, ["QUEUED", "RUNNING"]), and(inArray(S.ledgerReassignJob.status, ["DONE", "FAILED"]), isNull(S.ledgerReassignJob.seenAt)))))
    .orderBy(desc(S.ledgerReassignJob.id));
}

export async function markSeen(companyId: number, id: number) {
  await db.update(S.ledgerReassignJob).set({ seenAt: new Date() }).where(and(eq(S.ledgerReassignJob.id, id), eq(S.ledgerReassignJob.companyId, companyId), inArray(S.ledgerReassignJob.status, ["DONE", "FAILED"])));
}
