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
  onCommit?: (el: HTMLInputElement) => void; // Enter se option chuna -> next field pe jao
  onBlurField?: () => void;
  fieldName: string;
  placeholder?: string;
  hasError?: boolean;
}

// Input me seedha type karo (extra search box nahi). Dropdown sirf focus/typing/ArrowDown par khulta hai
// aur absolute overlay hai, layout me jagah nahi leta.
export function Combobox({ value, options, onChange, onCommit, onBlurField, fieldName, placeholder, hasError }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const typed = query !== "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    if (q.length === 1) {
      const hk = options.find((o) => o.hotkey?.toLowerCase() === q); // A, L, E, R, X
      if (hk) return [hk];
    }
    const starts = options.filter((o) => o.label.toLowerCase().startsWith(q));
    return starts.length ? starts : options.filter((o) => o.label.toLowerCase().includes(q));
  }, [query, options]);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      e.stopPropagation(); // form ka Enter-next handler dobara na chale
      const o = filtered[Math.min(active, filtered.length - 1)];
      if (o) {
        pick(o);
        onCommit?.(e.currentTarget);
      }
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation(); // sirf dropdown band ho, form cancel na ho
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        data-nav
        data-field={fieldName}
        className={`fld pr-7 ${hasError ? "fld-err" : ""}`}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        placeholder={placeholder}
        value={typed ? query : (selected?.label ?? "")}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        }}
        onBlur={() => {
          if (typed && filtered.length) pick(filtered[Math.min(active, filtered.length - 1)]);
          setQuery("");
          setOpen(false);
          onBlurField?.();
        }}
        onKeyDown={onKeyDown}
      />
      <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      {open && (
        <ul
          role="listbox"
          onMouseDown={(e) => e.preventDefault()} // click par input blur na ho
          className="absolute z-30 left-0 right-0 top-full mt-px bg-white border border-slate-400 shadow-sm max-h-48 overflow-auto"
        >
          {filtered.length === 0 && <li className="px-2 py-1.5 text-slate-500">No match</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                pick(o);
                if (inputRef.current) onCommit?.(inputRef.current);
              }}
              className={`flex items-center gap-2 px-2 py-1 cursor-pointer ${i === active ? "bg-blue-100" : ""}`}
            >
              {o.hotkey && (
                <span className={`w-5 h-5 grid place-items-center text-[10px] font-bold border rounded-sm ${o.badge ?? ""}`}>
                  {o.hotkey}
                </span>
              )}
              <span>{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
