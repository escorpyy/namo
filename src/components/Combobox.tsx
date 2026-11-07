import { useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface ComboOption {
  value: string;
  label: string;
  hotkey?: string;
  badge?: string;
}

interface Props {
  value: string;
  options: ComboOption[];
  onChange: (v: string) => void;
  onCommit?: (el: HTMLInputElement, direction: 1 | -1) => void;
  onBlurField?: () => void;
  fieldName: string;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
  /**
   * Mandatory field: no empty row, Backspace/Delete cannot empty it, and Enter will not move on until a value is chosen.
   * Every combobox is optional unless it says `required`.
   */
  required?: boolean;
  /** Advanced override. By default the field is clearable exactly when it is not `required`. */
  allowClear?: boolean;
}

// Type in the input; the list is an overlay and opens as soon as the field is focused or clicked.
// Arrow keys move the highlight; Enter picks the highlighted row (once you typed or moved) and goes to the next field.
// Optional fields start with an empty "(none)" row; mandatory fields keep you here until you choose.
export function Combobox({ value, options, onChange, onCommit, onBlurField, fieldName, placeholder, hasError, disabled, required = false, allowClear }: Props) {
  const clearable = allowClear ?? !required;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  // True once the user moved the highlight with the keyboard: only then does Enter mean "take that row".
  const navigated = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    if (!clearable) return options;
    if (options.some((o) => o.value === "")) return options;
    return [{ value: "", label: placeholder?.trim() || "— (none)" }, ...options];
  }, [options, clearable, placeholder]);

  // An empty value shows as an empty box with the placeholder, never as the text of the "none" row.
  const selected = value === "" ? options.find((o) => o.value === "") : list.find((o) => o.value === value);
  const typed = query !== "";
  const invalid = hasError || (required && touched && value === "");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    if (q.length === 1) {
      const hk = list.find((o) => o.hotkey?.toLowerCase() === q);
      if (hk) return [hk];
    }
    const starts = list.filter((o) => o.label.toLowerCase().startsWith(q));
    return starts.length ? starts : list.filter((o) => o.label.toLowerCase().includes(q));
  }, [query, list]);

  const openList = () => {
    navigated.current = false;
    setActive(Math.max(0, list.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const pick = (o: ComboOption) => {
    if (o.value !== value) onChange(o.value);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      navigated.current = true;
      if (!open) openList();
      else setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      navigated.current = true;
      if (!open) openList();
      else setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      // Take the highlighted row when the user chose it (typed, moved, or Alt+Enter); a bare Enter keeps the current value.
      const row = open && (typed || navigated.current || e.altKey) ? filtered[Math.min(active, filtered.length - 1)] : undefined;
      const next = row ? row.value : value;
      if (row) pick(row);
      else if (open) { setOpen(false); setQuery(""); }
      // Mandatory and still empty: stay here and show the choices (Shift+Enter may still go back).
      if (required && next === "" && !e.shiftKey) {
        setTouched(true);
        setQuery("");
        openList();
        return;
      }
      onCommit?.(e.currentTarget, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    } else if ((e.key === "Backspace" || e.key === "Delete") && clearable && !typed && value) {
      // Empty the field and keep the choices on screen, so it can be refilled straight away.
      e.preventDefault();
      onChange("");
      setQuery("");
      setActive(0);
      setOpen(true);
    } else if ((e.altKey && e.key === "ArrowDown") || e.key === "F4") {
      e.preventDefault();
      e.stopPropagation();
      openList();
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        data-nav
        data-field={fieldName}
        className={`fld min-w-0 pr-7 ${invalid ? "fld-err" : ""} ${disabled ? "bg-slate-100 text-slate-600" : ""}`}
        autoComplete="off"
        disabled={disabled}
        role="combobox"
        title={selected?.label ?? placeholder}
        aria-expanded={open}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={typed ? query : (selected?.label ?? "")}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          setActive(0);
          navigated.current = false;
          // Typing away the whole label on an optional field empties the bound value.
          if (clearable && next === "" && value) onChange("");
        }}
        // Focus only selects the text; the list opens on the first keystroke (onChange), or on F4 / Alt+ArrowDown.
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (typed) {
            const q = query.trim().toLowerCase();
            const exact = list.find((o) => o.label.toLowerCase() === q);
            // An exact label, or a single remaining match, is an unambiguous choice; anything else is dropped.
            if (exact) pick(exact);
            else if (filtered.length === 1) pick(filtered[0]);
            else setQuery("");
          }
          setOpen(false);
          setTouched(true);
          onBlurField?.();
        }}
        onKeyDown={onKeyDown}
      />
      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      {open && !disabled && (
        <ul
          role="listbox"
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-30 left-0 right-0 top-full mt-px bg-white border border-slate-400 shadow-sm max-h-48 overflow-auto"
        >
          {filtered.length === 0 && <li className="px-2 py-1.5 text-slate-500">No match</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value === "" ? "__empty__" : o.value}
              ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                pick(o);
                if (inputRef.current) onCommit?.(inputRef.current, 1);
              }}
              title={o.label}
              className={`flex min-w-0 items-start gap-2 px-2 py-1.5 cursor-pointer whitespace-normal break-words leading-snug ${i === active ? "bg-blue-100" : ""} ${o.value === "" ? "text-slate-500 italic" : ""}`}
            >
              {o.hotkey && (
                <span className={`w-5 h-5 grid place-items-center text-[10px] font-bold border rounded-sm ${o.badge ?? ""}`}>
                  {o.hotkey}
                </span>
              )}
              <span className="min-w-0 break-words">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
