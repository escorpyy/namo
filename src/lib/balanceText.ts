import { groupIN } from "../components/purchase/Bits";

// A ledger balance is one figure on one side: "NPR 500.00 Dr", "NPR 120.00 Cr", or "NPR 0.00" when nil.
// (The server already nets debit against credit, so at most one of the two is non-zero.)
export function drCrText(debit: string, credit: string): string {
  const n = (s: string) => Number(s.replace(/,/g, ""));
  if (n(debit) > 0) return `NPR ${groupIN(debit)} Dr`;
  if (n(credit) > 0) return `NPR ${groupIN(credit)} Cr`;
  return "NPR 0.00";
}
