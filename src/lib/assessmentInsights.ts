import { toMicro } from "../../shared/purchase-calculation";

// Pure helpers behind the Cost Assessment insight panel: what the charges do to the landed cost of a goods bill, which products they hit hardest,
// whether the assessment is ready to apply, and a CSV of the product allocation grid. Nothing here calls the server or the costing engine; it only
// reads the figures the live preview already returned, so it can never disagree with save / apply.

const num = (v: unknown): number => { try { return Number(toMicro(String(v ?? "0"))) / 1e6; } catch { return 0; } };
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PreviewLike {
  goodsValue?: string; invoicedCapitalizedCosts?: string; existingPurchaseTermCosts?: string; capitalizedAssessments?: string; totalLandedValue?: string;
  lines?: { key?: number; id?: number; lineNumber: number; productCode?: string; description?: string; quantity?: string; goodsValue: string; landedValue: string; landedRate: string }[];
}

export interface BuildUpSegment { key: "goods" | "services" | "earlier" | "assessed"; label: string; amount: number; share: number }
export interface BuildUp { total: number; goods: number; upliftPct: number | null; segments: BuildUpSegment[] }

// Landed value = goods + invoiced services + earlier bill costs + assessed charges (the costing engine's own formula), so the four segments add up to the total.
// `share` is each segment's part of the positive segments, for drawing the bar; a deductive segment keeps its negative amount and gets a zero share.
export function costBuildUp(p: PreviewLike | null | undefined): BuildUp | null {
  if (!p || p.totalLandedValue == null) return null;
  const goods = num(p.goodsValue);
  const segments: BuildUpSegment[] = [
    { key: "goods", label: "Goods", amount: goods, share: 0 },
    { key: "services", label: "Invoiced services", amount: num(p.invoicedCapitalizedCosts), share: 0 },
    { key: "earlier", label: "Earlier bill costs", amount: num(p.existingPurchaseTermCosts), share: 0 },
    { key: "assessed", label: "Assessed charges", amount: num(p.capitalizedAssessments), share: 0 },
  ];
  const positive = segments.reduce((a, s) => a + Math.max(s.amount, 0), 0);
  for (const s of segments) s.share = positive > 0 && s.amount > 0 ? s.amount / positive : 0;
  const total = num(p.totalLandedValue);
  return { total, goods, upliftPct: goods > 0 ? round2(((total - goods) / goods) * 100) : null, segments };
}

export interface ProductImpact { key: string; label: string; goods: number; landed: number; upliftPct: number | null; landedRate: string }

// Every product line with how much dearer it became, hardest hit first (lines with no goods value go last).
export function productImpact(lines: PreviewLike["lines"]): ProductImpact[] {
  return (lines ?? []).map((l) => {
    const goods = num(l.goodsValue), landed = num(l.landedValue);
    return {
      key: String(l.key ?? l.id ?? l.lineNumber), label: `${l.lineNumber}. ${l.productCode ?? l.description ?? `Product line ${l.lineNumber}`}`,
      goods, landed, upliftPct: goods > 0 ? round2(((landed - goods) / goods) * 100) : null, landedRate: String(l.landedRate ?? ""),
    };
  }).sort((a, b) => (b.upliftPct ?? -Infinity) - (a.upliftPct ?? -Infinity) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export interface ChargeMixRow { key: string; label: string; amount: number; share: number; inStock: boolean }

// Each charge with its share of the assessed total (by size, ignoring sign), and whether it goes into stock value or is expensed.
export function chargeMix(charges: { key: string; label: string; amount: number; inStock: boolean }[]): ChargeMixRow[] {
  const total = charges.reduce((a, c) => a + Math.abs(c.amount), 0);
  return charges.map((c) => ({ ...c, share: total > 0 ? Math.abs(c.amount) / total : 0 })).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export interface ReadinessCheck { id: string; label: string; ok: boolean; detail?: string; focus?: string }

// What still stands between a draft and "Apply". `focus` is the data-field to jump to when the user clicks the check.
export function readiness(i: {
  hasBill: boolean; hasDate: boolean; charges: { index: number; hasTerm: boolean; hasLedger: boolean; hasValue: boolean; manualGap?: number; label: string }[];
  previewOk: boolean; previewPending: boolean;
}): ReadinessCheck[] {
  const used = i.charges.filter((c) => c.hasTerm);
  const noLedger = used.filter((c) => !c.hasLedger);
  const noValue = used.filter((c) => !c.hasValue);
  const unbalanced = used.filter((c) => (c.manualGap ?? 0) !== 0);
  return [
    { id: "bill", label: "Goods bill chosen", ok: i.hasBill, focus: "importBillId" },
    { id: "date", label: "Assessment date set", ok: i.hasDate, focus: "assessmentDate" },
    { id: "charges", label: "At least one charge", ok: used.length > 0, focus: `terms.${i.charges[0]?.index ?? 0}.termId` },
    { id: "values", label: "Every charge has an amount", ok: used.length > 0 && noValue.length === 0, detail: noValue.length ? noValue.map((c) => c.label).join(", ") : undefined, focus: noValue[0] ? `terms.${noValue[0].index}.amount` : undefined },
    { id: "ledgers", label: "Every charge has an against ledger", ok: used.length > 0 && noLedger.length === 0, detail: noLedger.length ? noLedger.map((c) => c.label).join(", ") : undefined, focus: noLedger[0] ? `terms.${noLedger[0].index}.againstLedgerId` : undefined },
    { id: "splits", label: "Manual splits balance", ok: unbalanced.length === 0, detail: unbalanced.length ? unbalanced.map((c) => `${c.label} (gap ${round2(c.manualGap!).toFixed(2)})`).join(", ") : undefined },
    { id: "preview", label: "Costing preview is clean", ok: i.previewOk && !i.previewPending, detail: i.previewPending ? "updating…" : undefined },
  ];
}

// Assessments of the same goods bill that are still in force (draft or applied): a second one would capitalize the same bill twice.
export function openAssessmentsFor<T extends { id: number; importBillId?: number | null; state?: string }>(rows: T[], importBillId: number | null, exceptId?: number | null): T[] {
  if (!importBillId) return [];
  return rows.filter((r) => Number(r.importBillId) === importBillId && r.state !== "REVERSED" && r.id !== exceptId);
}

const csvCell = (v: string | number) => {
  const s = String(v ?? "");
  // a leading = + - @ would be run as a formula by a spreadsheet; keep real numbers, neutralise text
  const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n");

export interface GridLine { lineNumber: number; productCode?: string; description?: string; quantity?: string; goodsValue: string; customsValue: string; capitalizedSources: string; existingPurchaseTermCosts: string; capitalizedAssessments: string; landedValue: string; landedRate: string }

// The product allocation grid as a sheet: one row per product line, a total row, and the percentage the charges added.
export function allocationCsv(lines: GridLine[], isImport = false): string {
  const head = ["Line", "Product", "Qty", "Goods value", isImport ? "Customs value" : "Assessable value", "Invoiced services", "Bill terms", "Assessed costs", "Landed value", "Landed unit cost", "Uplift %"];
  const body = lines.map((l) => {
    const goods = num(l.goodsValue), landed = num(l.landedValue);
    return [l.lineNumber, l.productCode ?? l.description ?? "", l.quantity ?? "", l.goodsValue, l.customsValue, l.capitalizedSources, l.existingPurchaseTermCosts, l.capitalizedAssessments, l.landedValue, l.landedRate, goods > 0 ? round2(((landed - goods) / goods) * 100) : ""];
  });
  const sum = (pick: (l: GridLine) => string) => round2(lines.reduce((a, l) => a + num(pick(l)), 0));
  const goods = sum((l) => l.goodsValue), landed = sum((l) => l.landedValue);
  const total = ["", "Total", "", goods, sum((l) => l.customsValue), sum((l) => l.capitalizedSources), sum((l) => l.existingPurchaseTermCosts), sum((l) => l.capitalizedAssessments), landed, "", goods > 0 ? round2(((landed - goods) / goods) * 100) : ""];
  return toCsv([head, ...body, total]);
}
