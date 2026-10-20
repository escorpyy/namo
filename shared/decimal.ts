// Decimal strings par exact (BigInt) hisaab: float ke rounding errors se bachne ke liye. Client aur server dono yahi use karte hain.
export function parseDec(s: string): { n: bigint; scale: number } | null {
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(String(s).trim());
  if (!m) return null;
  const f = m[2] ?? "";
  return { n: BigInt(m[1] + f), scale: f.length };
}

// a * b ko 2 decimals tak round (half up). Sirf non-negative.
export function mulRound2(a: string, b: string): string {
  const x = parseDec(a), y = parseDec(b);
  if (!x || !y) return "0.00";
  const prod = x.n * y.n, scale = x.scale + y.scale;
  let q: bigint;
  if (scale <= 2) q = prod * 10n ** BigInt(2 - scale);
  else {
    const div = 10n ** BigInt(scale - 2);
    q = prod / div;
    if ((prod % div) * 2n >= div) q += 1n;
  }
  return `${q / 100n}.${(q % 100n).toString().padStart(2, "0")}`;
}

// "1234.56" -> paise (bigint)
export const toCents = (s: string): bigint => {
  const x = parseDec(s);
  if (!x) return 0n;
  return x.scale <= 2 ? x.n * 10n ** BigInt(2 - x.scale) : x.n / 10n ** BigInt(x.scale - 2);
};
