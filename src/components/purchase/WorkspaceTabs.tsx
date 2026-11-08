import { List, Plus, X } from "lucide-react";

export interface WorkspaceTab { id: number; title: string; dirty: boolean }

// The strip across the top of a purchase workspace: the document list first, then one tab for every document being entered or viewed.
export function WorkspaceTabs({ ariaLabel, listLabel, listCount, active, onList, tabs, onSelect, onClose, onNew, newTitle }: {
  ariaLabel: string; listLabel: string; listCount: number; active: "list" | number; onList: () => void;
  tabs: WorkspaceTab[]; onSelect: (id: number) => void; onClose: (id: number) => void; onNew: () => void; newTitle: string;
}) {
  const base = "relative flex h-9 items-center gap-2 rounded-t-lg border border-b-0 px-3.5 text-[13px] transition-colors";
  const tone = (selected: boolean) => selected
    ? "z-10 -mb-px border-slate-200 border-t-[3px] border-t-cobalt-700 bg-white font-semibold text-ink shadow-tab"
    : "border-transparent text-slate-600 hover:bg-white/60 hover:text-ink";
  return (
    <div role="tablist" aria-label={ariaLabel} className="lg-scroll flex shrink-0 items-end gap-1 overflow-x-auto border-b border-slate-200 bg-canvas px-5 pt-2.5">
      <button type="button" role="tab" aria-selected={active === "list"} onClick={onList} className={`${base} ${tone(active === "list")}`}>
        <List size={14} className={active === "list" ? "text-cobalt-700" : "text-slate-400"} /> {listLabel} <span className="lg-count">{listCount}</span>
      </button>
      {tabs.map((t) => {
        const selected = active === t.id;
        return (
          <div key={t.id} className={`${base} ${tone(selected)} pr-1.5`}>
            <button type="button" role="tab" aria-selected={selected} onClick={() => onSelect(t.id)} className="flex max-w-[190px] items-center gap-2 truncate font-[inherit]" title={t.title}>
              <span className="truncate font-mono text-[12.5px]">{t.title}</span>
              {t.dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" aria-label="unsaved changes" />}
            </button>
            <button type="button" onClick={() => onClose(t.id)} aria-label={`Close ${t.title} (Alt+W)`} title="Close tab (Alt+W)"
              className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-ink"><X size={12} /></button>
          </div>
        );
      })}
      <button type="button" onClick={onNew} title={newTitle} aria-label={newTitle}
        className="mb-1 ml-1 grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white hover:text-cobalt-700"><Plus size={16} /></button>
    </div>
  );
}

// What a list shows when nothing matches: say what to do next instead of leaving a blank panel.
export function EmptyList({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      <div className="max-w-[320px]">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400">{icon}</div>
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{hint}</p>
      </div>
    </div>
  );
}
