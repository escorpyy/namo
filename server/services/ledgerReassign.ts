import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { inActorTx } from "./purchase/common";
import { propagateTermLedger, type TermKind } from "./termLedgerPropagate";

// Background move of already-posted transactions when the ledger of a master is changed (see schema/ledgerReassignJob.ts).
export type JobKind = "PURCHASE_TERM" | "SALES_TERM";
const BATCH = 25; // documents per transaction
const running = new Set<number>();

const kindOf = (k: JobKind): TermKind => (k === "PURCHASE_TERM" ? "PURCHASE" : "SALES");
const tables = (k: JobKind) => k === "PURCHASE_TERM"
  ? { term: "PurchaseDocumentTerm", bill: "PurchaseBill", type: "PURCHASE_BILL" }
  : { term: "SalesDocumentTerm", bill: "SalesInvoice", type: "SALES_INVOICE" };

// Documents (and their term lines) of one term that still carry `ledgerId`. Posted and draft are counted apart: a draft needs no voucher move.
export async function termImpact(companyId: number, kind: JobKind, termId: number, ledgerId: number) {
  const t = tables(kind);
  const [r] = (await db.execute(sql`
    select count(distinct b.id)::int as documents, count(distinct b.id) filter (where b."isPosted")::int as posted, count(*)::int as lines
      from ${sql.identifier(t.term)} d join ${sql.identifier(t.bill)} b on b.id = d."documentId" and d."documentType" = ${t.type}
     where b."companyId" = ${companyId} and d."termId" = ${termId} and d."generalLedgerId" = ${ledgerId}`)) as unknown as { documents: number; posted: number; lines: number }[];
  return r;
}

export async function activeJobFor(companyId: number, kind: JobKind, masterId: number) {
  const [j] = await db.select({ id: S.ledgerReassignJob.id }).from(S.ledgerReassignJob)
    .where(and(eq(S.ledgerReassignJob.companyId, companyId), eq(S.ledgerReassignJob.kind, kind), eq(S.ledgerReassignJob.masterId, masterId), inArray(S.ledgerReassignJob.status, ["QUEUED", "RUNNING"]))).limit(1);
  return j ?? null;
}

export async function startJob(o: { companyId: number; kind: JobKind; masterId: number; masterName: string; fromLedgerId: number; toLedgerId: number; userId: number | null }) {
  const impact = await termImpact(o.companyId, o.kind, o.masterId, o.fromLedgerId);
  const [job] = await db.insert(S.ledgerReassignJob).values({
    companyId: o.companyId, kind: o.kind, masterId: o.masterId, masterName: o.masterName, fromLedgerId: o.fromLedgerId, toLedgerId: o.toLedgerId, total: impact.documents, createdBy: o.userId,
  }).returning();
  setImmediate(() => void runJob(job.id));
  return job;
}

export async function runJob(id: number): Promise<void> {
  if (running.has(id)) return;
  running.add(id);
  try {
    const [job] = await db.select().from(S.ledgerReassignJob).where(eq(S.ledgerReassignJob.id, id));
    if (!job || (job.status !== "QUEUED" && job.status !== "RUNNING")) return;
    await db.update(S.ledgerReassignJob).set({ status: "RUNNING", startedAt: job.startedAt ?? new Date(), message: null }).where(eq(S.ledgerReassignJob.id, id));
    const kind = job.kind as JobKind, t = tables(kind);
    for (;;) {
      const ids = ((await db.execute(sql`
        select distinct b.id from ${sql.identifier(t.term)} d join ${sql.identifier(t.bill)} b on b.id = d."documentId" and d."documentType" = ${t.type}
         where b."companyId" = ${job.companyId} and d."termId" = ${job.masterId} and d."generalLedgerId" = ${job.fromLedgerId} order by b.id limit ${BATCH}`)) as unknown as { id: number }[]).map((r) => r.id);
      if (!ids.length) break;
      const res = await inActorTx({ userId: job.createdBy, reason: `Ledger of term "${job.masterName}" reassigned (job #${id})` }, undefined,
        (tx) => propagateTermLedger(tx, job.companyId, kindOf(kind), job.masterId, job.fromLedgerId, job.toLedgerId, ids));
      await db.update(S.ledgerReassignJob).set({ processed: sql`${S.ledgerReassignJob.processed} + ${res.documents}`, skipped: sql`${S.ledgerReassignJob.skipped} + ${res.skipped}` }).where(eq(S.ledgerReassignJob.id, id));
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
