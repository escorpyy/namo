import { allocateByWeights, toMicro } from "../../../shared/purchase-calculation";
import { formatImportCost } from "../../../shared/import-costing";
import type { ImportAssessmentPreview } from "../../api";

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

export function AssessmentAllocationGrid({ lines, terms, editing, busy, previewReady, onCellsChange, onMessage, fill }: Props) {
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

  const autoFill = () => {
    if (!previewReady || !targetsReady || !lines.length || !terms.length) return;
    const hasValues = terms.some((term) => Object.values(term.manual).some((value) => value.trim() !== ""));
    if (hasValues && !window.confirm("Replace the current manual allocations with exact splits based on each charge’s allocation basis?")) return;
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
      onMessage(error instanceof Error ? error.message : "Could not auto-fill manual allocations.");
    }
  };

  const columnCount = 9 + terms.length;
  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : undefined}>
      <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] text-slate-600">
          {terms.length
            ? "Edit cells inline · paste an Excel/Sheets range · Enter/Tab moves across cells · ↑/↓ moves by product."
            : "Choose Manual split on a charge to edit product allocations here."}
        </p>
        {terms.length > 0 && <button type="button" className="btn h-7" disabled={!editing || busy || !previewReady || !targetsReady || !lines.length} onClick={autoFill} title="Fill all manual charge columns using each charge’s selected value or quantity basis">
          Auto-fill splits
        </button>}
      </div>
      <div className={`${fill ? "min-h-0 flex-1" : "max-h-[40vh]"} overflow-auto overscroll-contain border border-slate-200`} aria-label="Product allocation and landed cost grid">
        <table className="w-full min-w-[900px] table-fixed text-[10px]">
          <thead className="sticky top-0 z-20 bg-slate-50 text-slate-600 shadow-sm">
            <tr>
              <th className="sticky left-0 z-30 w-[180px] border-r border-slate-200 bg-slate-50 p-1 text-left">Product</th>
              <th className="w-[60px] p-1 text-right">Qty</th>
              <th className="w-[90px] p-1 text-right">Goods value</th>
              <th className="w-[90px] p-1 text-right">Customs value</th>
              <th className="w-[90px] p-1 text-right">Invoiced services</th>
              <th className="w-[90px] p-1 text-right">Bill terms</th>
              {terms.map((term, index) => <th key={term.key} className="w-[112px] p-1 text-right" title={`${term.code} — ${term.name}; basis: ${term.allocationBasis.toLowerCase()}`}>
                <span className="block truncate text-blue-800">{term.code || `Charge ${index + 1}`}</span>
                <span className="block truncate font-normal">{term.name}</span>
              </th>)}
              <th className="w-[95px] p-1 text-right">Assessed costs</th>
              <th className="w-[95px] p-1 text-right">Landed value</th>
              <th className="w-[100px] p-1 text-right">Landed unit cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, rowIndex) => {
              const id = lineKey(line);
              return <tr key={id} className="border-t border-slate-200 odd:bg-white even:bg-slate-50/50">
                <td className="sticky left-0 z-10 border-r border-slate-200 bg-inherit p-1" title={line.description ?? line.productCode ?? ""}>
                  <span className="block truncate font-medium">{line.lineNumber}. {line.productCode ?? line.description ?? `Product line ${line.lineNumber}`}</span>
                </td>
                <td className="p-1 text-right tabular-nums">{line.quantity ?? "—"}</td>
                <td className="p-1 text-right tabular-nums">{money(line.goodsValue)}</td>
                <td className="p-1 text-right tabular-nums">{money(line.customsValue)}</td>
                <td className="p-1 text-right tabular-nums">{money(line.capitalizedSources)}</td>
                <td className="p-1 text-right tabular-nums">{money(line.existingPurchaseTermCosts)}</td>
                {terms.map((term, columnIndex) => <td key={term.key} className="p-0">
                  <input
                    data-field={`manual.${term.formIndex}.${id}`}
                    data-matrix-cell={`${rowIndex}:${columnIndex}`}
                    className="fld h-5 w-full px-1 text-right text-[10px] tabular-nums"
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
                <td className="p-1 text-right tabular-nums">{money(line.capitalizedAssessments)}</td>
                <td className="p-1 text-right tabular-nums font-semibold">{money(line.landedValue)}</td>
                <td className="p-1 text-right tabular-nums font-semibold">{money(line.landedRate)}</td>
              </tr>;
            })}
            {!lines.length && <tr><td colSpan={columnCount} className="p-3 text-center text-slate-500">Choose a posted goods bill to load product lines.</td></tr>}
          </tbody>
          {terms.length > 0 && <tfoot className="sticky bottom-0 z-20 border-t border-slate-300 bg-slate-50 font-semibold text-slate-700">
            <tr>
              <td colSpan={6} className="p-1 text-right">Entered / target · remaining</td>
              {terms.map((term) => {
                const { amount: entered, valid } = totalEntered(term);
                const targetKnown = term.result?.finalAmount != null || term.result?.amount != null;
                const target = (() => { try { return toMicro(resultAmount(term)); } catch { return 0n; } })();
                const gap = target - entered;
                return <td key={term.key} className={`p-1 text-right tabular-nums ${targetKnown && valid && gap === 0n ? "text-green-800" : "text-red-700"}`}>
                  <span className="block">{formatImportCost(entered, 2)} / {formatImportCost(target, 2)}</span>
                  <span className="block text-[9px]">{!valid ? "Check number format" : !targetKnown ? "Waiting for preview" : gap === 0n ? "Balanced" : `Gap ${formatImportCost(gap, 2)}`}</span>
                </td>;
              })}
              <td colSpan={3} className="p-1 text-right">{lines.length} product lines</td>
            </tr>
          </tfoot>}
        </table>
      </div>
    </div>
  );
}
