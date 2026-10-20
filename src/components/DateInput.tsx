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
}

// User apne preferred calendar (BS/AD) me type karta hai; form me hamesha AD jaata hai.
// Digits type karo, dashes apne aap lagte hain (20820401 -> 2082-04-01).
export function DateInput({ fieldName, value, onChange, calendar, hasError, onBlurField, compact }: Props) {
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
    <div className="relative">
      <input
        data-nav data-field={fieldName} autoComplete="off" inputMode="numeric" maxLength={10}
        placeholder={`YYYY-MM-DD (${calendar})`} value={text} aria-invalid={hasError}
        className={`fld tabular-nums ${other ? "pr-28" : ""} ${hasError ? "fld-err" : ""}`}
        onChange={(e) => onInput(e.target.value)} onFocus={(e) => e.currentTarget.select()} onBlur={onBlurField}
      />
      {other && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 tabular-nums pointer-events-none">{other}</span>}
    </div>
  );
}
