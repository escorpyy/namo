import { HttpError } from "../../routes/_util";
import {
  priceTerms as sharedPriceTerms,
  PurchaseCalculationError,
  type EngineLine,
  type EngineTerm,
  type EngineOutput,
} from "../../../shared/purchase-calculation";

export type { EngineLine, EngineTerm, EngineResult, EngineOutput } from "../../../shared/purchase-calculation";

/** Server adapter: keep calculation errors as client-facing HTTP 400s. */
export function priceTerms(lines: EngineLine[], terms: EngineTerm[]): EngineOutput {
  try {
    return sharedPriceTerms(lines, terms);
  } catch (error) {
    if (error instanceof PurchaseCalculationError) throw new HttpError(400, error.message);
    throw error;
  }
}
