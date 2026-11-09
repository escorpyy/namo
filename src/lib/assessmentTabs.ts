import { toMicro } from "../../shared/purchase-calculation";
import type { ReadinessCheck } from "./assessmentInsights";

// Pure helpers behind the tabs of the Cost Assessment screen (Product-wise, Full Matrix, Ledger Check). Like assessmentInsights they only read
// what the live preview (or the saved document) already holds, so they can never disagree with save / apply. All money here is whole paisa
// ("cents"), so sums and comparisons are exact.

/** Colours the owner asked for: additions light green with dark green text, deductions pink with red text. */
export const ADD_CELL = "bg-green-100 text-green-800";
export const DEDUCT_CELL = "bg-pink-100 text-red-700";

export const cents = (v: unknown): number => {
  try { return Math.round(Number(toMicro(String(v ?? "0"))) / 10_000); } catch { return 0; }
};
/** Paisa as a plain decimal string ("-1250.05"), exact, ready for the screen's money formatter. */
export const centsText = (c: number): string => {
  const abs = Math.abs(Math.round(c));
  return `${c < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};
const sign = (nature: string) => (nature === "DEDUCTIVE" ? -1 : 1);

export type Nature = "ADDITIVE" | "DEDUCTIVE";

/** One charge as the tabs see it: the master's identity plus what the user chose and what the engine calculated. */
export interface TermView {
  formKey: string;
  termId: string;
  code: string;
  name: string;
  nature: Nature;
  /** Goes into stock value (and so into landed cost). False: posted to the ledgers only. */
  capitalizable: boolean;
  basis: "VALUE" | "QUANTITY";
  mode: "AUTO" | "MANUAL";
  /** The charge's final amount, positive, in paisa. */
  amount: number;
  /** MANUAL charges only: the product amounts as typed (bill line id -> text), and how far they are from the charge in paisa. */
  manual?: Record<string, string>;
  gap?: number;
}

export interface PreviewLineLike {
  id?: number; key?: number; lineNumber: number; productCode?: string; description?: string; quantity?: string;
  goodsValue: string; capitalizedSources?: string; existingPurchaseTermCosts?: string; capitalizedAssessments: string; landedValue: string; landedRate: string;
}
export const lineId = (l: PreviewLineLike): number => Number(l.id ?? l.key ?? l.lineNumber);
export const lineLabel = (l: PreviewLineLike): string => String(l.productCode || l.description || `Product line ${l.lineNumber}`);

/** termId -> bill line id -> signed paisa that charge adds to that product. Only charges that affect stock value appear. */
export type LineAlloc = Map<string, Map<number, number>>;

export function allocationsByTerm(
  preview: { termResults?: any[]; termAllocations?: any[] } | null | undefined,
  saved?: { termId: number | string; purchaseBillLineId: number; allocatedAmount: string }[],
): LineAlloc {
  const out: LineAlloc = new Map();
  const keyToTerm = new Map<number, string>();
  for (const r of preview?.termResults ?? []) if (r?.key !== undefined && r?.key !== null) keyToTerm.set(Number(r.key), String(r.termId));
  for (const a of preview?.termAllocations ?? []) {
    const termId = keyToTerm.get(Number(a.termKey));
    if (!termId) continue;
    out.set(termId, new Map((a.lines ?? []).map((l: any) => [Number(l.lineId), cents(l.amount)] as [number, number])));
  }
  // An applied assessment has no live calculation, only its frozen allocation rows (already signed).
  if (!out.size && saved?.length) {
    for (const a of saved) {
      const perLine = out.get(String(a.termId)) ?? new Map<number, number>();
      perLine.set(Number(a.purchaseBillLineId), (perLine.get(Number(a.purchaseBillLineId)) ?? 0) + cents(a.allocatedAmount));
      out.set(String(a.termId), perLine);
    }
  }
  return out;
}

/** The typed-amount map for turning a charge to MANUAL: every product keeps what automatic gave it (as a positive amount, the way manual amounts are entered). */
export function manualSeed(termId: string, alloc: LineAlloc, lineIds: number[]): Record<string, string> {
  const perLine = alloc.get(termId);
  return Object.fromEntries(lineIds.map((id) => [String(id), centsText(Math.abs(perLine?.get(id) ?? 0))]));
}

/** What the product amounts of a charge add up to, as a positive paisa figure. */
export const allocatedTotal = (alloc: LineAlloc, termId: string): number => {
  let total = 0;
  for (const v of alloc.get(termId)?.values() ?? []) total += Math.abs(v);
  return total;
};

/** Charge amount minus the product amounts typed so far (a MANUAL charge); zero means it ties. */
export function manualGapCents(target: number, manual: Record<string, string>): number {
  let typed = 0;
  for (const v of Object.values(manual)) typed += cents(v === "" ? "0" : v);
  return target - typed;
}

// ---- Full matrix ----
export interface MatrixRow {
  id: number; lineNumber: number; label: string; qty: string; goods: number;
  /** termId -> signed paisa, stock-affecting charges only */
  cells: Map<string, number>;
  /** invoiced services + earlier bill costs: part of landed value, not of any charge in this assessment */
  linked: number; landed: number; rate: string;
}
export interface Matrix { stockTerms: TermView[]; otherTerms: TermView[]; rows: MatrixRow[]; totals: { goods: number; cells: Map<string, number>; linked: number; landed: number }; hasLinked: boolean }

export function buildMatrix(lines: PreviewLineLike[], terms: TermView[], alloc: LineAlloc): Matrix {
  const stockTerms = terms.filter((t) => t.capitalizable);
  const otherTerms = terms.filter((t) => !t.capitalizable);
  const totals = { goods: 0, cells: new Map<string, number>(stockTerms.map((t) => [t.termId, 0])), linked: 0, landed: 0 };
  const rows: MatrixRow[] = lines.map((l) => {
    const id = lineId(l);
    const cells = new Map<string, number>();
    for (const t of stockTerms) {
      const v = alloc.get(t.termId)?.get(id) ?? 0;
      cells.set(t.termId, v);
      totals.cells.set(t.termId, (totals.cells.get(t.termId) ?? 0) + v);
    }
    const goods = cents(l.goodsValue), landed = cents(l.landedValue);
    const linked = cents(l.capitalizedSources) + cents(l.existingPurchaseTermCosts);
    totals.goods += goods; totals.linked += linked; totals.landed += landed;
    return { id, lineNumber: l.lineNumber, label: lineLabel(l), qty: String(l.quantity ?? ""), goods, cells, linked, landed, rate: String(l.landedRate ?? "") };
  });
  return { stockTerms, otherTerms, rows, totals, hasLinked: totals.linked !== 0 };
}

// ---- Ledger check ----
export interface LedgerInfo { id: number; code: string; name: string; requiresSubLedger: boolean }
export interface LedgerCheckTerm extends TermView {
  ownLedgerId: number | null; againstLedgerId: number | null; againstSubLedgerId: number | null;
}
export interface LedgerDetailLine { termCode: string; termName: string; counter: string; dr: number; cr: number }
export interface LedgerRow { ledgerId: number; label: string; dr: number; cr: number; lines: LedgerDetailLine[] }
export interface LedgerCheckResult {
  rows: LedgerRow[]; dr: number; cr: number;
  /** Charges that are posted but not part of landed cost, in paisa (information, not a pass/fail). */
  notInStock: number;
  checks: ReadinessCheck[];
}

// Mirrors what Apply posts: for every charge with an amount, Dr its own ledger / Cr its against ledger (swapped for a deductive charge).
export function ledgerCheck(
  terms: LedgerCheckTerm[],
  ledgers: LedgerInfo[],
  alloc: LineAlloc,
  totals: { goods: number; services: number; earlier: number; assessed: number; landed: number; lineLanded: number; lineAssessed: number } | null,
): LedgerCheckResult {
  const byId = new Map(ledgers.map((l) => [l.id, l]));
  const name = (id: number | null) => { const l = id == null ? null : byId.get(id); return l ? `${l.code} — ${l.name}` : "—"; };
  const rows = new Map<number, LedgerRow>();
  const touch = (id: number) => {
    let r = rows.get(id);
    if (!r) { r = { ledgerId: id, label: name(id), dr: 0, cr: 0, lines: [] }; rows.set(id, r); }
    return r;
  };
  const missingLedger: string[] = [];
  const missingSub: string[] = [];
  const unsplit: string[] = [];
  let notInStock = 0;
  for (const t of terms) {
    if (t.amount === 0) continue;
    if (!t.ownLedgerId || !t.againstLedgerId) { missingLedger.push(t.code); continue; }
    const against = byId.get(t.againstLedgerId);
    if (against?.requiresSubLedger && !t.againstSubLedgerId) missingSub.push(t.code);
    const ownSide = t.nature === "ADDITIVE" ? "dr" : "cr";
    const own = touch(t.ownLedgerId), other = touch(t.againstLedgerId);
    if (ownSide === "dr") { own.dr += t.amount; other.cr += t.amount; own.lines.push({ termCode: t.code, termName: t.name, counter: name(t.againstLedgerId), dr: t.amount, cr: 0 }); other.lines.push({ termCode: t.code, termName: t.name, counter: name(t.ownLedgerId), dr: 0, cr: t.amount }); }
    else { own.cr += t.amount; other.dr += t.amount; own.lines.push({ termCode: t.code, termName: t.name, counter: name(t.againstLedgerId), dr: 0, cr: t.amount }); other.lines.push({ termCode: t.code, termName: t.name, counter: name(t.ownLedgerId), dr: t.amount, cr: 0 }); }
    if (!t.capitalizable) notInStock += sign(t.nature) * t.amount;
    else if (allocatedTotal(alloc, t.termId) !== t.amount) unsplit.push(t.code);
  }
  const list = [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const sumDr = list.reduce((a, r) => a + r.dr, 0), sumCr = list.reduce((a, r) => a + r.cr, 0);
  const landedOk = !totals || (
    totals.lineLanded === totals.landed
    && totals.goods + totals.services + totals.earlier + totals.assessed === totals.landed
    && totals.lineAssessed === totals.assessed
  );
  const checks: ReadinessCheck[] = [
    { id: "ledger-balance", label: "Voucher debits equal credits", ok: sumDr === sumCr, detail: sumDr === sumCr ? undefined : `Dr ${centsText(sumDr)} / Cr ${centsText(sumCr)}`, focus: "tab:ledger" },
    { id: "ledger-set", label: "Every charge has both ledgers", ok: missingLedger.length === 0 && missingSub.length === 0,
      detail: [missingLedger.length ? `Ledger missing: ${missingLedger.join(", ")}` : "", missingSub.length ? `Sub-ledger needed: ${missingSub.join(", ")}` : ""].filter(Boolean).join(" · ") || undefined, focus: "tab:charges" },
    { id: "ledger-split", label: "Product amounts add up to each stock charge", ok: unsplit.length === 0, detail: unsplit.length ? unsplit.join(", ") : undefined, focus: "tab:products" },
    { id: "ledger-landed", label: "Landed value ties to its parts", ok: landedOk, focus: "tab:matrix" },
  ];
  return { rows: list, dr: sumDr, cr: sumCr, notInStock, checks };
}
