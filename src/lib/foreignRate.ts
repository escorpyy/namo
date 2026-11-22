import { parseDec } from "../../shared/decimal";

/** True for a currency code that is not NPR (blank or NPR means the document is entered in rupees). */
export const isForeign = (code: string | null | undefined) => { const c = (code ?? "").trim().toUpperCase(); return c !== "" && c !== "NPR"; };

/** foreign rate x NRB rate, 6 decimals: what the server stores as the NPR rate of a line. "" when either is not a usable number. */
export const nprRate = (rate: string, xr: string): string => {
  const a = parseDec(rate), b = parseDec(xr);
  if (!a || !b || a.scale > 6 || b.scale > 6) return "";
  const m = (x: { n: bigint; scale: number }) => x.n * 10n ** BigInt(6 - x.scale);
  const q = m(a) * m(b), r = q / 1_000_000n + ((q % 1_000_000n) * 2n >= 1_000_000n ? 1n : 0n);
  return `${r / 1_000_000n}.${(r % 1_000_000n).toString().padStart(6, "0")}`;
};
