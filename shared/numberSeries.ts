// ============================================================
// NUMBER SERIES: how the number of a document (order, challan, bill ...) is made.
//
// A company can have several series for one kind of document (cash CV-001 and bank BV-001, local LP-01 and import IP-01), each with its own
// prefix, suffix, padding, start, end and step, and each applicable to all users / branches or only chosen ones.
//   mode  AUTOMATIC  the system gives the number; the user cannot change it
//         SUGGESTED  the system proposes the number; the user may overtype it
//         MANUAL     the user always types the number (no counter)
// Prefix and suffix may hold {FY} (the fiscal year code, "/" turned into "-") and {BRANCH} (the branch code).
// A change to a series applies to FUTURE documents only; numbers already given are never rewritten.
// Pure functions only: the server allocates with them and the settings screen shows live examples.
// ============================================================

export type SeriesMode = "AUTOMATIC" | "SUGGESTED" | "MANUAL";
export type AssignAt = "DRAFT" | "POST";

export const DOCUMENT_TYPES = [
  { key: "PURCHASE_ORDER", label: "Purchase Order", module: "Purchase" },
  { key: "PURCHASE_CHALLAN", label: "Purchase Challan", module: "Purchase" },
  { key: "PURCHASE_BILL", label: "Purchase Bill", module: "Purchase" },
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number]["key"];
export const documentType = (key: string) => DOCUMENT_TYPES.find((d) => d.key === key);

export interface SeriesFormat {
  prefix: string; suffix: string; padding: number; startNumber: number; endNumber: number | null; increment: number;
}
export interface SeriesCtx { fiscalYear?: string | null; branch?: string | null }

export const MAX_NUMBER_LENGTH = 30; // the document number columns hold at most this many characters

const PART = /^[A-Za-z0-9\-/._{}]*$/;

/** every reason a series cannot be saved (empty = fine) */
export function seriesProblems(s: SeriesFormat & { name: string; mode: SeriesMode }): string[] {
  const p: string[] = [];
  if (!s.name.trim()) p.push("Give the series a name.");
  for (const [label, v] of [["Prefix", s.prefix], ["Suffix", s.suffix]] as const) {
    if (!PART.test(v)) p.push(`${label} may hold letters, digits and - / . _ only (and {FY} or {BRANCH}).`);
    const bad = v.replace(/\{(FY|BRANCH)\}/g, "").match(/[{}]/);
    if (bad) p.push(`${label} has a { or } that is not {FY} or {BRANCH}.`);
  }
  if (s.mode === "MANUAL") return p;
  if (!Number.isInteger(s.padding) || s.padding < 1 || s.padding > 10) p.push("Padding must be 1 to 10 digits.");
  if (!Number.isInteger(s.startNumber) || s.startNumber < 0) p.push("Start number must be 0 or more.");
  if (!Number.isInteger(s.increment) || s.increment < 1 || s.increment > 1000) p.push("Increase by must be 1 to 1000.");
  if (s.endNumber !== null && (!Number.isInteger(s.endNumber) || s.endNumber < s.startNumber)) p.push("End number cannot be before the start number.");
  if (!p.length) {
    const widest = formatNumber(s, s.endNumber ?? Number("9".repeat(s.padding)), { fiscalYear: "2082-083", branch: "BR01" }).length;
    if (widest > MAX_NUMBER_LENGTH) p.push(`Numbers would reach ${widest} characters; the limit is ${MAX_NUMBER_LENGTH}. Shorten the prefix, suffix or padding.`);
  }
  return p;
}

const fill = (v: string, ctx: SeriesCtx) =>
  v.replace(/\{FY\}/g, (ctx.fiscalYear ?? "").replace(/\//g, "-")).replace(/\{BRANCH\}/g, ctx.branch ?? "");

/** the document number for counter value n: prefix + zero-padded n + suffix (grows past its padding instead of failing) */
export function formatNumber(f: Pick<SeriesFormat, "prefix" | "suffix" | "padding">, n: number, ctx: SeriesCtx = {}): string {
  return fill(f.prefix, ctx) + String(n).padStart(f.padding, "0") + fill(f.suffix, ctx);
}

/** the counter value inside a number made by this series, or null when the number does not follow it */
export function parseNumber(f: Pick<SeriesFormat, "prefix" | "suffix" | "padding">, number: string, ctx: SeriesCtx = {}): number | null {
  const pre = fill(f.prefix, ctx), suf = fill(f.suffix, ctx);
  if (!number.startsWith(pre) || !number.endsWith(suf) || number.length < pre.length + suf.length + 1) return null;
  const mid = number.slice(pre.length, number.length - suf.length);
  return /^\d{1,15}$/.test(mid) ? Number(mid) : null;
}

/** the first numbers a series will make, for the settings screen */
export function exampleNumbers(f: SeriesFormat, ctx: SeriesCtx = { fiscalYear: "2082/083", branch: "KTM" }, count = 3): string[] {
  const out: string[] = [];
  for (let n = f.startNumber, i = 0; i < count; i++, n += f.increment) {
    if (f.endNumber !== null && n > f.endNumber) break;
    out.push(formatNumber(f, n, ctx));
  }
  return out;
}

/** the counter value after `last` (nothing given yet = the start number); null once the end number is passed */
export function stepNumber(f: Pick<SeriesFormat, "startNumber" | "endNumber" | "increment">, last: number | null): number | null {
  const n = last === null ? f.startNumber : last + f.increment;
  return f.endNumber !== null && n > f.endNumber ? null : n;
}

/** how many numbers are left before the end number (null = no end) */
export function numbersLeft(f: Pick<SeriesFormat, "endNumber" | "increment">, last: number): number | null {
  return f.endNumber === null ? null : Math.max(0, Math.floor((f.endNumber - last) / f.increment));
}

export interface SeriesRow extends SeriesFormat {
  id: number; documentType: string; name: string; mode: SeriesMode; assignAt: AssignAt;
  resetPerFy: boolean; perBranch: boolean; isDefault: boolean; isActive: boolean;
  allUsers: boolean; allBranches: boolean; userIds: number[]; branchIds: number[];
  example: string[]; used: number;
}
