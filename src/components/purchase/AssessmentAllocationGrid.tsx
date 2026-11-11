import { allocateByWeights, toMicro } from "../../../shared/purchase-calculation";
import { formatImportCost } from "../../../shared/import-costing";
import type { ImportAssessmentPreview } from "../../api";
import { useDialog } from "../Dialog";

export interface AssessmentAllocationColumn {
  key: string;
  formIndex: number;
  termId: string;
  allocationBasis: "VALUE" | "QUANTITY";
  manual: Record<string, string>;
  code: string;
  name: string;
  result?: Record<string, unknown>;
}

export interface AssessmentAllocationCellUpdate {
  termKey: string;
  lineKey: string;
  value: string;
}

interface Props {
  lines: ImportAssessmentPreview["lines"];
  terms: AssessmentAllocationColumn[];
  editing: boolean;
  busy: boolean;
  previewReady: boolean;
  onCellsChange: (updates: AssessmentAllocationCellUpdate[]) => void;
  onMessage: (message: string) => void;
  isImport?: boolean; // import bills show "Customs value"; local bills show the neutral "Assessable value"
  fill?: boolean; // take the height of the parent and scroll inside it (the fixed assessment screen)
}

const money = (value: unknown) => {
  try { return formatImportCost(toMicro(String(value ?? "0")), 2); }
  catch { return "—"; }
};
const lineKey = (line: ImportAssessmentPreview["lines"][number]) => String(line.key ?? line.id ?? line.lineNumber);
const resultAmount = (term: AssessmentAllocationColumn) => String(term.result?.finalAmount ?? term.result?.amount ?? "0");
const totalEntered = (term: AssessmentAllocationColumn) => {
  let amount = 0n;
  let valid = true;
  for (const value of Object.values(term.manual)) {
    if (value.trim() === "") continue;
    try { amount += toMicro(value); } catch { valid = false; }
  }
  return { amount, valid };
};

export function AssessmentAllocationGrid({ lines, terms, editing, busy, previewReady, onCellsChange, onMessage, fill, isImport = false }: Props) {
  const dlg = useDialog();
  const targetsReady = terms.every((term) => term.result?.finalAmount != null || term.result?.amount != null);
  const pasteRange = (event: React.ClipboardEvent<HTMLInputElement>, startRow: number, startColumn: number) => {
    const text = event.clipboardData.getData("text/plain").replace(/\r/g, "");
    const rows = text.split("\n");
    while (rows.length && rows[rows.length - 1] === "") rows.pop();
    if (rows.length < 2 && !rows.some((row) => row.includes("\t"))) return;
    event.preventDefault();
    const updates: AssessmentAllocationCellUpdate[] = [];
    rows.forEach((row, rowOffset) => {
      const line = lines[startRow + rowOffset];
      if (!line) return;
      row.split("\t").forEach((raw, columnOffset) => {
        const term = terms[startColumn + columnOffset];
        if (!term) return;
        updates.push({ termKey: term.key, lineKey: lineKey(line), value: raw.trim().replace(/,/g, "") });
      });
    });
    if (updates.length) {
      onCellsChange(updates);
      onMessage(`Pasted ${updates.length} allocation cell${updates.length === 1 ? "" : "s"}. Review the totals below.`);
    }
  };

  const autoFill = async () => {
    if (!previewReady || !targetsReady || !lines.length || !terms.length) return;
    const hasValues = terms.some((term) => Object.values(term.manual).some((value) => value.trim() !== ""));
    if (hasValues && !(await dlg.confirm("Replace the current manual allocations with exact splits based on each charge’s allocation basis?", { title: "Replace manual allocations?", variant: "warning", confirmLabel: "Replace" }))) return;
    try {
      const updates: AssessmentAllocationCellUpdate[] = [];
      for (const term of terms) {
        const amount = toMicro(resultAmount(term));
        const weights = lines.map((line) => toMicro(String(term.allocationBasis === "VALUE" ? line.goodsValue : line.quantity ?? "0")));
        const shares = amount === 0n ? lines.map(() => 0n) : allocateByWeights(amount, weights);
        lines.forEach((line, index) => updates.push({
          termKey: term.key,
          lineKey: lineKey(line),
          value: formatImportCost(shares[index], 2),
        }));
      }
      onCellsChange(updates);
      onMessage(`Auto-filled ${terms.length} charge split${terms.length === 1 ? "" : "s"} across ${lines.length} product lines. Review before saving.`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not auto-fill manual allocations.";
      onMessage(text);
      void dlg.error(text, { title: "Could not auto-fill" });
    }
  };

  const columnCount = 9 + terms.length;
  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : undefined}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <p className="text-[12px] text-slate-500">
          {terms.length
            ? "Edit cells inline · paste an Excel/Sheets range · Enter/Tab moves across cells · ↑/↓ moves by product."
            : "Choose Manual split on a charge to edit product allocations here."}
        </p>
        {terms.length > 0 && <button type="button" className="btn" disabled={!editing || busy || !previewReady || !targetsReady || !lines.length} onClick={autoFill} title="Fill all manual charge columns using each charge’s selected value or quantity basis">
          Auto-fill splits
        </button>}
      </div>
      <div className={`${fill ? "min-h-0 flex-1" : "max-h-[40vh]"} lg-scroll lg-grid overflow-auto overscroll-contain`} aria-label="Product allocation and landed cost grid">
        <table className="xl-table min-w-[960px] table-fixed text-[12px]">
          <thead className="lg-th !z-20">
            <tr>
              <th className="sticky left-0 z-30 w-[180px] border-r border-slate-200 bg-slate-50 px-3 py-2 text-left">Product</th>
              <th className="w-[96px] px-3 py-2 text-right">Qty</th>
              <th className="w-[90px] px-3 py-2 text-right">Goods value</th>
              <th className="w-[90px] px-3 py-2 text-right">{isImport ? "Customs value" : "Assessable value"}</th>
              <th className="w-[90px] px-3 py-2 text-right">Invoiced services</th>
              <th className="w-[90px] px-3 py-2 text-right">Bill terms</th>
              {terms.map((term, index) => <th key={term.key} className="w-[112px] px-3 py-2 text-right" title={`${term.code} — ${term.name}; basis: ${term.allocationBasis.toLowerCase()}`}>
                <span className="block truncate text-cobalt-800">{term.code || `Charge ${index + 1}`}</span>
                <span className="block truncate font-normal">{term.name}</span>
              </th>)}
              <th className="w-[95px] px-3 py-2 text-right">Assessed costs</th>
              <th className="w-[95px] px-3 py-2 text-right">Landed value</th>
              <th className="w-[100px] px-3 py-2 text-right">Landed unit cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, rowIndex) => {
              const id = lineKey(line);
              return <tr key={id} className="border-t border-slate-100 bg-white hover:bg-cobalt-50/40">
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-inherit px-3 py-2" title={line.description ?? line.productCode ?? ""}>
                  <span className="block truncate font-medium">{line.lineNumber}. {line.productCode ?? line.description ?? `Product line ${line.lineNumber}`}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{line.quantity != null ? line.quantity.toString().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.goodsValue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.customsValue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.capitalizedSources)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(line.existingPurchaseTermCosts)}</td>
                {terms.map((term, columnIndex) => <td key={term.key} className="p-0">
                  <input
                    data-field={`manual.${term.formIndex}.${id}`}
                    data-matrix-cell={`${rowIndex}:${columnIndex}`}
                    className="fld h-7 w-full rounded px-1.5 text-right text-[12px] tabular-nums"
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={!editing || busy}
                    aria-label={`${term.code || term.name} allocation for line ${line.lineNumber}`}
                    value={term.manual[id] ?? ""}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => onCellsChange([{ termKey: term.key, lineKey: id, value: event.target.value }])}
                    onPaste={(event) => pasteRange(event, rowIndex, columnIndex)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      const nextRow = rowIndex + (event.key === "ArrowDown" ? 1 : -1);
                      if (nextRow < 0 || nextRow >= lines.length) return;
                      const next = event.currentTarget.closest("table")?.querySelector<HTMLInputElement>(`[data-matrix-cell="${nextRow}:${columnIndex}"]`);
                      if (next) { event.preventDefault(); next.focus(); }
                    }}
                  />
                </td>)}
                <td className="px-3 py-2 text-right tabular-nums">{money(line.capitalizedAssessments)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(line.landedValue)}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{money(line.landedRate)}</td>
              </tr>;
            })}
            {!lines.length && <tr><td colSpan={columnCount} className="p-3 text-center text-slate-500">Choose a posted goods bill to load product lines.</td></tr>}
          </tbody>
          {terms.length > 0 && <tfoot className="sticky bottom-0 z-20 border-t border-slate-200 bg-slate-50 font-semibold text-slate-700">
            <tr>
              <td colSpan={6} className="px-3 py-2 text-right">Entered / target · remaining</td>
              {terms.map((term) => {
                const { amount: entered, valid } = totalEntered(term);
                const targetKnown = term.result?.finalAmount != null || term.result?.amount != null;
                const target = (() => { try { return toMicro(resultAmount(term)); } catch { return 0n; } })();
                const gap = target - entered;
                return <td key={term.key} className={`p-1 text-right tabular-nums ${targetKnown && valid && gap === 0n ? "text-emerald-800" : "text-rose-700"}`}>
                  <span className="block">{formatImportCost(entered, 2)} / {formatImportCost(target, 2)}</span>
                  <span className="block text-[11px] font-normal">{!valid ? "Check number format" : !targetKnown ? "Waiting for preview" : gap === 0n ? "Balanced" : `Gap ${formatImportCost(gap, 2)}`}</span>
                </td>;
              })}
              <td colSpan={3} className="px-3 py-2 text-right">{lines.length} product lines</td>
            </tr>
          </tfoot>}
        </table>
      </div>
    </div>
  );
}
