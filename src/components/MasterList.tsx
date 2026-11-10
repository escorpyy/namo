import { useEffect, useMemo, useRef } from "react";
import { Search } from "lucide-react";
import type { MasterDef, Opt } from "../../shared/masters";
import type { Row } from "../lib/form";
import { OptBadge } from "./OptBadge";
import { DataTable, type Column } from "./table/DataTable";
import type { ColKind } from "../lib/tableKinds";

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
  onDeleteSelected?: () => void; // Delete on the selected row (the screen asks before it deletes)
}

// What each kind of master column holds, for alignment (Excel's rules: text left, numbers and dates right, yes/no centred).
const KIND: Record<NonNullable<MasterDef["columns"][number]["kind"]>, ColKind> = { mono: "text", text: "text", badge: "text", lookup: "text", number: "number", date: "date", dot: "boolean" };

export function MasterList({ def, items, total, selectedId, search, onSearch, onSelect, searchRef, onSearchKeyDown, lookups, onDeleteSelected }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Selected row hamesha dikhni chahiye
  useEffect(() => {
    if (selectedId != null) listRef.current?.querySelector(`[data-row="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId, items]);

  const cell = (row: Row, c: MasterDef["columns"][number]) => {
    const v = row[c.name];
    switch (c.kind) {
      case "mono": return <span className="font-mono tabular-nums">{v}</span>;
      case "badge": return <OptBadge opt={def.fields.find((f) => f.name === c.name)?.options?.find((o) => o.value === v)} />;
      case "lookup": return <span className="font-mono text-slate-600">{v == null ? "—" : (lookups[c.name]?.find((o) => o.value === String(v))?.short ?? "")}</span>;
      case "dot": return <span className={`inline-block h-2 w-2 rounded-full ${v ? "bg-green-600" : "bg-slate-400"}`} title={`${c.label}: ${v ? "Yes" : "No"}`} />;
      case "date": return v ? String(v).slice(0, 10) : "";
      default:
        if (v == null || v === "") return c.empty ? <span className="text-slate-500">{c.empty}</span> : null;
        return String(v);
    }
  };

  const columns = useMemo<Column<Row>[]>(() => def.columns.map((c) => ({
    key: c.name, header: c.label, kind: KIND[c.kind ?? "text"], width: c.width === "1fr" ? undefined : c.width, className: c.kind === "badge" || c.kind === "dot" ? undefined : "truncate",
    value: (r: Row) => r[c.name], render: (r: Row) => cell(r, c),
  })), [def, lookups]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = useMemo(() => new Set<string | number>(selectedId != null ? [selectedId] : []), [selectedId]);

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
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        <DataTable
          label={`${def.title} list`} fixed rows={items} rowKey={(r) => r.id} columns={columns} selected={selected}
          onSelectedChange={(k) => { const id = [...k][0]; if (typeof id === "number") onSelect(id); }}
          onDelete={(rows) => { const id = rows[0].id; if (id !== selectedId) onSelect(id); else onDeleteSelected?.(); }} // first press selects, the next one asks to delete
          onEscape={() => document.querySelector<HTMLElement>("[data-zone=form] [data-nav]")?.focus()}
          empty={total === 0 ? "No records yet. Press F3 for a new one." : "No records match."}
        />
      </div>
      <div className="px-3 h-8 flex items-center border-t border-slate-300 text-[12px] text-slate-600">{items.length} of {total}</div>
    </aside>
  );
}
