import type { ReactNode } from "react";

/** A reusable, checkbox-first query criterion; its options are only shown when enabled. */
export function QueryFilterGroup({
  label, checked, onCheckedChange, children, className = "",
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={`min-w-0 rounded-lg border border-slate-200 bg-white ${className}`}>
      <legend className="sr-only">{label}</legend>
      <label className="flex min-h-10 cursor-pointer items-center gap-2 px-3 text-[12px] font-semibold text-slate-800">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="h-4 w-4 accent-cobalt-700"
        />
        <span>{label}</span>
      </label>
      {checked && <div className="border-t border-slate-100 p-3">{children}</div>}
    </fieldset>
  );
}
