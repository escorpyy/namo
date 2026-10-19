import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import type { Mode, StatusInfo } from "../types";

const HINTS: Record<Mode, string[]> = {
  new: ["Enter: Next field", "Ctrl+S: Save", "F4: Search list", "Esc: Clear", "F1: Help"],
  view: ["F2: Edit", "Ctrl+Delete: Delete", "F3: New", "Ctrl+↑/↓: Prev/Next", "F1: Help"],
  edit: ["Enter: Next field", "Ctrl+S: Update", "Esc: Cancel", "F1: Help"],
};
const MODE_STYLE: Record<Mode, string> = { new: "bg-green-700", view: "bg-slate-600", edit: "bg-amber-600" };

interface Props {
  status: StatusInfo;
  company: string;
  branch: string;
  fy: string;
}

export function StatusBar({ status, company, branch, fy }: Props) {
  const Icon = status.kind === "ok" ? CheckCircle2 : status.kind === "err" ? AlertCircle : Info;
  const color = status.kind === "ok" ? "text-green-700" : status.kind === "err" ? "text-red-700" : "text-slate-600";
  return (
    <footer className="h-7 shrink-0 border-t border-slate-400 bg-slate-100 flex items-center gap-3 px-2 text-[12px] whitespace-nowrap overflow-hidden">
      <span className={`px-2 py-px rounded-sm text-white font-semibold ${MODE_STYLE[status.mode]}`}>{status.mode.toUpperCase()}</span>
      <span>Company: <b className="font-medium">{company}</b></span>
      <span>Branch: <b className="font-medium">{branch}</b></span>
      <span>FY: <b className="font-medium">{fy}</b></span>
      <span>Records: <b className="font-medium">{status.count}</b></span>
      <span className={`flex items-center gap-1 min-w-0 truncate ${color}`} role="status" aria-live="polite"><Icon size={14} /> {status.message}</span>
      <span className="flex-1" />
      <span className="hidden xl:flex gap-3 text-slate-600">{HINTS[status.mode].map((h) => <span key={h}>{h}</span>)}</span>
    </footer>
  );
}
