import { HttpError } from "../../routes/_util";
import {
  PurchaseCalculationError,
  div as sharedDiv,
  fmt,
  lineBasicAmount,
  mul,
  percentOf,
  roundTo,
  sum,
  toMicro as sharedToMicro,
  ZERO,
  ONE,
  type Micro,
} from "../../../shared/purchase-calculation";

export type { Micro } from "../../../shared/purchase-calculation";
export { fmt, lineBasicAmount, mul, percentOf, roundTo, sum, ZERO, ONE };

const withHttpError = <T>(run: () => T): T => {
  try {
    return run();
  } catch (error) {
    if (error instanceof PurchaseCalculationError) throw new HttpError(400, error.message);
    throw error;
  }
};

export const toMicro = (value: string | number | bigint | null | undefined): Micro => withHttpError(() => sharedToMicro(value));
export const div = (a: Micro, b: Micro): Micro => withHttpError(() => sharedDiv(a, b));
