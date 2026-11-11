import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AvailableSeries } from "../api";

// "Choose numbering": opens when a new document starts and the module has more than one number series (cash / bank voucher, local / import bill ...).
// Reusable for every document type: it only needs the series the user may use (numberSeriesApi.available) and says which one was picked.
// ↑ ↓ choose · Enter or a double click picks · 1-9 picks that row · Esc takes the default (first) series.

export function NumberSeriesDialog({ title, items, onPick }: { title: string; items: AvailableSeries[]; onPick: (id: number) => void }) {
  const [at, setAt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.focus(); }, []);
  const pick = (i: number) => items[i] && onPick(items[i].id);

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3">
      <div
        ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className="flex w-[min(460px,96vw)] flex-col border border-slate-500 bg-white shadow-xl outline-none"
        onKeyDown={(e) => {
          e.stopPropagation(); // the screen behind must not see these keys
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(items.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(at); }
          else if (e.key === "Escape") { e.preventDefault(); pick(0); }
          else if (/^[1-9]$/.test(e.key) && Number(e.key) <= items.length) { e.preventDefault(); pick(Number(e.key) - 1); }
          else if (e.key === "Tab") e.preventDefault();
        }}
      >
        <div className="border-b border-slate-300 bg-slate-100 px-3 py-2">
          <h2 className="text-[14px] font-semibold text-slate-800">{title}</h2>
          <p className="text-[11px] text-slate-600">Choose the numbering for this document.</p>
        </div>
        <ul role="listbox" aria-label="Number series" className="max-h-[50vh] overflow-auto p-1">
          {items.map((x, i) => (
            <li
              key={x.id} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onDoubleClick={() => pick(i)} onClick={() => setAt(i)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-2 text-[13px] ${i === at ? "bg-blue-800 text-white" : "hover:bg-slate-100"}`}
            >
              <span><span className="mr-2 opacity-60">{i + 1}</span><b>{x.name}</b>{x.isDefault ? " ★" : ""}</span>
              <span className="font-mono text-[12px]">{x.problem ? "—" : x.mode === "MANUAL" ? "typed" : x.next}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-2 border-t border-slate-300 bg-slate-50 px-3 py-2">
          <button type="button" className="btn" onClick={() => pick(0)}>Default <span className="kbd">Esc</span></button>
          <button type="button" className="btn btn-primary" onClick={() => pick(at)}>Use this <span className="kbd">Enter</span></button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
