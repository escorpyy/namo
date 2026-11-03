import { HttpError } from "../../routes/_util";
import { allocateByWeights, type Micro, ZERO, div } from "../../../shared/purchase-calculation";

// Landed-cost arithmetic (pure). A header term flagged distributeToLines is split by quantity/value using the
// same whole-paisa largest-remainder allocator as the import-cost preview.
export function allocate(amount: Micro, weights: Micro[]): Micro[] {
  try {
    return allocateByWeights(amount, weights);
  } catch (error) {
    if (error instanceof Error) throw new HttpError(400, error.message);
    throw error;
  }
}

export type LandedLine = { basicAmount: Micro; qty: Micro; allocated: Micro /* signed net of allocations to this line */ };

// landedAmount = basic + allocated ; landedRate = landedAmount / qty (6 decimals; 0 when qty is 0).
export function landed(l: LandedLine): { allocatedTermAmount: Micro; landedAmount: Micro; landedRate: Micro } {
  const landedAmount = l.basicAmount + l.allocated;
  if (landedAmount < ZERO) throw new HttpError(400, "A deductive term takes more off a line than the line is worth (landed amount would be negative).");
  return { allocatedTermAmount: l.allocated, landedAmount, landedRate: l.qty === ZERO ? ZERO : div(landedAmount, l.qty) };
}
