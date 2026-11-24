import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import * as S from "../db/schema";
import { HttpError } from "../routes/_util";
import { inActorTx, parseDate, type Actor, type Opts, type Tx } from "./purchase/common";
import { financialReportRows } from "./financialReportRows";
import { saveJournalVoucher, postJournalVoucher, reverseJournalVoucher } from "./journalVoucher";
import { closingLines } from "./yearEndCloseMath";
import { fmt as fmtMoney, toMicro } from "./purchase/money";
const cents = (v: string | number) => {
  const micro = toMicro(v);
  if (micro % 10_000n !== 0n) throw new HttpError(409, "A P&L balance has fractional cents and cannot be closed safely with a two-decimal journal.");
  return micro / 10_000n;
};
export type BranchClosePreview = { branchId: number; branchCode: string; branchName: string; netResult: string; lineCount: number };

async function lockedFiscalYear(tx: Tx, companyId: number, code: string, lock = false) {
  const rows = (lock
    ? await tx.execute(sql`SELECT * FROM "FiscalYear" WHERE "companyId"=${companyId} AND code=${code} FOR UPDATE`)
    : await tx.execute(sql`SELECT * FROM "FiscalYear" WHERE "companyId"=${companyId} AND code=${code}`)) as any[];
  const fy = rows[0];
  if (!fy) throw new HttpError(404, "Fiscal year not found for this company.", "fiscalYear");
  if (!fy.isActive) throw new HttpError(409, `Fiscal year ${code} is inactive.`, "fiscalYear");
  return fy;
}
async function targetLedger(tx: Tx, companyId: number) {
  const rows = await tx.select({ setup: S.generalLedgerSetup, gl: S.generalLedger, group: S.accountGroup })
    .from(S.generalLedgerSetup).innerJoin(S.generalLedger, eq(S.generalLedger.id, S.generalLedgerSetup.generalLedgerId))
    .innerJoin(S.accountGroup, eq(S.accountGroup.id, S.generalLedger.accountGroupId))
    .where(and(eq(S.generalLedgerSetup.companyId, companyId), eq(S.generalLedgerSetup.role, "PROFIT_AND_LOSS")));
  const row = rows[0];
  if (!row) throw new HttpError(409, "Configure the Profit and Loss Account in GL Setup before closing this year.", "generalLedgerId");
  if (row.gl.companyId !== companyId || !row.gl.isActive) throw new HttpError(409, "The mapped Profit and Loss ledger is inactive or does not belong to this company.", "generalLedgerId");
  if (row.group.type !== "EQUITY") throw new HttpError(409, "The mapped Profit and Loss year-end clearing ledger must be an Equity ledger.", "generalLedgerId");
  if (row.gl.requiresSubLedger) throw new HttpError(409, "The mapped Profit and Loss clearing ledger requires a sub-ledger, which GL Setup does not define.", "generalLedgerId");
  if (row.setup.isLocked || !row.setup.allowJournal) throw new HttpError(409, "The mapped Profit and Loss ledger is locked or does not allow Journal Voucher entries in GL Setup.", "generalLedgerId");
  return { id: row.gl.id, code: row.gl.code, name: row.gl.name };
}
async function previewWithin(tx: Tx, companyId: number, code: string) {
  const fy = await lockedFiscalYear(tx, companyId, code);
  const target = await targetLedger(tx, companyId);
  const start = new Date(fy.startDate).toISOString().slice(0, 10), end = new Date(fy.endDate).toISOString().slice(0, 10);
  const branches = await tx.select({ id: S.branch.id, code: S.branch.code, name: S.branch.name }).from(S.branch)
    .where(and(eq(S.branch.companyId, companyId), eq(S.branch.isActive, true)));
  const branchResults: BranchClosePreview[] = [];
  for (const branch of branches) {
    const rows = await financialReportRows(tx, { companyId, branchId: branch.id, fiscalYear: code, start, end, kind: "profit-loss" });
    const calculated = closingLines(rows, target.id, code);
    branchResults.push({ branchId: branch.id, branchCode: branch.code, branchName: branch.name, netResult: calculated.netResult, lineCount: calculated.lines.length });
  }
  const activeClose = await tx.select({ id: S.fiscalYearClose.id, status: S.fiscalYearClose.status })
    .from(S.fiscalYearClose).where(and(eq(S.fiscalYearClose.fiscalYearId, fy.id), eq(S.fiscalYearClose.status, "CLOSED")));
  return { fiscalYearId: Number(fy.id), fiscalYear: code, from: start, to: end, fiscalYearClosed: !!fy.isClosed,
    existingClose: activeClose[0] ?? null, ledger: target, branches: branchResults,
    netResult: fmtMoney(branchResults.reduce((s, b) => s + cents(b.netResult), 0n) * 10_000n, 2) };
}

export async function previewYearEndClose(companyId: number, code: string, opts: Opts = {}) {
  const run = (tx: Tx) => previewWithin(tx, companyId, code);
  if (opts.tx) return run(opts.tx);
  return db.transaction(run, { isolationLevel: "repeatable read", accessMode: "read only" });
}
export function closeFiscalYear(companyId: number, code: string, actor: Actor) {
  return inActorTx({ ...actor, reason: `Year-end P&L close ${code}` }, undefined, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fiscal-year-close:${companyId}:${code}`}))`);
    const fy = await lockedFiscalYear(tx, companyId, code, true);
    const preview = await previewWithin(tx, companyId, code);
    if (preview.fiscalYearClosed || preview.existingClose) throw new HttpError(409, `Fiscal year ${code} is already closed.`, "fiscalYear");
    const [close] = await tx.insert(S.fiscalYearClose).values({ companyId, fiscalYearId: preview.fiscalYearId, profitAndLossGLId: preview.ledger.id, netResult: preview.netResult, status: "REOPENING", closedBy: actor.userId }).returning({ id: S.fiscalYearClose.id });
    const endDate = new Date(`${preview.to}T00:00:00.000Z`);
    for (const branch of preview.branches) {
      const rows = await financialReportRows(tx, { companyId, branchId: branch.branchId, fiscalYear: code, start: preview.from, end: preview.to, kind: "profit-loss" });
      const { lines } = closingLines(rows, preview.ledger.id, code);
      if (!lines.length) continue;
      const saved = await saveJournalVoucher({ companyId, branchId: branch.branchId, voucherDate: endDate, fiscalYear: code, remarks: `Year-end P&L close ${code}`, lines }, actor, { tx, reason: `Year-end P&L close ${code}` });
      await postJournalVoucher(saved.id, companyId, actor, { tx });
      await tx.insert(S.fiscalYearCloseVoucher).values({ fiscalYearCloseId: close.id, branchId: branch.branchId, journalVoucherId: saved.id, netResult: branch.netResult });
    }
    await tx.update(S.fiscalYearClose).set({ status: "CLOSED", closedAt: new Date() }).where(eq(S.fiscalYearClose.id, close.id));
    await tx.update(S.fiscalYear).set({ isClosed: true, closedAt: new Date(), closedBy: actor.userId, updatedAt: new Date() }).where(eq(S.fiscalYear.id, fy.id));
    return { ...preview, closeId: close.id, closed: true };
  });
}
export function reopenFiscalYearClose(companyId: number, code: string, actor: Actor, reason: string) {
  const cleanReason = reason.trim();
  if (!cleanReason || cleanReason.length > 500) throw new HttpError(400, "A reason of 1 to 500 characters is required to reopen the fiscal year.", "reason");
  return inActorTx({ ...actor, reason: cleanReason }, undefined, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`fiscal-year-close:${companyId}:${code}`}))`);
    const fy = await lockedFiscalYear(tx, companyId, code, true);
    const [close] = await tx.select().from(S.fiscalYearClose).where(and(eq(S.fiscalYearClose.fiscalYearId, fy.id), eq(S.fiscalYearClose.status, "CLOSED")));
    if (!close || !fy.isClosed) throw new HttpError(409, `Fiscal year ${code} has no active year-end close to reopen.`, "fiscalYear");
    await tx.update(S.fiscalYearClose).set({ status: "REOPENING" }).where(eq(S.fiscalYearClose.id, close.id));
    await tx.update(S.fiscalYear).set({ isClosed: false, closedAt: null, closedBy: null, updatedAt: new Date() }).where(eq(S.fiscalYear.id, fy.id));
    await tx.execute(sql`select set_config('namo.year_end_close_operation', 'true', true)`);
    const links = await tx.select({ voucherId: S.fiscalYearCloseVoucher.journalVoucherId }).from(S.fiscalYearCloseVoucher).where(eq(S.fiscalYearCloseVoucher.fiscalYearCloseId, close.id));
    const endDate = new Date(fy.endDate).toISOString().slice(0, 10);
    for (const link of links) await reverseJournalVoucher(link.voucherId, companyId, actor, { tx, date: endDate, reason: `Reopen year-end close ${code}: ${cleanReason}` });
    await tx.update(S.fiscalYearClose).set({ status: "REOPENED", reopenedAt: new Date(), reopenedBy: actor.userId, reopenReason: cleanReason }).where(eq(S.fiscalYearClose.id, close.id));
    return { fiscalYear: code, closeId: close.id, reopened: true, reversedVouchers: links.length };
  });
}
export async function yearEndCloseStatus(companyId: number, code: string) {
  const rows = await db.select({ fy: S.fiscalYear, close: S.fiscalYearClose }).from(S.fiscalYear)
    .leftJoin(S.fiscalYearClose, and(eq(S.fiscalYearClose.fiscalYearId, S.fiscalYear.id), eq(S.fiscalYearClose.status, "CLOSED")))
    .where(and(eq(S.fiscalYear.companyId, companyId), eq(S.fiscalYear.code, code)));
  if (!rows.length) throw new HttpError(404, "Fiscal year not found for this company.", "fiscalYear");
  const { fy, close } = rows[0];
  const vouchers = close ? await db.select({ branchId: S.fiscalYearCloseVoucher.branchId, journalVoucherId: S.fiscalYearCloseVoucher.journalVoucherId, netResult: S.fiscalYearCloseVoucher.netResult })
    .from(S.fiscalYearCloseVoucher).where(eq(S.fiscalYearCloseVoucher.fiscalYearCloseId, close.id)) : [];
  return { fiscalYear: code, isClosed: fy.isClosed, close, vouchers };
}
