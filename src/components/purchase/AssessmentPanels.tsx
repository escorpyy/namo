import { useMemo, type ReactNode } from "react";
import { AlertTriangle, Check, Circle, Eye, Pencil } from "lucide-react";
import { formatImportCost } from "../../../shared/import-costing";
import { toMicro } from "../../../shared/purchase-calculation";
import { adToBs } from "../../lib/nepaliDate";
import { chargeMix, costBuildUp, productImpact, type ReadinessCheck, type PreviewLike } from "../../lib/assessmentInsights";
import { Row } from "./BillPanels";

// The two side panels of the cost assessment screen. Left: the header the user just entered. Right: what the charges do to the landed cost,
// live from the costing preview, plus a checklist of what still stands between this draft and "Apply".

const money = (v: unknown) => { try { return formatImportCost(toMicro(String(v ?? "0")), 2); } catch { return "—"; } };
const moneyN = (n: number) => money(n.toFixed(2));
const pct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);

const SEGMENT_TONE: Record<string, string> = { goods: "bg-slate-400", services: "bg-sky-500", earlier: "bg-violet-400", assessed: "bg-cobalt-700" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 border-t border-slate-100 pt-3 first:mt-0 first:border-0 first:pt-0">
      <h3 className="mb-1.5 text-[12px] font-semibold text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export interface SummaryProps {
  assessmentNumber?: string; date: string; billLabel: string; referenceNo: string; remarks: string; calendar: "BS" | "AD"; readOnly: boolean; onEdit: () => void; isImport?: boolean;
}

export function AssessmentSummary({ assessmentNumber, date, billLabel, referenceNo, remarks, calendar, readOnly, onEdit, isImport }: SummaryProps) {
  const shown = !date || date.startsWith("?") ? "" : calendar === "BS" ? (adToBs(date) ?? date) : date;
  return (
    <div>
      <dl>
        <Row label="Assessment no"><span className="font-mono">{assessmentNumber || "(next number)"}</span></Row>
        <Row label={`Assessment date (${calendar})`}>{shown}</Row>
        <Row label="Goods bill">{billLabel}</Row>
        <Row label={isImport ? "Customs / reference" : "Reference no"}>{referenceNo}</Row>
        {remarks.trim() && <Row label="Remarks"><span className="whitespace-pre-wrap">{remarks}</span></Row>}
      </dl>
      <button type="button" className="btn mt-3 w-full justify-center" onClick={onEdit}>
        {readOnly ? <><Eye size={12} /> View full header</> : <><Pencil size={12} /> Edit header</>}
      </button>
    </div>
  );
}

export interface InsightsProps {
  preview: PreviewLike | null; previewError: string; previewPending: boolean;
  source?: { label: string; cif: string; lineCount: number; isImport?: boolean };
  charges: { key: string; label: string; amount: number; inStock: boolean }[];
  duplicates: { id: number; assessmentNumber: string; state: string }[];
  checks: ReadinessCheck[]; showChecks: boolean; onJump: (field: string) => void;
}

export function AssessmentInsights({ preview, previewError, previewPending, source, charges, duplicates, checks, showChecks, onJump }: InsightsProps) {
  const build = useMemo(() => costBuildUp(preview), [preview]);
  const impact = useMemo(() => productImpact(preview?.lines), [preview]);
  const mix = useMemo(() => chargeMix(charges.filter((c) => c.amount !== 0)), [charges]);
  const failing = checks.filter((c) => !c.ok);
  const hardest = impact.filter((i) => i.upliftPct !== null).slice(0, 5);
  const maxUplift = Math.max(1, ...hardest.map((i) => Math.abs(i.upliftPct ?? 0)));
  // a charge above half the goods value, or a total uplift above 100%, is more often a typo than a real landed cost
  const odd = build && build.upliftPct !== null && build.upliftPct > 100;

  return (
    <div aria-busy={previewPending}>
      {duplicates.length > 0 && (
        <p role="alert" className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-900">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>This goods bill already has {duplicates.length === 1 ? "an assessment" : `${duplicates.length} assessments`}: {duplicates.map((d) => `${d.assessmentNumber} (${d.state.toLowerCase()})`).join(", ")}. A second one would capitalize the same bill again.</span>
        </p>
      )}

      {source && (
        <Section title="Goods bill">
          <p className="text-[13px] font-semibold text-ink">{source.label}</p>
          <p className="text-[12px] text-slate-500">{money(source.cif)} {source.isImport ? "CIF" : "base value"} · {source.lineCount} product line{source.lineCount === 1 ? "" : "s"}</p>
        </Section>
      )}

      <Section title="Landed cost">
        {previewError ? <p role="alert" className="text-[12px] text-rose-700">{previewError}</p>
          : !build ? <p className="text-[12px] text-slate-500">{previewPending ? "Calculating…" : "Choose a goods bill to see the landed cost."}</p>
          : (
            <>
              <p className="flex items-baseline justify-between gap-2">
                <span className={`text-[28px] font-semibold leading-none tracking-tight tabular-nums ${odd ? "text-amber-700" : "text-cobalt-800"}`} data-insight="uplift">{pct(build.upliftPct)}</span>
                <span className="text-[12px] text-slate-500">over goods value</span>
              </p>
              <div className="mt-2.5 flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`Landed cost build-up: ${build.segments.map((s) => `${s.label} ${moneyN(s.amount)}`).join(", ")}`}>
                {build.segments.filter((s) => s.share > 0).map((s) => <span key={s.key} className={SEGMENT_TONE[s.key]} style={{ width: `${s.share * 100}%` }} title={`${s.label}: ${moneyN(s.amount)}`} />)}
              </div>
              <ul className="mt-2.5 space-y-1">
                {build.segments.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="flex min-w-0 items-center gap-1.5 text-slate-700"><span className={`h-2 w-2 shrink-0 rounded-full ${SEGMENT_TONE[s.key]}`} /><span className="truncate">{s.label}</span></span>
                    <span className="tabular-nums text-slate-900">{moneyN(s.amount)}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-2 border-t border-slate-200 pt-1.5 text-[13px] font-semibold"><span>Landed total</span><span className="tabular-nums" data-insight="landed-total">{moneyN(build.total)}</span></li>
              </ul>
              {odd && <p className="mt-1 text-[11px] text-amber-800">The charges more than double the goods value. Check the amounts.</p>}
            </>
          )}
      </Section>

      {showChecks && (failing.length === 0 ? (
        <p data-insight="ready" className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-medium text-emerald-900"><Check size={14} className="shrink-0" /> Ready to apply</p>
      ) : (
        <Section title={`Ready to apply — ${failing.length} to fix`}>
          <ul className="space-y-0.5" data-insight="checks">
            {checks.map((c) => (
              <li key={c.id}>
                <button type="button" disabled={c.ok || !c.focus} onClick={() => c.focus && onJump(c.focus)}
                  className={`flex w-full items-start gap-1.5 rounded-sm px-1 py-0.5 text-left text-[11.5px] ${c.ok ? "text-slate-600" : "text-rose-800 hover:bg-rose-50"}`}>
                  {c.ok ? <Check size={13} className="mt-0.5 shrink-0 text-emerald-700" /> : <Circle size={13} className="mt-0.5 shrink-0" />}
                  <span className="min-w-0"><span className="block">{c.label}</span>{c.detail && <span className="block truncate text-[10.5px] opacity-80" title={c.detail}>{c.detail}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ))}

      {mix.length > 0 && (
        <Section title="Where the charges go">
          <ul className="space-y-1.5">
            {mix.map((m) => (
              <li key={m.key} className="text-[12px]">
                <div className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate text-slate-800" title={m.label}>{m.label}</span><span className="tabular-nums text-slate-900">{moneyN(m.amount)}</span></div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full ${m.inStock ? "bg-cobalt-600" : "bg-amber-500"}`} style={{ width: `${m.share * 100}%` }} /></span>
                  <span className={`w-[52px] shrink-0 text-right text-[11px] ${m.inStock ? "text-cobalt-800" : "text-amber-800"}`}>{m.inStock ? "in stock" : "expensed"}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hardest.length > 0 && (
        <Section title="Hit hardest">
          <ul className="space-y-1.5" data-insight="impact">
            {hardest.map((h) => (
              <li key={h.key} className="text-[12px]">
                <div className="flex items-baseline justify-between gap-2"><span className="min-w-0 truncate text-slate-800" title={h.label}>{h.label}</span><span className="tabular-nums font-semibold text-slate-900">{pct(h.upliftPct)}</span></div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><span className="block h-full bg-cobalt-700" style={{ width: `${Math.max(2, (Math.abs(h.upliftPct ?? 0) / maxUplift) * 100)}%` }} /></span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500" title="Landed unit cost">{money(h.landedRate)}/unit</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
