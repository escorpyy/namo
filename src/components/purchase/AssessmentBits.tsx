import type { ReactNode } from "react";
import { money } from "./Bits";
import { ADD_CELL, DEDUCT_CELL, centsText, type Nature } from "../../lib/assessmentTabs";

// Small display pieces shared by the tabs of the Cost Assessment screen. Additions are light green with dark green text and a plus sign,
// deductions pink with red text and a minus sign.

/** Paisa as a money string with Indian digit grouping (never negative: callers show the sign themselves). */
export const fmtC = (c: number): string => money(centsText(Math.abs(c)));
export const signedC = (c: number): string => (c === 0 ? "—" : c > 0 ? `+${fmtC(c)}` : `−${fmtC(c)}`);
export const natureClass = (n: Nature): string => (n === "DEDUCTIVE" ? DEDUCT_CELL : ADD_CELL);

export function NatureChip({ nature, children, title }: { nature: Nature; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${natureClass(nature)}`}>
      <span aria-hidden>{nature === "DEDUCTIVE" ? "−" : "+"}</span>{children}
    </span>
  );
}

export function ModeChip({ mode }: { mode: "AUTO" | "MANUAL" }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${mode === "MANUAL" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
      {mode === "MANUAL" ? "Manual" : "Auto"}
    </span>
  );
}

export const basisLabel = (b: "VALUE" | "QUANTITY") => (b === "QUANTITY" ? "Quantity" : "Value");
