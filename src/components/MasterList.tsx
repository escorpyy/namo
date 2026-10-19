import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import type { MasterDef, Opt } from "../../shared/masters";
import type { Row } from "../lib/form";
import { OptBadge } from "./OptBadge";

interface Props {
  def: MasterDef;
  items: Row[];
  total: number;
  selectedId: number | null;
  search: string;
  onSearch: (s: string) => void;
  onSelect: (id: number) => void;
  searchRef: React.RefObject<HTMLInputElement>;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  lookups: Record<string, Opt[]>;
}

export function MasterList({ def, items, total, selectedId, search, onSearch, onSelect, searchRef, onSearchKeyDown, lookups }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const grid = { gridTemplateColumns: def.columns.map((c) => c.width).join(" ") };

  // Selected row hamesha dikhni chahiye
  useEffect(() => {
    if (selectedId != null) listRef.current?.querySelector(`[data-row="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, items]);

  const onRowKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-row]"));
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); rows[Math.min(i + 1, rows.length - 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); rows[Math.max(i - 1, 0)]?.focus(); }
    else if (e.key === "Escape") { e.stopPropagation(); document.querySelector<HTMLElement>("[data-zone=form] [data-nav]")?.focus(); }
  };

  const cell = (row: Row, c: MasterDef["columns"][number]) => {
    const v = row[c.name];
    switch (c.kind) {
      case "mono": return <span className="font-mono tabular-nums truncate">{v}</span>;
      case "badge": return <OptBadge opt={def.fields.find((f) => f.name === c.name)?.options?.find((o) => o.value === v)} />;
      case "lookup": return <span className="font-mono truncate text-slate-600">{v == null ? "—" : (lookups[c.name]?.find((o) => o.value === String(v))?.short ?? "")}</span>;
      case "dot": return <span className="text-center"><span className={`inline-block w-2 h-2 rounded-full ${v ? "bg-green-600" : "bg-slate-400"}`} title={`${c.label}: ${v ? "Yes" : "No"}`} /></span>;
      case "date": return <span className="tabular-nums truncate">{v ? String(v).slice(0, 10) : ""}</span>;
      default:
        if (v == null || v === "") return c.empty ? <span className="truncate pr-2 text-slate-500">{c.empty}</span> : <span />;
        return <span className="truncate pr-2">{String(v)}</span>;
    }
  };

  return (
    <aside data-zone="list" className="w-[320px] shrink-0 border-l border-slate-400 bg-white/50 flex flex-col min-h-0">
      <div className="px-3 pt-3 pb-2">
        <h2 className="text-[15px] font-semibold mb-2">{def.title}s</h2>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            ref={searchRef} value={search} onChange={(e) => onSearch(e.target.value)} onKeyDown={onSearchKeyDown}
            onFocus={(e) => e.currentTarget.select()} placeholder="Search…  (F4)" className="fld pl-7" aria-label={`Search ${def.title}`}
          />
        </div>
      </div>
      <div style={grid} className="grid px-3 py-1 text-[11px] font-semibold text-slate-600 border-y border-slate-300 bg-slate-100">
        {def.columns.map((c) => <span key={c.name} className={c.kind === "dot" ? "text-center" : ""}>{c.label}</span>)}
      </div>
      <div ref={listRef} onKeyDown={onRowKey} className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 && <div className="p-4 text-slate-500">{total === 0 ? "No records yet. Press F3 for a new one." : "No records match."}</div>}
        {items.map((r) => (
          <div
            key={r.id} data-row={r.id} tabIndex={-1} role="option" aria-selected={r.id === selectedId} style={grid}
            onClick={() => onSelect(r.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.id); } }}
            className={`grid items-center px-3 h-8 border-b border-slate-200 cursor-pointer hover:bg-slate-100 ${r.id === selectedId ? "bg-blue-100 hover:bg-blue-100" : ""}`}
          >
            {def.columns.map((c) => <span key={c.name} className="min-w-0 contents">{cell(r, c)}</span>)}
          </div>
        ))}
      </div>
      <div className="px-3 h-8 flex items-center border-t border-slate-300 text-[12px] text-slate-600">{items.length} of {total}</div>
    </aside>
  );
}
