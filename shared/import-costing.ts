import {
  allocateByWeights,
  div,
  fmt,
  priceTerms,
  roundTo,
  sum,
  toMicro,
  type EngineLine,
  type EngineTerm,
  type Micro,
  ZERO,
} from "./purchase-calculation";

export type ImportAllocationBasis = "VALUE" | "QUANTITY";

export interface ImportCostLineInput {
  key: number;
  lineNumber: number;
  quantity: string | number;
  goodsValue: string | number;
  /** Signed net allocations already posted to the import bill's lines; these affect landed value, not CIF. */
  existingPurchaseTermCosts?: string | number;
}

/** Amounts are supplied in the company's base currency after any required FX conversion. */
export interface ImportCostSourceInput {
  key: string;
  label: string;
  /** Cost capitalized into inventory; recoverable tax should not be included. */
  capitalizedAmount: string | number;
  /** Amount included in the customs valuation/CIF base. May differ from capitalizedAmount. */
  customsValueAmount: string | number;
  allocationBasis: ImportAllocationBasis;
}

export interface ImportAssessmentTermInput {
  term: EngineTerm;
  allocationBasis: ImportAllocationBasis;
  /** False for recoverable tax or other assessed amounts that must not increase inventory value. */
  capitalizable: boolean;
  /**
   * Product-wise amounts typed by the user (line key -> amount). When present they replace the automatic split of this charge;
   * the engine reports in manualDifference by how much they miss the charge, and the caller decides whether that is acceptable.
   */
  manualAmounts?: Map<number, Micro>;
}

export interface ImportCostLineResult {
  lineNumber: number;
  goodsValue: Micro;
  customsValue: Micro;
  capitalizedSources: Micro;
  existingPurchaseTermCosts: Micro;
  capitalizedAssessments: Micro;
  landedValue: Micro;
  landedRate: Micro;
}

export interface ImportCostingResult {
  goodsValue: Micro;
  customsValueFromSources: Micro;
  cifValue: Micro;
  invoicedCapitalizedCosts: Micro;
  existingPurchaseTermCosts: Micro;
  assessedNet: Micro;
  capitalizedAssessments: Micro;
  totalLandedValue: Micro;
  lines: Map<number, ImportCostLineResult>;
  sourceAllocations: Map<string, Map<number, Micro>>;
  termAllocations: Map<number, Map<number, Micro>>;
  /** Charge amount minus the sum of its manual product-wise amounts; only set for charges split by hand. Zero means it ties. */
  manualDifference: Map<number, Micro>;
  termResults: ReturnType<typeof priceTerms>["results"];
}

const money = (value: string | number) => roundTo(toMicro(value), 2);
const weightsFor = (lines: ImportCostLineInput[], basis: ImportAllocationBasis) =>
  lines.map((line) => basis === "VALUE" ? money(line.goodsValue) : toMicro(line.quantity));

const split = (amount: Micro, weights: Micro[]) => amount === ZERO ? weights.map(() => ZERO) : allocateByWeights(amount, weights);

/**
 * Compute the import valuation and product-wise landed cost preview.
 * This is intentionally calculation-only: journal posting and stock/COGS revaluation need an explicit inventory policy.
 */
export function calculateImportCosting(
  lines: ImportCostLineInput[],
  sources: ImportCostSourceInput[],
  assessmentTerms: ImportAssessmentTermInput[],
): ImportCostingResult {
  if (lines.length === 0) throw new Error("An import costing needs at least one goods line.");
  const lineKeys = new Set<number>();
  for (const line of lines) {
    if (!Number.isInteger(line.key) || lineKeys.has(line.key)) throw new Error("Import-cost line keys must be unique integers.");
    lineKeys.add(line.key);
    if (!Number.isInteger(line.lineNumber) || line.lineNumber < 1) throw new Error("Import-cost line numbers must be positive whole numbers.");
    if (toMicro(line.goodsValue) < ZERO) throw new Error(`Line ${line.lineNumber}: goods value cannot be negative.`);
    if (toMicro(line.quantity) < ZERO) throw new Error(`Line ${line.lineNumber}: quantity cannot be negative.`);
  }
  const sourceKeys = new Set<string>();
  for (const source of sources) {
    if (!source.key || sourceKeys.has(source.key)) throw new Error("Import-cost source keys must be unique and non-empty.");
    sourceKeys.add(source.key);
    if (toMicro(source.capitalizedAmount) < ZERO || toMicro(source.customsValueAmount) < ZERO) {
      throw new Error(`${source.label}: source amounts cannot be negative.`);
    }
  }

  const basic = lines.map((line) => ({ key: line.key, lineNumber: line.lineNumber, value: money(line.goodsValue) }));
  const goodsValue = sum(basic.map((line) => line.value));
  const customValueByLine = new Map(basic.map((line) => [line.key, line.value]));
  const capitalizedSourcesByLine = new Map(lines.map((line) => [line.key, ZERO]));
  const existingPurchaseTermsByLine = new Map(lines.map((line) => [line.key, roundTo(toMicro(line.existingPurchaseTermCosts ?? "0"), 2)]));
  const existingPurchaseTermCosts = sum([...existingPurchaseTermsByLine.values()]);
  const sourceAllocations = new Map<string, Map<number, Micro>>();
  let customsValueFromSources = ZERO;
  let invoicedCapitalizedCosts = ZERO;

  for (const source of sources) {
    const customsValue = money(source.customsValueAmount);
    const capitalizedAmount = money(source.capitalizedAmount);
    const weights = weightsFor(lines, source.allocationBasis);
    const customsParts = split(customsValue, weights);
    const costParts = split(capitalizedAmount, weights);
    const allocations = new Map<number, Micro>();
    for (let i = 0; i < lines.length; i++) {
      const key = lines[i].key;
      customValueByLine.set(key, customValueByLine.get(key)! + customsParts[i]);
      capitalizedSourcesByLine.set(key, capitalizedSourcesByLine.get(key)! + costParts[i]);
      allocations.set(key, costParts[i]);
    }
    sourceAllocations.set(source.key, allocations);
    customsValueFromSources += customsValue;
    invoicedCapitalizedCosts += capitalizedAmount;
  }

  const cifValue = goodsValue + customsValueFromSources;
  const cifLines: EngineLine[] = lines.map((line) => ({ key: line.key, basicAmount: customValueByLine.get(line.key)! }));
  const termKeys = new Set<number>();
  for (const row of assessmentTerms) {
    if (termKeys.has(row.term.key)) throw new Error("Assessment term row keys must be unique.");
    termKeys.add(row.term.key);
    if (row.term.lineKey !== null && row.term.lineKey !== undefined) throw new Error("Import assessment charges must be document-level terms.");
  }
  const priced = priceTerms(cifLines, assessmentTerms.map((row) => row.term));
  const capitalizedAssessmentsByLine = new Map(lines.map((line) => [line.key, ZERO]));
  const termAllocations = new Map<number, Map<number, Micro>>();
  const manualDifference = new Map<number, Micro>();
  let capitalizedAssessments = ZERO;

  for (const row of assessmentTerms) {
    const result = priced.results.get(row.term.key)!;
    if (!row.capitalizable) continue;
    const sign = row.term.nature === "ADDITIVE" ? 1n : -1n;
    const amount = result.finalAmount;
    let parts: Micro[];
    if (row.manualAmounts) {
      for (const [lineKey, value] of row.manualAmounts) {
        if (!lineKeys.has(lineKey)) throw new Error("A manual amount points to a line that is not on this bill.");
        if (value < ZERO) throw new Error("Manual product-wise amounts cannot be negative.");
      }
      const entered = lines.map((line) => roundTo(row.manualAmounts!.get(line.key) ?? ZERO, 2));
      manualDifference.set(row.term.key, amount - sum(entered));
      parts = entered.map((part) => part * sign);
    } else {
      parts = split(amount, weightsFor(lines, row.allocationBasis)).map((part) => part * sign);
    }
    const allocations = new Map<number, Micro>();
    for (let i = 0; i < lines.length; i++) {
      const key = lines[i].key;
      capitalizedAssessmentsByLine.set(key, capitalizedAssessmentsByLine.get(key)! + parts[i]);
      allocations.set(key, parts[i]);
    }
    termAllocations.set(row.term.key, allocations);
    capitalizedAssessments += sum(parts); // the lines' own total, so the header always equals the sum of the lines
  }

  const lineResults = new Map<number, ImportCostLineResult>();
  for (const line of lines) {
    const goods = money(line.goodsValue);
    const customs = customValueByLine.get(line.key)!;
    const sourcesCost = capitalizedSourcesByLine.get(line.key)!;
    const existingTermsCost = existingPurchaseTermsByLine.get(line.key)!;
    const assessmentsCost = capitalizedAssessmentsByLine.get(line.key)!;
    const landedValue = goods + sourcesCost + existingTermsCost + assessmentsCost;
    if (landedValue < ZERO) throw new Error(`Line ${line.lineNumber}: deductible costs exceed its landed value.`);
    const quantity = toMicro(line.quantity);
    lineResults.set(line.key, {
      lineNumber: line.lineNumber,
      goodsValue: goods,
      customsValue: customs,
      capitalizedSources: sourcesCost,
      existingPurchaseTermCosts: existingTermsCost,
      capitalizedAssessments: assessmentsCost,
      landedValue,
      landedRate: quantity === ZERO ? ZERO : div(landedValue, quantity),
    });
  }

  return {
    goodsValue,
    customsValueFromSources,
    cifValue,
    invoicedCapitalizedCosts,
    existingPurchaseTermCosts,
    assessedNet: priced.termNet,
    capitalizedAssessments,
    totalLandedValue: sum([...lineResults.values()].map((line) => line.landedValue)),
    lines: lineResults,
    sourceAllocations,
    termAllocations,
    manualDifference,
    termResults: priced.results,
  };
}

export const formatImportCost = (value: Micro, decimals = 2) => fmt(value, decimals);
