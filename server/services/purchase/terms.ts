import { HttpError } from "../../routes/_util";
import { type Micro, ZERO, percentOf, roundTo } from "./money";

// The billing-terms calculation engine (pure: no database, no clock). It prices the terms of ONE document
// (purchase order or purchase bill) in `sequence` order:
//
//   calcBase ITEM_VALUE     gross value of the item line(s) in the term's scope
//   calcBase RUNNING_TOTAL  that value plus the signed result of every EARLIER term in scope
//   calcBase SINGLE_TERM    the result of one specific earlier term (identified by its master term id)
//
// A header-level term works on the whole document; a line-level (productwise) term works on its own line.
// Header-level scope for RUNNING_TOTAL / SINGLE_TERM includes earlier line-level terms too ("all earlier terms").
// PERCENT terms take rate% of the base and are rounded to paisa; AMOUNT terms use the typed amount.
// An overridden term keeps the amount the user typed as its final amount (calculation is still reported).

export type EngineLine = { key: number; basicAmount: Micro };

export type EngineTerm = {
  key: number; // caller's id for the term (its row id, or its array index)
  termId: number; // the term MASTER id
  sequence: number;
  nature: "ADDITIVE" | "DEDUCTIVE";
  calcBase: "ITEM_VALUE" | "RUNNING_TOTAL" | "SINGLE_TERM";
  baseTermId?: number | null;
  calcType: "PERCENT" | "AMOUNT";
  rate?: Micro | null;
  inputAmount?: Micro | null;
  isOverridden: boolean;
  overrideAmount?: Micro | null; // the final amount when isOverridden
  lineKey?: number | null; // set = line-level term
};

export type EngineResult = { key: number; baseAmount: Micro; calculatedAmount: Micro; finalAmount: Micro; signed: Micro };
export type EngineOutput = { results: Map<number, EngineResult>; itemTotal: Micro; termNet: Micro; total: Micro };

export function priceTerms(lines: EngineLine[], terms: EngineTerm[]): EngineOutput {
  const lineBy = new Map(lines.map((l) => [l.key, l]));
  const itemTotal = lines.reduce((a, l) => a + l.basicAmount, ZERO);
  // Stable by sequence, then by the order the caller gave them.
  const order = terms.map((t, i) => ({ t, i })).sort((a, b) => a.t.sequence - b.t.sequence || a.i - b.i).map((x) => x.t);

  const results = new Map<number, EngineResult>();
  let docRunning = itemTotal;
  const lineRunning = new Map(lines.map((l) => [l.key, l.basicAmount]));
  const done: EngineTerm[] = [];

  for (let idx = 0; idx < order.length; idx++) {
    const t = order[idx];
    const inLine = t.lineKey !== null && t.lineKey !== undefined;
    if (inLine && !lineBy.has(t.lineKey as number)) throw new HttpError(400, `Term ${t.termId} points at a line that is not on this document.`);

    let base: Micro;
    if (t.calcBase === "ITEM_VALUE") {
      base = inLine ? lineBy.get(t.lineKey as number)!.basicAmount : itemTotal;
    } else if (t.calcBase === "RUNNING_TOTAL") {
      base = inLine ? lineRunning.get(t.lineKey as number)! : docRunning;
    } else {
      if (t.baseTermId === null || t.baseTermId === undefined) throw new HttpError(400, `Term ${t.termId} is based on a single term but names none.`);
      if (order.slice(idx + 1).some((x) => x.termId === t.baseTermId)) {
        throw new HttpError(400, `Term ${t.termId} is based on term ${t.baseTermId}, which comes after it. A base term must have an earlier sequence.`);
      }
      base = done
        .filter((d) => d.termId === t.baseTermId && (inLine ? d.lineKey === t.lineKey : true))
        .reduce((a, d) => a + results.get(d.key)!.finalAmount, ZERO);
    }

    let calculated: Micro;
    if (t.calcType === "PERCENT") {
      if (t.rate === null || t.rate === undefined) throw new HttpError(400, `Term ${t.termId} is a percentage but has no rate.`);
      calculated = percentOf(base, t.rate);
    } else {
      if (t.inputAmount === null || t.inputAmount === undefined) throw new HttpError(400, `Term ${t.termId} is an amount but has none.`);
      calculated = roundTo(t.inputAmount, 2);
    }
    if (calculated < ZERO) throw new HttpError(400, `Term ${t.termId} calculates to a negative amount. Amounts are entered positive; the term's nature decides the sign.`);

    let final = calculated;
    if (t.isOverridden) {
      if (t.overrideAmount === null || t.overrideAmount === undefined) throw new HttpError(400, `Term ${t.termId} is overridden but has no amount.`);
      final = roundTo(t.overrideAmount, 2);
      if (final < ZERO) throw new HttpError(400, `Term ${t.termId} override cannot be negative.`);
    }

    const signed = t.nature === "ADDITIVE" ? final : -final;
    results.set(t.key, { key: t.key, baseAmount: base, calculatedAmount: calculated, finalAmount: final, signed });
    docRunning += signed;
    if (inLine) lineRunning.set(t.lineKey as number, lineRunning.get(t.lineKey as number)! + signed);
    done.push(t);
  }

  const termNet = [...results.values()].reduce((a, r) => a + r.signed, ZERO);
  return { results, itemTotal, termNet, total: itemTotal + termNet };
}
