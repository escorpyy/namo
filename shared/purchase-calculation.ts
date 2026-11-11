// Pure purchase money and billing-term calculations shared by the server and browser preview.
// Amounts, rates and quantities use six-decimal fixed-point BigInt values; money is rounded to paisa.
export type Micro = bigint;
export const ONE: Micro = 1_000_000n;
export const ZERO: Micro = 0n;

export class PurchaseCalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseCalculationError";
  }
}

export function toMicro(v: string | number | bigint | null | undefined): Micro {
  if (v === null || v === undefined || v === "") return ZERO;
  if (typeof v === "bigint") return v;
  const s = String(v).trim();
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new PurchaseCalculationError(`"${s}" is not a valid number.`);
  const frac = m[3] ?? "";
  let n = BigInt(m[2]) * ONE + BigInt(frac.slice(0, 6).padEnd(6, "0"));
  if (frac.length > 6 && frac.charCodeAt(6) >= 53) n += 1n;
  return m[1] === "-" ? -n : n;
}

export function roundTo(m: Micro, dp: number): Micro {
  if (dp >= 6) return m;
  const unit = 10n ** BigInt(6 - dp);
  const a = m < 0n ? -m : m;
  const rounded = ((a + unit / 2n) / unit) * unit;
  return m < 0n ? -rounded : rounded;
}

export function fmt(m: Micro, dp = 6): string {
  const neg = m < 0n;
  const rounded = roundTo(neg ? -m : m, dp);
  const int = rounded / ONE;
  const frac = (rounded % ONE).toString().padStart(6, "0").slice(0, dp);
  return `${neg && rounded !== 0n ? "-" : ""}${int}${dp > 0 ? `.${frac}` : ""}`;
}

export function mul(a: Micro, b: Micro): Micro {
  const product = a * b;
  const neg = product < 0n;
  const abs = neg ? -product : product;
  let q = abs / ONE;
  if ((abs % ONE) * 2n >= ONE) q += 1n;
  return neg ? -q : q;
}

export function div(a: Micro, b: Micro): Micro {
  if (b === 0n) throw new PurchaseCalculationError("Division by zero.");
  const numerator = a * ONE;
  const neg = (numerator < 0n) !== (b < 0n);
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = b < 0n ? -b : b;
  let q = absNumerator / absDenominator;
  if ((absNumerator % absDenominator) * 2n >= absDenominator) q += 1n;
  return neg ? -q : q;
}

export const percentOf = (base: Micro, ratePercent: Micro): Micro => roundTo(div(mul(base, ratePercent), 100n * ONE), 2);
export const sum = (values: Micro[]): Micro => values.reduce((a, b) => a + b, ZERO);
export const lineBasicAmount = (qty: Micro, rate: Micro): Micro => roundTo(mul(qty, rate), 2);

/** Allocate an amount in whole paisa, preserving its exact total; ties award the remainder to earlier lines. */
export function allocateByWeights(amount: Micro, weights: Micro[]): Micro[] {
  if (weights.length === 0) throw new PurchaseCalculationError("There are no lines to distribute this term over.");
  if (amount < ZERO) throw new PurchaseCalculationError("The amount to distribute cannot be negative.");
  if (weights.some((weight) => weight < ZERO)) throw new PurchaseCalculationError("Distribution weights cannot be negative.");
  const total = sum(weights);
  if (total === ZERO) throw new PurchaseCalculationError("Cannot distribute a term over lines whose quantity or value is all zero.");
  const paisa = 10_000n;
  const units = roundTo(amount, 2) / paisa;
  const products = weights.map((weight) => units * weight);
  const shares = products.map((product) => product / total);
  const remainders = products.map((product) => product % total);
  let left = units - sum(shares);
  const order = weights.map((_, index) => index).sort((a, b) => remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : a - b);
  for (let i = 0; left > ZERO; i++, left--) shares[order[i]] += 1n;
  return shares.map((share) => share * paisa);
}

export type EngineLine = { key: number; basicAmount: Micro };
export type EngineTerm = {
  key: number;
  termId: number;
  sequence: number;
  nature: "ADDITIVE" | "DEDUCTIVE";
  calcBase: "ITEM_VALUE" | "RUNNING_TOTAL" | "SINGLE_TERM";
  baseTermId?: number | null;
  calcType: "PERCENT" | "AMOUNT";
  rate?: Micro | null;
  inputAmount?: Micro | null;
  isOverridden: boolean;
  overrideAmount?: Micro | null;
  lineKey?: number | null;
  /** A Round Off term: it works out its own amount and sign so the document total comes to a whole rupee (see priceTerms). */
  rounded?: boolean;
};
/** `nature` is the term's own, except for a rounding term where it follows the result (ADDITIVE rounds up, DEDUCTIVE rounds down). */
export type EngineResult = { key: number; baseAmount: Micro; calculatedAmount: Micro; finalAmount: Micro; signed: Micro; nature: "ADDITIVE" | "DEDUCTIVE" };
export type EngineOutput = { results: Map<number, EngineResult>; itemTotal: Micro; termNet: Micro; total: Micro };

/** Price all terms in stable sequence order. This is the single implementation used for previews and persisted bills. */
export function priceTerms(lines: EngineLine[], terms: EngineTerm[]): EngineOutput {
  const lineBy = new Map(lines.map((line) => [line.key, line]));
  const itemTotal = lines.reduce((a, line) => a + line.basicAmount, ZERO);
  const order = terms.map((term, i) => ({ term, i })).sort((a, b) => a.term.sequence - b.term.sequence || a.i - b.i).map((item) => item.term);
  const results = new Map<number, EngineResult>();
  let docRunning = itemTotal;
  const lineRunning = new Map(lines.map((line) => [line.key, line.basicAmount]));
  const done: EngineTerm[] = [];

  for (let idx = 0; idx < order.length; idx++) {
    const term = order[idx];
    const inLine = term.lineKey !== null && term.lineKey !== undefined;
    if (inLine && !lineBy.has(term.lineKey as number)) throw new PurchaseCalculationError(`Term ${term.termId} points at a line that is not on this document.`);

    let base: Micro;
    if (term.rounded) {
      base = docRunning; // a rounding term always works on the running total, whatever its master says
    } else if (term.calcBase === "ITEM_VALUE") {
      base = inLine ? lineBy.get(term.lineKey as number)!.basicAmount : itemTotal;
    } else if (term.calcBase === "RUNNING_TOTAL") {
      base = inLine ? lineRunning.get(term.lineKey as number)! : docRunning;
    } else {
      if (term.baseTermId === null || term.baseTermId === undefined) throw new PurchaseCalculationError(`Term ${term.termId} is based on a single term but names none.`);
      if (order.slice(idx + 1).some((candidate) => candidate.termId === term.baseTermId)) {
        throw new PurchaseCalculationError(`Term ${term.termId} is based on term ${term.baseTermId}, which comes after it. A base term must have an earlier sequence.`);
      }
      base = done
        .filter((candidate) => candidate.termId === term.baseTermId && (inLine ? candidate.lineKey === term.lineKey : true))
        .reduce((a, candidate) => a + results.get(candidate.key)!.finalAmount, ZERO);
    }

    let calculated: Micro;
    let nature = term.nature;
    if (term.rounded) {
      // Round Off: works on the document total at its own place in the sequence, to the nearest whole rupee (half a rupee rounds up).
      // It must be the last term, so nothing is added after the rounding, and there can only be one. The nature follows the result.
      if (inLine) throw new PurchaseCalculationError(`Term ${term.termId} is a rounding term; it works on the whole document, not on one line.`);
      if (idx !== order.length - 1) throw new PurchaseCalculationError(`Term ${term.termId} is a rounding term and must be the last term (highest sequence); only one is allowed.`);
      const diff = roundTo(base, 0) - base; // base is the running total here
      calculated = diff < ZERO ? -diff : diff;
      nature = diff < ZERO ? "DEDUCTIVE" : "ADDITIVE";
    } else if (term.calcType === "PERCENT") {
      if (term.rate === null || term.rate === undefined) throw new PurchaseCalculationError(`Term ${term.termId} is a percentage but has no rate.`);
      calculated = percentOf(base, term.rate);
    } else {
      if (term.inputAmount === null || term.inputAmount === undefined) throw new PurchaseCalculationError(`Term ${term.termId} is an amount but has none.`);
      calculated = roundTo(term.inputAmount, 2);
    }
    if (calculated < ZERO) throw new PurchaseCalculationError(`Term ${term.termId} calculates to a negative amount. Amounts are entered positive; the term's nature decides the sign.`);

    let finalAmount = calculated;
    if (term.isOverridden) {
      if (term.overrideAmount === null || term.overrideAmount === undefined) throw new PurchaseCalculationError(`Term ${term.termId} is overridden but has no amount.`);
      finalAmount = roundTo(term.overrideAmount, 2);
      if (finalAmount < ZERO) throw new PurchaseCalculationError(`Term ${term.termId} override cannot be negative.`);
    }

    const signed = nature === "ADDITIVE" ? finalAmount : -finalAmount;
    results.set(term.key, { key: term.key, baseAmount: base, calculatedAmount: calculated, finalAmount, signed, nature });
    docRunning += signed;
    if (inLine) lineRunning.set(term.lineKey as number, lineRunning.get(term.lineKey as number)! + signed);
    done.push(term);
  }

  const termNet = [...results.values()].reduce((a, result) => a + result.signed, ZERO);
  return { results, itemTotal, termNet, total: itemTotal + termNet };
}
