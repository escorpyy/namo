import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// A side panel that folds to a thin vertical strip. Open widths are remembered per view in this browser.
export function useRail(key: string, initialCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    try { const v = localStorage.getItem(`rail:${key}`); return v === null ? initialCollapsed : v === "1"; } catch { return initialCollapsed; }
  });
  useEffect(() => { try { localStorage.setItem(`rail:${key}`, collapsed ? "1" : "0"); } catch { /* storage may be blocked: the panel still works */ } }, [key, collapsed]);
  return [collapsed, setCollapsed] as const;
}

const MIN_WIDTH = 220;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 320;
export const RAIL_STRIP = 36;

const clampWidth = (width: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));

/** Persist a separate width for each panel view. Storage failures only mean the width is temporary. */
export function useRailWidth(key: string, initialWidth = DEFAULT_WIDTH) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(`rail-width:${key}`));
      return Number.isFinite(saved) && saved >= MIN_WIDTH && saved <= MAX_WIDTH ? saved : initialWidth;
    } catch { return initialWidth; }
  });
  const resize = useCallback((next: number) => {
    const value = clampWidth(next);
    setWidth(value);
    try { localStorage.setItem(`rail-width:${key}`, String(value)); } catch { /* resize still works for this visit */ }
  }, [key]);
  return [width, resize] as const;
}

export function RailPanel({ side, label, collapsed, onToggle, width = DEFAULT_WIDTH, onWidthChange, shortcut, className = "", children }: {
  side: "left" | "right"; label: string; collapsed: boolean; onToggle: () => void; width?: number; onWidthChange?: (width: number) => void; shortcut?: string; className?: string; children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const pointer = useRef<{ id: number; x: number; width: number } | null>(null);
  const Fold = side === "left" ? ChevronLeft : ChevronRight;
  const Unfold = side === "left" ? ChevronRight : ChevronLeft;
  const hint = shortcut ? ` (${shortcut})` : "";

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId || !onWidthChange) return;
    const delta = event.clientX - start.x;
    onWidthChange(start.width + (side === "right" ? -delta : delta));
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    pointer.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <aside aria-label={label} data-rail={side} style={{ width: collapsed ? RAIL_STRIP : width, maxWidth: collapsed ? undefined : "44vw" }}
      className={`lg-card relative flex min-h-0 shrink-0 flex-col overflow-hidden ${dragging ? "" : "transition-[width] duration-200 motion-reduce:transition-none"} ${className}`}>
      {collapsed ? (
        <button type="button" tabIndex={-1} aria-expanded={false} title={`Show ${label}${hint}`} onClick={onToggle}
          className="flex h-full w-full flex-col items-center gap-2 bg-cobalt-50 py-2 text-cobalt-800 hover:bg-cobalt-100">
          <Unfold size={14} />
          <span className="whitespace-nowrap text-[12px] font-semibold [writing-mode:vertical-rl]">{label}</span>
        </button>
      ) : (
        <>
          {onWidthChange && (
            <div role="separator" aria-label={`Resize ${label}`} aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width} tabIndex={0}
              title="Drag to resize; use the arrow keys for fine adjustment"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                pointer.current = { id: event.pointerId, x: event.clientX, width };
                setDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") { event.preventDefault(); onWidthChange(width + 16); }
                else if (event.key === "ArrowRight") { event.preventDefault(); onWidthChange(width - 16); }
                else if (event.key === "Home") { event.preventDefault(); onWidthChange(MIN_WIDTH); }
                else if (event.key === "End") { event.preventDefault(); onWidthChange(MAX_WIDTH); }
              }}
              className="group absolute inset-y-0 left-0 z-20 w-3 cursor-col-resize touch-none outline-none focus-visible:bg-cobalt-500/40">
              <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent group-hover:bg-cobalt-400 group-focus-visible:bg-cobalt-600" />
            </div>
          )}
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
