import { groupIN } from "../components/purchase/Bits";
import { adToBs, bsToAd } from "./nepaliDate";
import type { LedgerReportRow, LedgerReportSummary } from "../api";

// ---- money (the server sends numerics as text; all sums here are done in whole paisa, never in floating point) ------------------

export const money = (v: string) => groupIN(v || "0");

/** "1234.567" -> 123457n (paisa, rounded half up). Anything that is not a plain decimal counts as zero. */
export function minor(v: string): bigint {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(v || "0");
  if (!m) return 0n;
  const frac = (m[3] ?? "") + "00";
  let n = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (frac.charCodeAt(2) >= 53) n += 1n;
  return m[1] ? -n : n;
}

/** Paisa -> "1,23,456.00" (Indian grouping), sign kept. */
export function fmtMinor(v: bigint): string {
  const a = v < 0n ? -v : v;
  const digits = (a / 100n).toString();
  const tail = String(a % 100n).padStart(2, "0");
  const grouped = digits.length > 3 ? `${digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${digits.slice(-3)}` : digits;
  return `${v < 0n ? "-" : ""}${grouped}.${tail}`;
}

/** A ledger amount as text: two decimals, Indian grouping ("250.000000" from the database becomes "250.00"). */
export const amount = (v: string) => fmtMinor(minor(v));

/** A signed balance as one figure on one side: "1,000.00 Dr" / "250.00 Cr" (debit is positive). */
export const balanceOf = (v: bigint) => `${fmtMinor(v < 0n ? -v : v)} ${v < 0n ? "Cr" : "Dr"}`;
export const balanceText = (v: string) => balanceOf(minor(v));

// ---- the one "module + number" label of a line ("Sales Bill ## 001") ----------------------------------------------------------

const MODULE_NAMES: Record<string, string> = {
  "Sales invoice": "Sales Bill", "Purchase bill": "Purchase Bill", "Import cost assessment": "Import Cost Assessment",
  "Journal voucher": "Journal", "Cash / bank voucher": "Cash/Bank",
};
/** Module name and voucher number in one label, e.g. "Sales Bill ## 001". */
export const voucherRef = (r: Pick<LedgerReportRow, "sourceLabel" | "sourceNumber" | "voucherNumber">) =>
  `${MODULE_NAMES[r.sourceLabel] ?? r.sourceLabel} ## ${r.sourceNumber || r.voucherNumber}`;

// ---- periods, shown by month name --------------------------------------------------------------------------------------------

export type Month = { from: string; to: string; label: string };

export const BS_MONTHS = ["Baisakh", "Jestha", "Ashadh", "Shrawan", "Bhadra", "Ashwin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
export const AD_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pad = (n: number) => String(n).padStart(2, "0");
export const addDay = (s: string, days: number) => {
  const d = new Date(`${s}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** Today as YYYY-MM-DD in the local time zone (toISOString would give the UTC date, a day behind in Nepal until 05:45). */
export const todayLocal = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/**
 * The months of a fiscal year, each named ("Shrawan 2082" in BS, "July 2025" in AD) and clipped to the fiscal year.
 * BS months follow the Nepali calendar; if a date cannot be converted the AD calendar months are used instead.
 */
export function monthsOf(fyStart: string, fyEnd: string, calendar: "BS" | "AD"): Month[] {
  const bsStart = calendar === "BS" ? adToBs(fyStart) : null;
  const bsEnd = calendar === "BS" ? adToBs(fyEnd) : null;
  const months: Month[] = [];
  if (!bsStart || !bsEnd) {
    if (!fyStart || !fyEnd) return months;
    let y = Number(fyStart.slice(0, 4)), m = Number(fyStart.slice(5, 7)) - 1;
    for (let guard = 0; guard < 40; guard++) {
      const first = `${y}-${pad(m + 1)}-01`;
      if (first > fyEnd) break;
      const last = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
      months.push({ from: first < fyStart ? fyStart : first, to: last > fyEnd ? fyEnd : last, label: `${AD_MONTHS[m]} ${y}` });
      if (m === 11) { y += 1; m = 0; } else m += 1;
    }
    return months;
  }
  const [sy, sm] = bsStart.split("-").map(Number), [ey, em] = bsEnd.split("-").map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const nextY = m === 12 ? y + 1 : y, nextM = m === 12 ? 1 : m + 1;
    const rawFrom = bsToAd(`${y}-${pad(m)}-01`), next = bsToAd(`${nextY}-${pad(nextM)}-01`);
    if (rawFrom && next) {
      const rawTo = addDay(next, -1);
      const from = rawFrom < fyStart ? fyStart : rawFrom, to = rawTo > fyEnd ? fyEnd : rawTo;
      if (from <= to) months.push({ from, to, label: `${BS_MONTHS[m - 1]} ${y}` });
    }
    y = nextY; m = nextM;
  }
  return months;
}

/** The month that contains `today`; before the year starts the first month, after it the last. */
export function pickInitialMonth(months: Month[], today: string): Month | undefined {
  if (!months.length) return undefined;
  return months.find((x) => x.from <= today && x.to >= today) ?? (today < months[0].from ? months[0] : months[months.length - 1]);
}

// ---- one block per ledger: opening row, its lines, closing (or carried-forward) row -------------------------------------------

export type LedgerBlock = {
  key: string;
  generalLedgerId: number;
  code: string;
  name: string;
  rows: LedgerReportRow[];
  /** "Opening balance", or "Brought forward" when this page continues a ledger from the page before. */
  start: { label: string; balance: bigint } | null;
  /** "closing": the ledger's period totals and closing balance. "carry": more lines follow on the next page. */
  end: { kind: "closing" | "carry"; label: string; debit: bigint; credit: bigint; balance: bigint } | null;
};

/**
 * Turns one page of report rows into blocks per ledger.
 * - A ledger with no lines in the period still gets a block when it was asked for by id, so its balances stay visible.
 * - The last ledger on a page that is not the last page is "carried forward" with the running balance of its last line.
 * - Period totals and closing come from the server summary: posted entries of that ledger for the whole period.
 */
export function buildBlocks(o: { rows: LedgerReportRow[]; summary: LedgerReportSummary[]; page: number; pageCount: number; ledgerIds: number[] }): LedgerBlock[] {
  const byId = new Map(o.summary.map((s) => [s.generalLedgerId, s]));
  const groups: { id: number; code: string; name: string; rows: LedgerReportRow[] }[] = [];
  for (const r of o.rows) {
    const last = groups[groups.length - 1];
    if (last && last.id === r.generalLedgerId) last.rows.push(r);
    else groups.push({ id: r.generalLedgerId, code: r.ledgerCode, name: r.ledgerName, rows: [r] });
  }
  if (!groups.length) for (const s of o.summary) if (o.ledgerIds.includes(s.generalLedgerId)) groups.push({ id: s.generalLedgerId, code: s.code, name: s.name, rows: [] });

  return groups.map((g, i) => {
    const s = byId.get(g.id);
    const first = g.rows[0], last = g.rows[g.rows.length - 1];
    // Running balances count posted lines only, so the balance before the first line is its running balance minus its own effect.
    const before = first ? minor(first.running) - (first.posted ? minor(first.debit) - minor(first.credit) : 0n) : 0n;
    const opening = s ? minor(s.opening) : null;
    let start: LedgerBlock["start"] = null;
    if (o.page > 1 && i === 0 && first && (opening === null || before !== opening)) start = { label: "Brought forward", balance: before };
    else if (opening !== null) start = { label: "Opening balance", balance: opening };
    else if (first) start = { label: "Opening balance", balance: before };

    const complete = i < groups.length - 1 || o.page >= o.pageCount;
    let end: LedgerBlock["end"] = null;
    if (complete) { if (s) end = { kind: "closing", label: "Closing balance", debit: minor(s.debit), credit: minor(s.credit), balance: minor(s.closing) }; }
    else if (last) end = { kind: "carry", label: "Carried forward", debit: 0n, credit: 0n, balance: minor(last.running) };
    return { key: `${g.id}-${o.page}-${i}`, generalLedgerId: g.id, code: g.code, name: g.name, rows: g.rows, start, end };
  });
}

// ---- CSV ------------------------------------------------------------------------------------------------------------------------

/** Quotes a CSV cell. Text that a spreadsheet would run as a formula (= + - @) is prefixed so it stays text. */
export function csvCell(v: string | number | null | undefined, kind: "text" | "number" = "text"): string {
  let s = String(v ?? "");
  if (kind === "text" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}
