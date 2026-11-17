import { withInitialPostedChildInsert } from "../db/audit";
import * as S from "../db/schema";
import { type Actor, type Tx } from "./purchase/common";
import { type Micro, ZERO, fmt } from "./purchase/money";

export type JvRow = {
  generalLedgerId: number;
  subLedgerId?: number | null;
  debit: Micro;
  credit: Micro;
  narration: string;
  agentId?: number | null;
};

// Keep separate control-account rows when their sub-ledger or agent differs.
export function mergeRows(rows: JvRow[]): JvRow[] {
  const out = new Map<string, JvRow>();
  for (const row of rows) {
    const key = `${row.generalLedgerId}:${row.subLedgerId ?? ""}:${row.agentId ?? ""}:${row.debit > ZERO ? "D" : "C"}`;
    const current = out.get(key);
    if (current) {
      current.debit += row.debit;
      current.credit += row.credit;
    } else out.set(key, { ...row });
  }
  return [...out.values()].filter((row) => row.debit !== ZERO || row.credit !== ZERO);
}

export async function writeVoucher(
  tx: Tx,
  header: { companyId: number; branchId: number; voucherNumber: string; voucherDate: Date; fiscalYear: string; remarks: string; reversalOfId: number | null },
  rows: JvRow[],
  actor: Actor,
) {
  const [voucher] = await tx.insert(S.journalVoucher).values({
    ...header,
    isPosted: true,
    postedAt: new Date(),
    postedBy: actor.userId,
    createdBy: actor.userId,
  }).returning({ id: S.journalVoucher.id });
  await withInitialPostedChildInsert(tx, "JournalVoucherLine", voucher.id, async () => {
    let lineNumber = 1;
    for (const row of rows) {
      await tx.insert(S.journalVoucherLine).values({
        journalVoucherId: voucher.id,
        lineNumber: lineNumber++,
        generalLedgerId: row.generalLedgerId,
        subLedgerId: row.subLedgerId ?? null,
        debit: fmt(row.debit, 2),
        credit: fmt(row.credit, 2),
        narration: row.narration,
        agentId: row.agentId ?? null,
      });
    }
  });
  return voucher.id;
}
