/**
 * A narration / remarks field with a list of ready-made texts behind the Down arrow.
 *
 *   <NarrationInput companyId={p.companyId} value={f.remarks} onText={(v) => patch({ remarks: v })} maxLength={1024} data-field="remarks" />
 *
 * Type as usual: nothing changes. Press ↓ and a dialog lists the company's Narration Master; type to narrow it, ↑ ↓ to move, Enter or a
 * click to take a row (its text replaces the field), Esc to leave the field as it was. Everything else on the field (data-field, className,
 * disabled, maxLength ...) is passed straight to the <input> / <textarea>.
 *
 * ↓ is only taken when there is something to offer and it would not be needed for moving: with an empty master the key keeps its normal
 * job (a grid moves to the next row), and in a multi-line box ↓ still moves the caret until it is on the last line.
 */
import { useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ensureNarrations, useNarrations, type NarrationEntry } from "../lib/narrations";

type Props = Omit<ComponentPropsWithoutRef<"input">, "value" | "onChange" | "type"> & {
  companyId: number;
  value: string;
  /** Called with the new text, typed or picked. */
  onText: (v: string) => void;
  /** A <textarea> instead of a single-line <input>. */
  multiline?: boolean;
  rows?: number;
};

export function NarrationInput({ companyId, value, onText, multiline, rows, onKeyDown, onFocus, placeholder, maxLength, ...rest }: Props) {
  const entries = useNarrations(companyId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const keyDown = (e: KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== "ArrowDown" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.nativeEvent.isComposing) return; // an input method (Nepali, Hindi ...) is using the arrow keys
    const el = e.currentTarget;
    if (el.disabled || el.readOnly || entries.length === 0) return;
    // In a multi-line box ↓ moves the caret; the list opens once the caret is at the end of the text.
    if (multiline && (el.selectionEnd ?? el.value.length) < el.value.length) return;
    e.preventDefault();
    e.stopPropagation(); // not for the grid around the field, which would move to the next row
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    // after the dialog has gone, so its own focus hand-back does not win
    setTimeout(() => { const el = ref.current; if (el?.isConnected) { el.focus(); const n = el.value.length; el.setSelectionRange(n, n); } }, 0);
  };
  const pick = (text: string) => { onText(maxLength != null && maxLength > 0 ? text.slice(0, maxLength) : text); close(); };

  const common = {
    ...rest,
    value, maxLength, autoComplete: "off",
    placeholder: entries.length && placeholder && !value ? `${placeholder} (↓ for list)` : placeholder,
    onChange: (e: { target: { value: string } }) => onText(e.target.value),
    onKeyDown: keyDown,
    onFocus: (e: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => { void ensureNarrations(companyId); onFocus?.(e); },
  };
  return (
    <>
      {multiline ? <textarea ref={ref} rows={rows} {...(common as object)} /> : <input ref={ref} type="text" {...common} />}
      {open && <NarrationPicker entries={entries} current={value} onPick={pick} onClose={close} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------------------------------------------------

const match = (e: NarrationEntry, q: string) => e.code.toLowerCase().includes(q) || e.narration.toLowerCase().includes(q);

/** Rows matching the search: those whose code starts with it first, then the rest, each group in master order. */
export function filterNarrations(entries: NarrationEntry[], query: string): NarrationEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const first = entries.filter((e) => e.code.toLowerCase().startsWith(q));
  return [...first, ...entries.filter((e) => !first.includes(e) && match(e, q))];
}

export function NarrationPicker({ entries, current, onPick, onClose }: { entries: NarrationEntry[]; current: string; onPick: (text: string) => void; onClose: () => void }) {
  // Start from what is typed in the field, so "pay" then ↓ shows the matching rows. If that matches nothing, or the field already holds
  // one of the texts, show them all (with the held one highlighted) instead of an empty or one-row list.
  const [initial] = useState(() => {
    const typed = current.trim();
    const held = entries.findIndex((e) => e.narration === current);
    return typed && held < 0 && filterNarrations(entries, typed).length ? { query: typed, active: 0 } : { query: "", active: Math.max(held, 0) };
  });
  const [query, setQuery] = useState(initial.query);
  const [active, setActive] = useState(initial.active);
  const rows = useMemo(() => filterNarrations(entries, query), [entries, query]);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const live = useRef({ rows, active, onPick, onClose });
  live.current = { rows, active, onPick, onClose };

  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => { setActive((a) => Math.min(a, Math.max(rows.length - 1, 0))); }, [rows.length]);
  useEffect(() => { listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" }); }, [active, rows]);

  // Capture phase on the window, like the application's other dialogs: the shortcuts of the screen behind (Ctrl+S, F-keys ...) must not
  // fire while this is open. Typing in the search box still works, because only the event's travel is stopped, not its default action.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const { rows: r, active: a } = live.current;
      const move = (to: number) => { e.preventDefault(); setActive(Math.max(0, Math.min(to, r.length - 1))); };
      if (e.key === "Escape") { e.preventDefault(); live.current.onClose(); }
      else if (e.isComposing) { /* confirming an input-method composition: not ours */ }
      else if (e.key === "ArrowDown") move(a + 1);
      else if (e.key === "ArrowUp") move(a - 1);
      else if (e.key === "PageDown") move(a + 8);
      else if (e.key === "PageUp") move(a - 8);
      else if (e.key === "Enter") { e.preventDefault(); if (r[a]) live.current.onPick(r[a].narration); }
      else if (e.key === "Tab") e.preventDefault(); // the search box is the only stop
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/45 p-4 pt-[12vh] backdrop-blur-[3px] animate-dialog-fade motion-reduce:animate-none"
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); onClose(); } }}
    >
      <div role="dialog" aria-modal="true" aria-label="Select narration" className="w-full max-w-[580px] overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-900/25 ring-1 ring-slate-900/10 animate-dialog-pop motion-reduce:animate-none">
        <div className="h-1 bg-cobalt-600" />
        <div className="px-5 pb-2 pt-4">
          <h2 className="text-[15px] font-semibold text-slate-900">Select narration</h2>
          <input
            ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} autoComplete="off" spellCheck={false}
            placeholder="Type a code or part of the text…" aria-label="Search narrations" role="combobox" aria-expanded="true" aria-controls="narration-list"
            aria-activedescendant={rows[active] ? `narration-${rows[active].id}` : undefined}
            className="fld mt-2.5 w-full"
          />
        </div>
        <div ref={listRef} id="narration-list" role="listbox" className="max-h-[46vh] overflow-y-auto border-t border-slate-100 py-1">
          {rows.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px] text-slate-500">No narration matches “{query.trim()}”. Clear the search to see them all.</p>
          ) : rows.map((e, i) => (
            <button
              key={e.id} id={`narration-${e.id}`} type="button" role="option" aria-selected={i === active} data-active={i === active}
              tabIndex={-1} onMouseDown={(ev) => ev.preventDefault()} onMouseMove={() => i !== active && setActive(i)} onClick={() => onPick(e.narration)}
              className={`flex w-full items-baseline gap-3 px-5 py-2 text-left ${i === active ? "bg-cobalt-50" : "hover:bg-slate-50"}`}
            >
              <span className="w-[72px] shrink-0 truncate font-mono text-[12px] font-semibold text-slate-500">{e.code}</span>
              <span className="min-w-0 flex-1 break-words text-[13.5px] leading-snug text-slate-800">{e.narration}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50 px-5 py-2.5 text-[11.5px] text-slate-400">
          <span><kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> move</span>
          <span><kbd className="kbd">Enter</kbd> use</span>
          <span><kbd className="kbd">Esc</kbd> keep typing</span>
          <span className="ml-auto">{rows.length} of {entries.length}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
