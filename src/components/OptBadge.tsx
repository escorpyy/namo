import type { Opt } from "../../shared/masters";

export function OptBadge({ opt }: { opt?: Opt }) {
  if (!opt) return null;
  return (
    <span className={`inline-block w-[78px] text-center text-[10px] font-semibold border rounded-sm py-px ${opt.badge ?? "bg-slate-100 text-slate-700 border-slate-300"}`}>
      {opt.label}
    </span>
  );
}
