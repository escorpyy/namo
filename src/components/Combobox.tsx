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
  /** When true, an empty "(none)" row is offered and Backspace/Delete clears the value. */
  allowClear?: boolean;
}

// Type in the input; dropdown is an overlay. Enter always moves to the next/previous field.
// Open / navigate the list with ArrowDown / ArrowUp; confirm a highlighted row with Alt+Enter.
export function Combobox({ value, options, onChange, onCommit, onBlurField, fieldName, placeholder, hasError, disabled, allowClear }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useMemo(() => {
    if (!allowClear) return options;
    if (options.some((o) => o.value === "")) return options;
    return [{ value: "", label: placeholder?.trim() || "— (none)" }, ...options];
  }, [options, allowClear, placeholder]);

  const selected = list.find((o) => o.value === value);
  const typed = query !== "";

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

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  };

  const clear = () => {
    if (!allowClear) return;
    onChange("");
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setOpen(true);
        setActive(Math.max(0, filtered.findIndex((o) => o.value === value)));
      } else {
        setActive((a) => Math.min(a + 1, Math.max(filtered.length - 1, 0)));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (open) setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      // Enter / Shift+Enter = next / previous field (keyboard-first). Confirm a list row with Alt+Enter.
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey && open) {
        const o = filtered[Math.min(active, filtered.length - 1)];
        if (o) pick(o);
      } else if (open) {
        setOpen(false);
        setQuery("");
      }
      onCommit?.(e.currentTarget, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    } else if ((e.key === "Backspace" || e.key === "Delete") && allowClear && !typed && value) {
      e.preventDefault();
      clear();
    } else if ((e.altKey && e.key === "ArrowDown") || e.key === "F4") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
      setActive(Math.max(0, list.findIndex((o) => o.value === value)));
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        data-nav
        data-field={fieldName}
        className={`fld min-w-0 pr-7 ${hasError ? "fld-err" : ""} ${disabled ? "bg-slate-100 text-slate-600" : ""}`}
        autoComplete="off"
        disabled={disabled}
        role="combobox"
        title={selected?.label ?? placeholder}
        aria-expanded={open}
        placeholder={placeholder}
        value={typed ? query : (selected?.label ?? "")}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          setActive(0);
          // Typing away the whole label with allowClear clears the bound value.
          if (allowClear && next === "" && value) onChange("");
        }}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
          setActive(Math.max(0, list.findIndex((o) => o.value === value)));
        }}
        onBlur={() => {
          // Do not auto-pick on blur: optional fields must stay clearable.
          if (typed) {
            const exact = filtered.find((o) => o.label.toLowerCase() === query.trim().toLowerCase());
            if (exact) pick(exact);
            else if (allowClear && query.trim() === "") clear();
            else setQuery("");
          }
          setOpen(false);
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
