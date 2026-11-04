import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";

export interface ReferenceOption {
  value: string;
  label: string;
  short?: string;
  badge?: string;
  code?: string;
  name?: string;
  detail?: string;
  searchText?: string;
  isActive?: boolean;
}

interface Props {
  fieldName: string;
  label: string;
  value: string;
  options: ReferenceOption[];
  onChange: (value: string) => void;
  onCommit?: (el: HTMLInputElement, direction: 1 | -1) => void;
  onBlurField?: () => void;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
  scopeKey: string;
  contextKey?: string;
  /**
   * Mandatory field: no "None" row, Backspace/Delete cannot empty it, and Enter will not move on until something is chosen.
   * Every picker is optional unless it says `required`.
   */
  required?: boolean;
  /** Advanced override. By default the field is clearable exactly when it is not `required`. */
  allowClear?: boolean;
}

// The empty choice offered on optional fields.
const NONE: ReferenceOption = { value: "", label: "None", code: "—", name: "None (leave empty)" };

const RECENT_LIMIT = 8;
const textOf = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase();
interface PickerHistory { recent: string[]; counts: Record<string, number> }
const readHistory = (key: string): PickerHistory => {
  try {
    const stored = localStorage.getItem(key);
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (Array.isArray(parsed)) return { recent: parsed.filter((x): x is string => typeof x === "string"), counts: {} };
    if (parsed && typeof parsed === "object") {
      const data = parsed as { recent?: unknown; counts?: unknown };
      const counts = data.counts && typeof data.counts === "object"
        ? Object.fromEntries(Object.entries(data.counts).filter(([, count]) => typeof count === "number" && Number.isFinite(count))) as Record<string, number>
        : {};
      return { recent: Array.isArray(data.recent) ? data.recent.filter((x): x is string => typeof x === "string") : [], counts };
    }
    return { recent: [], counts: {} };
  } catch {
    return { recent: [], counts: {} };
  }
};

export function MasterReferencePicker({ fieldName, label, value, options, onChange, onCommit, onBlurField, placeholder, hasError, disabled, scopeKey, contextKey = "global", required = false, allowClear }: Props) {
  const clearable = allowClear ?? !required;
  const uid = useId().replace(/:/g, "");
  const dialogId = `master-picker-${uid}`;
  const titleId = `master-picker-title-${uid}`;
  const listId = `master-picker-list-${uid}`;
  const recentKey = `namo:master-picker:recent:${scopeKey}:${contextKey}`;
  const triggerRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findCode, setFindCode] = useState("");
  const [findName, setFindName] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [view, setView] = useState<"all" | "recent" | "frequent">("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [touched, setTouched] = useState(false);
  // Focusing the field opens the list; our own programmatic re-focus (after choose / close) must not reopen it.
  const suppressFocusOpen = useRef(false);
  // Enter picks the highlighted row only after the user typed, moved or the row is the current value; a bare Enter never picks "the first one".
  const navigated = useRef(false);
  const current = value === "" ? undefined : options.find((option) => option.value === value);
  const hasInactive = options.some((option) => option.isActive === false);

  const filtered = useMemo(() => {
    const q = textOf(query);
    const c = textOf(findCode);
    const n = textOf(findName);
    return options.filter((option) => {
      if (!includeInactive && option.isActive === false && option.value !== value) return false;
      if (view === "recent" && !recents.includes(option.value)) return false;
      if (view === "frequent" && (usageCounts[option.value] ?? 0) < 2) return false;
      const code = textOf(option.code ?? option.short);
      const name = textOf(option.name ?? option.label);
      const haystack = textOf([option.label, option.short, option.code, option.name, option.detail, option.searchText, option.badge].filter(Boolean).join(" "));
      return (!q || haystack.includes(q)) && (!c || code.includes(c)) && (!n || name.includes(n));
    }).sort((a, b) => {
      if (!q && !c && !n) {
        const ai = recents.indexOf(a.value), bi = recents.indexOf(b.value);
        if (view === "frequent") return (usageCounts[b.value] ?? 0) - (usageCounts[a.value] ?? 0) || (ai < 0 ? 1000 : ai) - (bi < 0 ? 1000 : bi);
        if (ai >= 0 || bi >= 0) return (ai < 0 ? 1000 : ai) - (bi < 0 ? 1000 : bi);
      }
      return 0;
    });
  }, [options, value, query, findCode, findName, includeInactive, recents, usageCounts, view]);

  // Optional fields get an explicit "None" row on top of the unfiltered list.
  const showNone = clearable && !query && !findCode && !findName && view === "all";
  const rows = useMemo(() => (showNone ? [NONE, ...filtered] : filtered), [showNone, filtered]);

  // Give focus back to the field without that focus reopening the list.
  const refocusTrigger = (after?: (el: HTMLInputElement) => void) => {
    requestAnimationFrame(() => {
      const el = triggerRef.current;
      if (!el) return;
      suppressFocusOpen.current = true;
      el.focus();
      suppressFocusOpen.current = false;
      after?.(el);
    });
  };

  const openDialog = (initialQuery = "") => {
    if (disabled) return;
    navigated.current = false;
    setQuery(initialQuery);
    setFindOpen(false);
    setFindCode("");
    setFindName("");
    setIncludeInactive(false);
    const history = readHistory(recentKey);
    setRecents(history.recent);
    setUsageCounts(history.counts);
    setView("all");
    setActiveIndex(0);
    setOpen(true);
  };

  const closeDialog = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) refocusTrigger();
  };

  const choose = (option: ReferenceOption, direction: 1 | -1 = 1) => {
    if (option.value === "") {
      // "None": only offered on optional fields.
      if (!clearable) return;
      if (value !== "") onChange("");
    } else {
      if (option.value !== value) onChange(option.value);
      const history = readHistory(recentKey);
      const nextRecents = [option.value, ...history.recent.filter((id) => id !== option.value)].slice(0, RECENT_LIMIT);
      const updatedCounts = { ...history.counts, [option.value]: (history.counts[option.value] ?? 0) + 1 };
      const nextCounts = Object.fromEntries(Object.entries(updatedCounts).sort((a, b) => b[1] - a[1]).slice(0, 50));
      try { localStorage.setItem(recentKey, JSON.stringify({ recent: nextRecents, counts: nextCounts })); } catch { /* storage can be unavailable in private browsing */ }
      setRecents(nextRecents);
      setUsageCounts(nextCounts);
    }
    setOpen(false);
    refocusTrigger((el) => onCommit?.(el, direction));
  };

  // Clear and move on (the dialog's "None / Clear" button).
  const clearValue = (direction: 1 | -1) => {
    if (!clearable) return;
    if (value !== "") onChange("");
    setOpen(false);
    refocusTrigger((el) => onCommit?.(el, direction));
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // On open, start on the current value (or "None" for an empty optional field), not blindly on row 0.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(query ? 0 : Math.max(0, rows.findIndex((row) => row.value === value)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    setActiveIndex((index) => rows.length ? Math.min(index, rows.length - 1) : 0);
  }, [rows.length]);

  useEffect(() => {
    if (!open || !rows[activeIndex]) return;
    resultsRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, rows, open]);

  const selectActive = (direction: 1 | -1 = 1) => {
    const option = rows[activeIndex];
    if (!option) return;
    // Mandatory + still empty: Enter must not silently pick whatever is first. The user has to type, move or click.
    if (required && value === "" && !query && !findCode && !findName && !navigated.current) return;
    choose(option, direction);
  };

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
      return;
    }
    if (event.key === "Tab") {
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((el) => el.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  const activeOption = rows[activeIndex];
  const currentLabel = current?.label ?? "";
  const invalid = hasError || (required && touched && value === "");
  const clearFilters = () => { setQuery(""); setFindCode(""); setFindName(""); setIncludeInactive(false); setView("all"); searchRef.current?.focus(); };

  return (
    <>
      <div className="relative">
        <input
          ref={triggerRef}
          data-nav
          data-field={fieldName}
          type="text"
          readOnly
          autoComplete="off"
          role="combobox"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          title={currentLabel || placeholder}
          placeholder={placeholder}
          disabled={disabled}
          value={currentLabel}
          onFocus={() => {
            // Landing on the field shows the choices straight away.
            if (suppressFocusOpen.current || disabled || open) return;
            openDialog();
          }}
          onClick={() => { if (!open) openDialog(); }}
          onBlur={() => {
            // The list taking focus is not "leaving the field".
            if (open) return;
            setTouched(true);
            onBlurField?.();
          }}
          onKeyDown={(event) => {
            // Enter / Shift+Enter = next / previous field (keyboard-first form flow).
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              // Mandatory and still empty: do not move forward, show the choices instead.
              if (required && value === "" && !event.shiftKey) { setTouched(true); openDialog(); return; }
              onCommit?.(event.currentTarget, event.shiftKey ? -1 : 1);
              return;
            }
            // Open picker: Space, ArrowDown, Alt+ArrowDown, or F4.
            if (event.key === " " || event.key === "ArrowDown" || event.key === "F4" || (event.altKey && event.key === "ArrowDown")) {
              event.preventDefault();
              event.stopPropagation();
              openDialog();
              return;
            }
            // Optional fields: Backspace / Delete empties the value, and the choices come straight back up.
            if (clearable && value && (event.key === "Backspace" || event.key === "Delete")) {
              event.preventDefault();
              event.stopPropagation();
              onChange("");
              openDialog();
              return;
            }
            // Typing a character opens the dialog pre-filtered.
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
              event.preventDefault();
              event.stopPropagation();
              openDialog(event.key);
            }
          }}
          className={`fld min-w-0 pr-8 text-left ${invalid ? "fld-err" : ""} ${disabled ? "bg-slate-100 text-slate-600" : "cursor-pointer"}`}
        />
        <ChevronDown size={14} aria-hidden="true" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>

      {open && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-0 sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section
            ref={dialogRef}
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={onDialogKeyDown}
            className="flex h-full max-h-full w-full max-w-none flex-col overflow-hidden border border-slate-500 bg-white shadow-2xl sm:h-auto sm:max-h-[min(88vh,760px)] sm:max-w-3xl"
          >
            <header className="flex items-center justify-between gap-3 border-b border-slate-300 bg-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h2 id={titleId} className="truncate text-base font-semibold">Choose {label}</h2>
                <p className="text-xs text-slate-600">Search, use Find for specific fields, then choose a result. Enter moves to the next field on the form; open this list with Space or ↓.</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {clearable && (
                  <button type="button" className="btn h-8" title="Clear selection" onClick={() => clearValue(1)}>
                    None / Clear
                  </button>
                )}
                <button type="button" className="btn h-8" aria-label="Close picker" title="Close (Escape)" onClick={() => closeDialog()}><X size={15} /></button>
              </div>
            </header>

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-3">
              <div className="relative min-w-[190px] flex-1">
                <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  ref={searchRef}
                  id={`master-picker-search-${uid}`}
                  type="search"
                  role="combobox"
                  aria-label={`Search ${label}`}
                  aria-autocomplete="list"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-activedescendant={activeOption ? `${listId}-option-${activeOption.value || "none"}` : undefined}
                  autoComplete="off"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") { event.preventDefault(); navigated.current = true; setActiveIndex((index) => Math.min(index + 1, rows.length - 1)); }
                    else if (event.key === "ArrowUp") { event.preventDefault(); navigated.current = true; setActiveIndex((index) => Math.max(index - 1, 0)); }
                    else if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); selectActive(event.shiftKey ? -1 : 1); }
                    else if (event.key === "Home" && event.ctrlKey) { event.preventDefault(); navigated.current = true; setActiveIndex(0); }
                    else if (event.key === "End" && event.ctrlKey) { event.preventDefault(); navigated.current = true; setActiveIndex(Math.max(0, rows.length - 1)); }
                  }}
                  placeholder={`Search ${label} by code or name…`}
                  className="fld h-10 w-full pl-8"
                />
              </div>
              <button type="button" className={`btn h-10 ${findOpen ? "bg-blue-50" : ""}`} aria-expanded={findOpen} aria-controls={`master-picker-find-${uid}`} onClick={() => { setFindOpen((v) => !v); if (!findOpen) setTimeout(() => document.getElementById(`master-picker-find-code-${uid}`)?.focus(), 0); }}>
                <SlidersHorizontal size={14} /> Find
              </button>
            </div>

            <div role="group" aria-label="Reference result views" className="flex gap-1 border-b border-slate-200 px-3 py-2">
              {(["all", "recent", "frequent"] as const).map((mode) => {
                const count = mode === "all" ? options.length : mode === "recent" ? recents.filter((id) => options.some((option) => option.value === id)).length : options.filter((option) => (usageCounts[option.value] ?? 0) >= 2).length;
                const caption = mode === "all" ? "All" : mode === "recent" ? "Recent" : "Frequent";
                return <button key={mode} type="button" aria-pressed={view === mode} onClick={() => { setView(mode); setActiveIndex(0); }} className={`btn h-8 ${view === mode ? "bg-blue-100 font-semibold" : ""}`}>{caption}<span className="ml-1 text-[11px] text-slate-500">{count}</span></button>;
              })}
            </div>

            {findOpen && (
              <div id={`master-picker-find-${uid}`} className="grid grid-cols-1 gap-2 border-b border-slate-200 bg-slate-50 px-3 py-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-700">Code
                  <input id={`master-picker-find-code-${uid}`} value={findCode} onChange={(event) => { setFindCode(event.target.value); setActiveIndex(0); }} placeholder="Contains…" className="fld mt-1 h-9 w-full" />
                </label>
                <label className="text-xs font-medium text-slate-700">Name / description
                  <input value={findName} onChange={(event) => { setFindName(event.target.value); setActiveIndex(0); }} placeholder="Contains…" className="fld mt-1 h-9 w-full" />
                </label>
                <div className="flex items-center justify-between gap-3 sm:col-span-2">
                  {hasInactive ? <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} /> Include inactive records</label> : <span />}
                  <button type="button" className="btn h-8" onClick={clearFilters}>Clear filters</button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-600" aria-live="polite" aria-atomic="true">
              <span>{filtered.length} result{filtered.length === 1 ? "" : "s"}{!query && !findCode && !findName && recents.some((id) => filtered.some((item) => item.value === id)) ? " · Recent selections first" : ""}</span>
              <span className="hidden sm:inline"><kbd className="kbd">↑ ↓</kbd> move <kbd className="kbd">Enter</kbd> select <kbd className="kbd">Esc</kbd> close</span>
            </div>

            <div ref={resultsRef} className="min-h-0 flex-1 overflow-auto border-y border-slate-200">
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(70px,0.7fr)_minmax(120px,1.5fr)_64px] gap-2 border-b border-slate-300 bg-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 sm:grid-cols-[minmax(90px,0.8fr)_minmax(150px,1.5fr)_minmax(100px,1fr)_76px]">
                <span>Code</span><span>Name / description</span><span className="hidden sm:block">Details</span><span>Status</span>
              </div>
              <div id={listId} role="listbox" aria-label={`${label} results`} aria-activedescendant={activeOption ? `${listId}-option-${activeOption.value || "none"}` : undefined}>
                {rows.map((option, index) => {
                    const isNone = option.value === "";
                    const isCurrent = option.value === value;
                    const isRecent = !isNone && !query && !findCode && !findName && recents.includes(option.value);
                    const isFrequent = !isNone && (usageCounts[option.value] ?? 0) >= 2;
                    const code = option.code ?? option.short ?? "—";
                    const name = option.name ?? option.label;
                    if (isNone) {
                      return (
                        <div
                          id={`${listId}-option-none`}
                          key="__none__"
                          role="option"
                          aria-selected={isCurrent}
                          data-active={index === activeIndex || undefined}
                          onMouseEnter={() => setActiveIndex(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(option)}
                          className={`cursor-pointer border-b border-slate-200 px-3 py-3 text-sm italic text-slate-600 hover:bg-blue-50 ${index === activeIndex ? "bg-blue-100 outline outline-2 -outline-offset-2 outline-blue-600" : ""} ${isCurrent ? "font-semibold" : ""}`}
                        >
                          — None (leave empty){isCurrent ? " · Current" : ""}
                        </div>
                      );
                    }
                    return (
                      <div
                        id={`${listId}-option-${option.value}`}
                        key={option.value}
                        role="option"
                        aria-selected={isCurrent}
                        data-active={index === activeIndex || undefined}
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => choose(option)}
                        className={`grid cursor-pointer grid-cols-[minmax(70px,0.7fr)_minmax(120px,1.5fr)_64px] gap-2 border-b border-slate-100 px-3 py-3 text-sm last:border-b-0 hover:bg-blue-50 sm:grid-cols-[minmax(90px,0.8fr)_minmax(150px,1.5fr)_minmax(100px,1fr)_76px] ${index === activeIndex ? "bg-blue-100 outline outline-2 -outline-offset-2 outline-blue-600" : ""} ${isCurrent ? "font-semibold" : ""}`}
                      >
                        <span className="min-w-0 break-words font-mono text-[12px]">{code}{isRecent && <span className="ml-1 font-sans text-[10px] font-normal text-blue-700">Recent</span>}{isFrequent && <span className="ml-1 font-sans text-[10px] font-normal text-slate-600">Often used</span>}</span>
                        <span className="min-w-0 break-words">{name}{option.badge && <span className="ml-2 inline-block rounded border border-slate-300 px-1 text-[10px] font-normal text-slate-600">{option.badge}</span>}</span>
                        <span className="hidden min-w-0 break-words text-xs text-slate-600 sm:block">{option.detail || "—"}</span>
                        <span className={`text-xs ${option.isActive === false ? "font-medium text-amber-800" : "text-slate-500"}`}>{option.isActive === false ? "Inactive" : "Active"}{isCurrent ? " · Current" : ""}</span>
                      </div>
                    );
                })}
              </div>
              {!filtered.length && (
                <div className="px-5 py-10 text-center" role="status">
                  <p className="font-medium text-slate-800">No {label.toLocaleLowerCase()} match those filters.</p>
                  <p className="mt-1 text-sm text-slate-600">{view === "frequent" ? "A record appears here after you select it at least twice." : "Try a shorter search, clear Find filters, or include inactive records."}</p>
                  <button type="button" className="btn mt-3 h-8" onClick={clearFilters}>Clear search and filters</button>
                </div>
              )}
            </div>

            <footer className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-3">
              <p className="text-xs text-slate-600">Search is ready on open. Press <kbd className="kbd">Alt+↓</kbd> on the field to open.</p>
              <div className="flex gap-2">
                <button type="button" className="btn h-9" onClick={() => closeDialog()}>Cancel</button>
                <button type="button" className="btn btn-primary h-9" disabled={!activeOption} onClick={() => selectActive()}>Select{activeOption ? `: ${activeOption.code ?? activeOption.short ?? activeOption.label}` : ""}</button>
              </div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
