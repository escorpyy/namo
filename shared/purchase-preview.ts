import {
  fmt, priceTerms, toMicro, ZERO,
  type EngineLine, type EngineTerm,
} from "./purchase-calculation";

export interface PreviewLineInput {
  /** Consecutive document line number, after blank rows are omitted. */
  lineNumber: number;
  basicAmount: string;
}
export interface PreviewTermInput {
  rowKey: string;
  termId: number;
  lineNumber?: string;
  calcType: "PERCENT" | "AMOUNT";
  rate?: string;
  inputAmount?: string;
  isOverridden: boolean;
  overrideAmount?: string;
}
export interface PreviewTermMaster {
  id: number;
  sequence: number;
  nature: "ADDITIVE" | "DEDUCTIVE";
  isProductwise: boolean;
  calcBase: "ITEM_VALUE" | "RUNNING_TOTAL" | "SINGLE_TERM";
  baseTermId?: number | null;
}
export interface PreviewTermResult {
  baseAmount: string;
  calculatedAmount: string;
  finalAmount: string;
  signedAmount: string;
  nature: "ADDITIVE" | "DEDUCTIVE";
}
export interface PurchasePreview {
  status: "ready" | "incomplete" | "error";
  message?: string;
  basicAmount: string;
  additions: string | null;
  deductions: string | null;
  termAmount: string | null;
  netAmount: string | null;
  terms: Map<string, PreviewTermResult>;
}

/**
 * Returns live totals from the same exact engine used to save/post purchase bills.
 * If any entered line or term is incomplete, only the known basic subtotal is shown;
 * the net amount is withheld rather than presenting a misleading partial total.
 */
export function previewPurchase(
  lines: PreviewLineInput[],
  terms: PreviewTermInput[],
  masters: Map<number, PreviewTermMaster>,
  incompleteLines = false,
): PurchasePreview {
  let itemTotal = ZERO;
  try {
    itemTotal = lines.reduce((sum, line) => sum + toMicro(line.basicAmount), ZERO);
  } catch (error) {
    return { status: "error", message: (error as Error).message, basicAmount: "0.00", additions: null, deductions: null, termAmount: null, netAmount: null, terms: new Map() };
  }
  const basicAmount = fmt(itemTotal, 2);
  const empty = (status: "incomplete" | "error", message: string): PurchasePreview => ({
    status, message, basicAmount, additions: null, deductions: null, termAmount: null, netAmount: null, terms: new Map(),
  });

  if (incompleteLines) return empty("incomplete", "Complete each entered line's product, quantity, and rate to calculate terms and net amount.");

  const engineLines: EngineLine[] = lines.map((line) => ({ key: line.lineNumber, basicAmount: toMicro(line.basicAmount) }));
  const engineTerms: EngineTerm[] = [];
  const rowKeyByIndex = new Map<number, string>();
  const seen = new Set<string>();

  for (const term of terms) {
    const master = masters.get(term.termId);
    if (!master) return empty("incomplete", "Choose a valid billing term to calculate the invoice total.");
    const lineNumber = master.isProductwise ? Number(term.lineNumber) : null;
    if (master.isProductwise && (!Number.isInteger(lineNumber) || lineNumber! < 1 || !engineLines.some((line) => line.key === lineNumber))) {
      return empty("incomplete", `Choose a valid bill line for term ${term.termId}.`);
    }
    const dup = `${term.termId}:${master.isProductwise ? lineNumber : ""}`;
    if (seen.has(dup)) return empty("error", `Term ${term.termId} is entered more than once for the same scope.`);
    seen.add(dup);

    const rate = term.calcType === "PERCENT" ? term.rate : undefined;
    const inputAmount = term.calcType === "AMOUNT" ? term.inputAmount : undefined;
    const overrideAmount = term.isOverridden ? term.overrideAmount : undefined;
    if ((term.calcType === "PERCENT" && !rate) || (term.calcType === "AMOUNT" && !inputAmount) || (term.isOverridden && !overrideAmount)) {
      return empty("incomplete", "Complete each billing term's rate or amount (and any override) to calculate the invoice total.");
    }

    try {
      const index = engineTerms.length;
      engineTerms.push({
        key: index,
        termId: term.termId,
        sequence: master.sequence,
        nature: master.nature,
        calcBase: master.calcBase,
        baseTermId: master.baseTermId,
        calcType: term.calcType,
        rate: rate === undefined ? null : toMicro(rate),
        inputAmount: inputAmount === undefined ? null : toMicro(inputAmount),
        isOverridden: term.isOverridden,
        overrideAmount: overrideAmount === undefined ? null : toMicro(overrideAmount),
        lineKey: lineNumber,
      });
      rowKeyByIndex.set(index, term.rowKey);
    } catch (error) {
      return empty("incomplete", (error as Error).message);
    }
  }

  try {
    const result = priceTerms(engineLines, engineTerms);
    let additions = ZERO;
    let deductions = ZERO;
    const termResults = new Map<string, PreviewTermResult>();
    for (const [index, row] of result.results) {
      if (row.signed >= ZERO) additions += row.signed;
      else deductions -= row.signed;
      const rowKey = rowKeyByIndex.get(index);
      const engineTerm = engineTerms.find((term) => term.key === index)!;
      if (rowKey) termResults.set(rowKey, {
        baseAmount: fmt(row.baseAmount, 2),
        calculatedAmount: fmt(row.calculatedAmount, 2),
        finalAmount: fmt(row.finalAmount, 2),
        signedAmount: fmt(row.signed, 2),
        nature: engineTerm.nature,
      });
    }
    return {
      status: "ready",
      basicAmount: fmt(result.itemTotal, 2),
      additions: fmt(additions, 2),
      deductions: fmt(deductions, 2),
      termAmount: fmt(result.termNet, 2),
      netAmount: fmt(result.total, 2),
      terms: termResults,
    };
  } catch (error) {
    return empty("error", (error as Error).message);
  }
}
