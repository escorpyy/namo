import { HttpError } from "../../routes/_util";
import { type Micro, ZERO, div, roundTo } from "./money";

// Landed-cost arithmetic (pure). A header term flagged "distribute to lines" (freight, import duty, ...) is split over
// the item lines by QUANTITY or VALUE. The split is in whole paisa and always adds back to EXACTLY the term amount:
// each line gets its floor share, and the leftover paisa go to the lines with the biggest remainders (ties: first line).

const PAISA: Micro = 10_000n;

export function allocate(amount: Micro, weights: Micro[]): Micro[] {
  if (weights.length === 0) throw new HttpError(400, "There are no lines to distribute this term over.");
  if (weights.some((w) => w < ZERO)) throw new HttpError(400, "Distribution weights cannot be negative.");
  const total = weights.reduce((a, w) => a + w, ZERO);
  if (total === ZERO) throw new HttpError(400, "Cannot distribute a term over lines whose quantity or value is all zero.");
  const units = roundTo(amount, 2) / PAISA; // whole paisa
  const prod = weights.map((w) => units * w);
  const floor = prod.map((p) => p / total);
  const rem = prod.map((p) => p % total);
  let left = units - floor.reduce((a, f) => a + f, ZERO);
  const idx = weights.map((_, i) => i).sort((a, b) => (rem[b] > rem[a] ? 1 : rem[b] < rem[a] ? -1 : a - b));
  const out = floor.slice();
  for (let k = 0; left > 0n; k = (k + 1) % idx.length, left--) out[idx[k]] += 1n;
  return out.map((u) => u * PAISA);
}

export type LandedLine = { basicAmount: Micro; qty: Micro; allocated: Micro /* signed net of allocations to this line */ };

// landedAmount = basic + allocated ; landedRate = landedAmount / qty (6 decimals; 0 when qty is 0).
export function landed(l: LandedLine): { allocatedTermAmount: Micro; landedAmount: Micro; landedRate: Micro } {
  const landedAmount = l.basicAmount + l.allocated;
  if (landedAmount < ZERO) throw new HttpError(400, "A deductive term takes more off a line than the line is worth (landed amount would be negative).");
  return { allocatedTermAmount: l.allocated, landedAmount, landedRate: l.qty === ZERO ? ZERO : div(landedAmount, l.qty) };
}
