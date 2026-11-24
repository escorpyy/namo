import { HttpError } from "../routes/_util";
import { fmt as fmtMoney, toMicro } from "./purchase/money";

const cents = (v: string | number) => {
  const micro = toMicro(v);
  if (micro % 10_000n !== 0n) throw new HttpError(409, "A P&L balance has fractional cents and cannot be closed safely with a two-decimal journal.");
  return micro / 10_000n;
};
const fmt = (v: bigint) => fmtMoney(v * 10_000n, 2);

export type ClosingLine = { generalLedgerId: number; debit: string; credit: string; narration: string };
export function closingLines(rows: { generalLedgerId: number; closing: string | number }[], profitAndLossGLId: number, fiscalYear: string) {
  const netResultCents = -rows.reduce((sum, row) => sum + cents(row.closing), 0n);
  const lines: ClosingLine[] = rows.flatMap((row) => {
    const balance = cents(row.closing);
    if (balance === 0n) return [];
    return [{ generalLedgerId: row.generalLedgerId, debit: balance < 0n ? fmt(-balance) : "0.00", credit: balance > 0n ? fmt(balance) : "0.00", narration: `Year-end close ${fiscalYear}` }];
  });
  if (netResultCents > 0n) lines.push({ generalLedgerId: profitAndLossGLId, debit: "0.00", credit: fmt(netResultCents), narration: `Transfer net profit for ${fiscalYear}` });
  else if (netResultCents < 0n) lines.push({ generalLedgerId: profitAndLossGLId, debit: fmt(-netResultCents), credit: "0.00", narration: `Transfer net loss for ${fiscalYear}` });
  return { netResult: fmt(netResultCents), lines };
}
