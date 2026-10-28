import { useEffect, useState } from "react";
import { adToBs, bsToAd, isValidAd } from "../lib/nepaliDate";

interface Props {
  fieldName: string;
  value: string; // AD "YYYY-MM-DD", "" ya "?<adhura text>" (invalid typing ka marker)
  onChange: (v: string) => void;
  calendar: "BS" | "AD";
  hasError: boolean;
  onBlurField: () => void;
  compact?: boolean; // grid cell: dusre calendar ka hint nahi
  disabled?: boolean;
}

// User apne preferred calendar (BS/AD) me type karta hai; form me hamesha AD jaata hai.
// Digits type karo, dashes apne aap lagte hain (20820401 -> 2082-04-01).
export function DateInput({ fieldName, value, onChange, calendar, hasError, onBlurField, compact, disabled }: Props) {
  const show = (v: string) => (v.startsWith("?") ? v.slice(1) : v === "" ? "" : calendar === "BS" ? (adToBs(v) ?? "") : v);
  const [text, setText] = useState(show(value));

  // Selection ya calendar toggle badalne par text dobara sync (typing ke dauran nahi)
  useEffect(() => {
    if (!value.startsWith("?")) setText(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, calendar]);

  const onInput = (raw: string) => {
    const d = raw.replace(/\D/g, "").slice(0, 8);
    const t = d.slice(0, 4) + (d.length > 4 ? "-" + d.slice(4, 6) : "") + (d.length > 6 ? "-" + d.slice(6, 8) : "");
    setText(t);
    if (t === "") return onChange("");
    const ad = t.length === 10 ? (calendar === "BS" ? bsToAd(t) : isValidAd(t) ? t : null) : null;
    onChange(ad ?? "?" + t);
  };

  const ok = value !== "" && !value.startsWith("?");
  const other = ok && !compact ? (calendar === "BS" ? `AD ${value}` : (adToBs(value) ? `BS ${adToBs(value)}` : "")) : "";

  return (
    <div className="min-w-0">
      <input
        data-nav data-field={fieldName} autoComplete="off" inputMode="numeric" maxLength={10}
        placeholder="YYYY-MM-DD" value={text} disabled={disabled} aria-invalid={hasError} aria-label={`${fieldName} date (${calendar})`} title={text || `Date in ${calendar} calendar`}
        className={`fld min-w-0 tabular-nums ${hasError ? "fld-err" : ""} ${disabled ? "bg-slate-100 text-slate-600" : ""}`}
        onChange={(e) => onInput(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={onBlurField}
      />
      {!compact && <span className="block min-h-[14px] text-[10px] leading-[14px] text-slate-500 tabular-nums">{other || "\u00a0"}</span>}
    </div>
  );
}
