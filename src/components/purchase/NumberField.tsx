import { useEffect, useState, type ReactNode } from "react";
import { numberSeriesApi, type AvailableSeries } from "../../api";
import { Field } from "./Bits";
import { NumberSeriesDialog } from "../NumberSeriesDialog";

// The document number box of a purchase form. For a NEW document it offers the series the user may use (default first) and, by the
// series' mode, shows the number that will be given (Automatic), lets the user overtype the suggestion (Suggested) or asks for a number (Manual).
// A saved document just shows its number. With no series set up the box says "(next number)" and the old numbering applies.

interface Props {
  label: string; documentType: string; companyId: number; branchId: number; fyCode: string; userId: number;
  existingNumber?: string; readOnly: boolean;
  seriesId: string; number: string; onChange: (p: { numberSeriesId: string; docNumber: string }) => void;
  fieldName?: string;
  /** no label of its own (a table cell next to a header cell carries it); `label` is then only the accessible name */
  bare?: boolean;
}

export function NumberField({ label, documentType, companyId, branchId, fyCode, userId, existingNumber, readOnly, seriesId, number, onChange, fieldName = "documentNumber", bare }: Props) {
  const [list, setList] = useState<AvailableSeries[]>([]);
  const [asking, setAsking] = useState(false);
  const [numberWarning, setNumberWarning] = useState("");
  const [checking, setChecking] = useState(false);
  const isNew = existingNumber === undefined;

  useEffect(() => {
    if (!isNew) return;
    let live = true;
    numberSeriesApi.available(companyId, documentType, branchId, fyCode, userId)
      .then((r) => {
        if (!live) return;
        setList(r);
        // a module with several series asks which numbering to use, once, when a new document starts
        if (r.length > 1 && !seriesId && !readOnly) setAsking(true);
        if (seriesId && !r.some((x) => String(x.id) === seriesId)) onChange({ numberSeriesId: "", docNumber: "" }); // the chosen series is not offered here (other branch / year)
      })
      .catch(() => live && setList([]));
    return () => { live = false; };
  }, [isNew, companyId, documentType, branchId, fyCode, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a blank choice means "the default": the first offered series, which is also the one the server uses
  const chosen = seriesId || String(list[0]?.id ?? "");
  const cur = list.find((x) => String(x.id) === chosen);

  // Manual and suggested numbers are user-owned values, so check them while the
  // user is entering them. This is advisory only: the save-time unique index is
  // still required for two users typing the same number concurrently.
  useEffect(() => {
    setNumberWarning("");
    if (!isNew || readOnly || !number.trim() || cur?.mode === "AUTOMATIC") return;
    let live = true;
    const timer = window.setTimeout(async () => {
      if (!live) return;
      setChecking(true);
      try {
        const r = await numberSeriesApi.check(documentType, branchId, fyCode, number.trim());
        if (!live) return;
        setNumberWarning(r.available ? "" : `${label} '${number.trim()}' is already used in this ${r.scope === "BRANCH" ? "branch" : "branch and fiscal year"}. Enter a different number.`);
      } catch {
        // A connectivity failure must not make a valid form look invalid; the
        // authoritative save request will still perform the final check.
      } finally {
        if (live) setChecking(false);
      }
    }, 350);
    return () => { live = false; window.clearTimeout(timer); };
  }, [branchId, cur?.mode, documentType, fyCode, isNew, label, number, readOnly]);

  const dialog = asking && <NumberSeriesDialog title={`${label.replace(/ No$/, "")} numbering`} items={list} onPick={(id) => { setAsking(false); onChange({ numberSeriesId: String(id), docNumber: "" }); }} />;
  // a plain function, not a component: a component type made inside render would remount the input on every keystroke
  const wrap = (children: ReactNode, required?: boolean) => (bare ? children : <Field label={label} required={required}>{children}</Field>);
  if (!isNew || !list.length || readOnly) {
    return <>{wrap(<input disabled className="fld bg-slate-100 text-slate-600" value={existingNumber ?? ""} placeholder="(next number)" aria-label={label} />)}</>;
  }
  const auto = cur?.mode === "AUTOMATIC";
  return (
    <div className="min-w-0">
      {dialog}
      {wrap(
        <div className="flex gap-1">
          {list.length > 1 && (
              <select data-field={`${fieldName}.series`} className="fld w-[42%] min-w-0" aria-label={`${label} series`} value={chosen} onChange={(e) => onChange({ numberSeriesId: e.target.value, docNumber: "" })}>
              {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <input
            className={`fld min-w-0 flex-1 font-mono ${auto ? "bg-slate-100 text-slate-600" : ""} ${numberWarning ? "fld-err" : ""}`} disabled={auto} aria-label={label} aria-invalid={!!numberWarning} maxLength={30} autoComplete="off"
            data-field={fieldName} value={auto ? cur?.next ?? "" : number} placeholder={cur?.mode === "MANUAL" ? "type the number" : cur?.next ?? ""}
            onChange={(e) => onChange({ numberSeriesId: seriesId, docNumber: e.target.value })}
          />
        </div>,
        cur?.mode === "MANUAL",
      )}
      {cur?.problem && <p className="mt-1 text-[12px] text-rose-700">{cur.problem}</p>}
      {!cur?.problem && numberWarning && <p className="mt-1 text-[12px] text-rose-700">{numberWarning}</p>}
      {!cur?.problem && !numberWarning && checking && <p className="mt-1 text-[12px] text-slate-500">Checking number…</p>}
      {!cur?.problem && !numberWarning && !checking && cur?.left !== null && cur?.left !== undefined && cur.left <= 10 && <p className="mt-1 text-[12px] text-amber-700">Only {cur.left} number(s) left in this series.</p>}
    </div>
  );
}
