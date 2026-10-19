import * as mod from "nepali-date-converter";

// AD hi source of truth hai (DB me AD date). BS sirf typing/display ke liye.
// Library CJS hai: default export kabhi mod.default.default me aata hai
const ND: any = (mod as any).default?.default ?? (mod as any).default;
const pad = (n: number) => String(n).padStart(2, "0");

export const isValidAd = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
};

// Local date parts use karte hain (UTC nahi), taaki Nepal ke UTC+5:45 me din na khisak jaye
export function adToBs(ad: string): string | null {
  if (!isValidAd(ad)) return null;
  try {
    const [y, m, d] = ad.split("-").map(Number);
    const bs: string = new ND(new Date(y, m - 1, d)).format("YYYY-MM-DD");
    return bsToAd(bs) === ad ? bs : null; // library range (AD 1943-2034) ke bahar chupchap galat BS deti hai: round-trip se pakdo
  } catch {
    return null; // library ki range (BS 2000-2090) ke bahar
  }
}

export function bsToAd(bs: string): string | null {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bs);
  if (!mt) return null;
  try {
    const n = new ND(+mt[1], +mt[2] - 1, +mt[3]);
    if (n.format("YYYY-MM-DD") !== bs) return null; // library 2082-01-32 ko chupchap agle mahine me bhej deti hai: round-trip se pakdo
    const j: Date = n.toJsDate();
    return `${j.getFullYear()}-${pad(j.getMonth() + 1)}-${pad(j.getDate())}`;
  } catch {
    return null;
  }
}
