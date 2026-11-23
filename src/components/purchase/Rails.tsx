import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// A side panel that folds to a thin vertical strip on the edge it sits on. The folded strip shows the panel's name sideways;
// clicking it (or the arrow in the open panel's header) toggles. The choice is remembered per panel, in this browser.

export function useRail(key: string, initialCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    try { const v = localStorage.getItem(`rail:${key}`); return v === null ? initialCollapsed : v === "1"; } catch { return initialCollapsed; }
  });
  useEffect(() => { try { localStorage.setItem(`rail:${key}`, collapsed ? "1" : "0"); } catch { /* storage may be blocked: the panel just forgets */ } }, [key, collapsed]);
  return [collapsed, setCollapsed] as const;
}

export const RAIL_STRIP = 36;

export function RailPanel({ side, label, collapsed, onToggle, width = 320, shortcut, className = "", children }: {
  side: "left" | "right"; label: string; collapsed: boolean; onToggle: () => void; width?: number; shortcut?: string; className?: string; children: ReactNode;
}) {
  const Fold = side === "left" ? ChevronLeft : ChevronRight;   // points to the edge the panel folds into
  const Unfold = side === "left" ? ChevronRight : ChevronLeft;
  const hint = shortcut ? ` (${shortcut})` : "";
  return (
    <aside aria-label={label} data-rail={side} style={{ width: collapsed ? RAIL_STRIP : width }}
      className={`lg-card flex min-h-0 shrink-0 flex-col overflow-hidden transition-[width] duration-200 motion-reduce:transition-none ${className}`}>
      {collapsed ? (
        <button type="button" tabIndex={-1} aria-expanded={false} title={`Show ${label}${hint}`} onClick={onToggle}
          className="flex h-full w-full flex-col items-center gap-2 bg-cobalt-50 py-2 text-cobalt-800 hover:bg-cobalt-100">
          <Unfold size={14} />
          <span className="whitespace-nowrap text-[12px] font-semibold [writing-mode:vertical-rl]">{label}</span>
        </button>
      ) : (
        <>
          <header className="lg-card-head !min-h-[36px] !py-1">
            <h2 className="lg-card-title min-w-0 flex-1 truncate">{label}</h2>
            <button type="button" tabIndex={-1} aria-expanded title={`Hide ${label}${hint}`} onClick={onToggle} className="btn h-6 w-6 shrink-0 !p-0"><Fold size={14} /></button>
          </header>
          <div className="lg-scroll min-h-0 flex-1 overflow-auto">{children}</div>
        </>
      )}
    </aside>
  );
}
