import { HttpError } from "../../routes/_util";

// Exact fixed-point arithmetic for money, quantities and rates. Every number is a bigint "micro" unit
// (1 = 0.000001), the same scale as the database's numeric(18,6) columns, so nothing ever passes through a float.
//   amounts   -> rounded to 2 decimals (NPR paisa) with roundTo(x, 2)
//   rates     -> kept at 6 decimals
//   quantities-> kept at 6 decimals
// Rounding is always half away from zero.

export type Micro = bigint;
export const ONE: Micro = 1_000_000n;
export const ZERO: Micro = 0n;

export function toMicro(v: string | number | bigint | null | undefined): Micro {
  if (v === null || v === undefined || v === "") return ZERO;
  if (typeof v === "bigint") return v;
  const s = String(v).trim();
  const m = /^([+-])?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new HttpError(400, `"${s}" is not a valid number.`);
  const frac = m[3] ?? "";
  let n = BigInt(m[2]) * ONE + BigInt(frac.slice(0, 6).padEnd(6, "0"));
  if (frac.length > 6 && frac.charCodeAt(6) >= 53) n += 1n; // 7th digit >= 5 rounds up
  return m[1] === "-" ? -n : n;
}

// To the string a numeric(18,6) column wants, e.g. 1234500000n -> "1234.500000".
export function fmt(m: Micro, dp = 6): string {
  const neg = m < 0n;
  const a = neg ? -m : m;
  const r = roundTo(a, dp);
  const int = r / ONE;
  const frac = (r % ONE).toString().padStart(6, "0").slice(0, dp);
  return `${neg && r !== 0n ? "-" : ""}${int}${dp > 0 ? "." + frac : ""}`;
}

export function roundTo(m: Micro, dp: number): Micro {
  if (dp >= 6) return m;
  const unit = 10n ** BigInt(6 - dp);
  const a = m < 0n ? -m : m;
  const r = ((a + unit / 2n) / unit) * unit;
  return m < 0n ? -r : r;
}

export function mul(a: Micro, b: Micro): Micro {
  const p = a * b;
  const neg = p < 0n;
  const ap = neg ? -p : p;
  let q = ap / ONE;
  if ((ap % ONE) * 2n >= ONE) q += 1n;
  return neg ? -q : q;
}

export function div(a: Micro, b: Micro): Micro {
  if (b === 0n) throw new HttpError(400, "Division by zero.");
  const num = a * ONE;
  const neg = num < 0n !== b < 0n;
  const an = num < 0n ? -num : num;
  const ab = b < 0n ? -b : b;
  let q = an / ab;
  if ((an % ab) * 2n >= ab) q += 1n;
  return neg ? -q : q;
}

// base * (ratePercent / 100), rounded to whole paisa.
export const percentOf = (base: Micro, ratePercent: Micro): Micro => roundTo(div(mul(base, ratePercent), 100n * ONE), 2);

export const sum = (xs: Micro[]): Micro => xs.reduce((a, b) => a + b, ZERO);
