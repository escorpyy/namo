import { useEffect, useState } from "react";
import { numberSeriesApi, type AvailableSeries } from "../../api";
import { Field } from "./Bits";

// The document number box of a purchase form. For a NEW document it offers the series the user may use (default first) and, by the
// series' mode, shows the number that will be given (Automatic), lets the user overtype the suggestion (Suggested) or asks for a number (Manual).
// A saved document just shows its number. With no series set up the box says "(next number)" and the old numbering applies.

interface Props {
  label: string; documentType: string; companyId: number; branchId: number; fyCode: string; userId: number;
  existingNumber?: string; readOnly: boolean;
  seriesId: string; number: string; onChange: (p: { numberSeriesId: string; docNumber: string }) => void;
}

export function NumberField({ label, documentType, companyId, branchId, fyCode, userId, existingNumber, readOnly, seriesId, number, onChange }: Props) {
  const [list, setList] = useState<AvailableSeries[]>([]);
  const isNew = existingNumber === undefined;

  useEffect(() => {
    if (!isNew) return;
    let live = true;
    numberSeriesApi.available(companyId, documentType, branchId, fyCode, userId)
      .then((r) => {
        if (!live) return;
        setList(r);
        if (seriesId && !r.some((x) => String(x.id) === seriesId)) onChange({ numberSeriesId: "", docNumber: "" }); // the chosen series is not offered here (other branch / year)
      })
      .catch(() => live && setList([]));
    return () => { live = false; };
  }, [isNew, companyId, documentType, branchId, fyCode, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // a blank choice means "the default": the first offered series, which is also the one the server uses
  const chosen = seriesId || String(list[0]?.id ?? "");
  const cur = list.find((x) => String(x.id) === chosen);
  if (!isNew || !list.length || readOnly) {
    return <Field label={label}><input disabled className="fld bg-slate-100 text-slate-600" value={existingNumber ?? ""} placeholder="(next number)" aria-label={label} /></Field>;
  }
  const auto = cur?.mode === "AUTOMATIC";
  return (
    <div className="min-w-0">
      <Field label={label} required={cur?.mode === "MANUAL"}>
        <div className="flex gap-1">
          {list.length > 1 && (
            <select className="fld w-[42%] min-w-0" aria-label={`${label} series`} value={chosen} onChange={(e) => onChange({ numberSeriesId: e.target.value, docNumber: "" })}>
              {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
          <input
            className={`fld min-w-0 flex-1 font-mono ${auto ? "bg-slate-100 text-slate-600" : ""}`} disabled={auto} aria-label={label} maxLength={30} autoComplete="off"
            value={auto ? cur?.next ?? "" : number} placeholder={cur?.mode === "MANUAL" ? "type the number" : cur?.next ?? ""}
            onChange={(e) => onChange({ numberSeriesId: seriesId, docNumber: e.target.value })}
          />
        </div>
      </Field>
      {cur?.problem && <p className="mt-1 text-[12px] text-rose-700">{cur.problem}</p>}
      {!cur?.problem && cur?.left !== null && cur?.left !== undefined && cur.left <= 10 && <p className="mt-1 text-[12px] text-amber-700">Only {cur.left} number(s) left in this series.</p>}
    </div>
  );
}
