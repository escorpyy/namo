import { Building2, CalendarDays, ChevronDown, MapPin, Menu, User } from "lucide-react";
import type { CompanyCtx } from "../types";

interface Props {
  companies: CompanyCtx[];
  companyId: number;
  branchId: number;
  fyId: number;
  userName: string;
  calendar: "BS" | "AD";
  onToggleSidebar: () => void;
  onCompany: (id: number) => void;
  onBranch: (id: number) => void;
  onFy: (id: number) => void;
  onCalendar: (c: "BS" | "AD") => void;
}

function Sel({ icon, value, onChange, children, label }: { icon: React.ReactNode; value: number; onChange: (v: number) => void; children: React.ReactNode; label: string }) {
  return (
    <label className="relative flex items-center gap-2 h-8 pl-2 pr-7 bg-navy-light border border-slate-500 rounded-sm text-white" title={label}>
      {icon}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-transparent outline-none appearance-none text-[13px] pr-2 cursor-pointer [&>option]:text-slate-900"
      >
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2 pointer-events-none" />
    </label>
  );
}

export function Header(p: Props) {
  const co = p.companies.find((c) => c.id === p.companyId)!;
  return (
    <header className="h-11 shrink-0 bg-navy text-white flex items-center gap-3 px-2">
      <button onClick={p.onToggleSidebar} className="p-1.5 hover:bg-navy-light rounded-sm" aria-label="Toggle sidebar (Ctrl+B)" title="Toggle sidebar (Ctrl+B)">
        <Menu size={18} />
      </button>
      <span className="text-[18px] font-bold tracking-tight">NamoErp</span>
      <div className="flex-1" />
      <Sel label="Company" icon={<Building2 size={14} />} value={p.companyId} onChange={p.onCompany}>
        {p.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Sel>
      <Sel label="Branch" icon={<MapPin size={14} />} value={p.branchId} onChange={p.onBranch}>
        {co.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Sel>
      <Sel label="Fiscal year" icon={<CalendarDays size={14} />} value={p.fyId} onChange={p.onFy}>
        {co.fiscalYears.map((y) => <option key={y.id} value={y.id}>{y.code}</option>)}
      </Sel>
      <div className="flex border border-slate-500 rounded-sm overflow-hidden" role="group" aria-label="Calendar preference">
        {(["BS", "AD"] as const).map((c) => (
          <button key={c} onClick={() => p.onCalendar(c)} className={`px-2.5 h-8 text-[12px] font-semibold ${p.calendar === c ? "bg-white text-navy" : "bg-navy-light"}`}>
            {c}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 pl-1"><User size={15} /> {p.userName}</div>
    </header>
  );
}
