import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calculator as CalculatorIcon, Delete, X } from "lucide-react";
import { evaluateCalculatorExpression, formatCalculatorValue } from "../lib/calculator";

type EditableField = HTMLInputElement | HTMLTextAreaElement;
type SavedFocus = { field: EditableField; start: number | null; end: number | null; direction: "forward" | "backward" | "none" | null };

const EDITABLE_INPUT_TYPES = new Set(["text", "search", "tel", "url", "email", "password", "number"]);
const isModalOpen = () => !!document.querySelector('[aria-modal="true"][role="dialog"], [aria-modal="true"][role="alertdialog"]');

function captureEditableField(element: Element | null): SavedFocus | null {
  if (!element || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return null;
  if (element.disabled || element.readOnly) return null;
  if (element instanceof HTMLInputElement && !EDITABLE_INPUT_TYPES.has(element.type)) return null;
  let start: number | null = null;
  let end: number | null = null;
  let direction: SavedFocus["direction"] = null;
  try {
    start = element.selectionStart;
    end = element.selectionEnd;
    direction = element.selectionDirection;
  } catch {
    // Number inputs do not expose text selection in every browser; insertion replaces their value.
  }
  return { field: element, start, end, direction };
}

function writeFieldValue(field: EditableField, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertResult(saved: SavedFocus | null, result: string) {
  if (!saved) return;
  const field = saved.field;
  if (!field.isConnected || field.disabled || field.readOnly) return;
  if (field instanceof HTMLInputElement && !EDITABLE_INPUT_TYPES.has(field.type)) return;

  const canSelectText = !(field instanceof HTMLInputElement && field.type === "number") && saved.start !== null && saved.end !== null;
  const isNumberInput = field instanceof HTMLInputElement && field.type === "number";
  const start = canSelectText ? Math.min(saved.start!, field.value.length) : isNumberInput ? 0 : field.value.length;
  const end = canSelectText ? Math.min(saved.end!, field.value.length) : field.value.length;
  const next = field.value.slice(0, start) + result + field.value.slice(end);
  writeFieldValue(field, next);
  field.focus();
  if (canSelectText) {
    try { field.setSelectionRange(start + result.length, start + result.length, "none"); } catch { /* Browser does not expose a selection for this input type. */ }
  }
}

function restoreFocus(saved: SavedFocus | null) {
  if (!saved) return;
  const field = saved.field;
  if (!field.isConnected) return;
  window.requestAnimationFrame(() => {
    if (!field.isConnected) return;
    field.focus();
    if (saved.start !== null && saved.end !== null && !(field instanceof HTMLInputElement && field.type === "number")) {
      try { field.setSelectionRange(saved.start, saved.end, saved.direction ?? undefined); } catch { /* Unsupported input type. */ }
    }
  });
}

const KEYS: { label: string; value?: string; action?: "clear" | "backspace" | "equals"; className?: string }[] = [
  { label: "AC", action: "clear", className: "text-rose-700" }, { label: "(", value: "(" }, { label: ")", value: ")" }, { label: "⌫", action: "backspace" },
  { label: "7", value: "7" }, { label: "8", value: "8" }, { label: "9", value: "9" }, { label: "÷", value: "÷", className: "text-blue-700" },
  { label: "4", value: "4" }, { label: "5", value: "5" }, { label: "6", value: "6" }, { label: "×", value: "×", className: "text-blue-700" },
  { label: "1", value: "1" }, { label: "2", value: "2" }, { label: "3", value: "3" }, { label: "−", value: "−", className: "text-blue-700" },
  { label: "%", value: "%" }, { label: "0", value: "0" }, { label: ".", value: "." }, { label: "+", value: "+", className: "text-blue-700" },
  { label: "±", value: "±" }, { label: "=", action: "equals", className: "col-span-3 bg-blue-700 text-white hover:bg-blue-800" },
];

export function GlobalCalculator() {
  const [open, setOpen] = useState(false);
  const [expression, setExpression] = useState("");
  const [showResult, setShowResult] = useState(false);
  const expressionInput = useRef<HTMLInputElement>(null);
  const savedFocus = useRef<SavedFocus | null>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const close = (restore = true) => {
    openRef.current = false;
    setOpen(false);
    if (restore) restoreFocus(savedFocus.current);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const hasCtrl = event.ctrlKey || event.metaKey;
      const plainCtrl = hasCtrl && !event.altKey && !event.shiftKey;

      if (plainCtrl && event.key === "0") {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (isModalOpen()) return;
        if (openRef.current) close();
        else {
          savedFocus.current = captureEditableField(document.activeElement);
          setExpression("");
          setShowResult(false);
          openRef.current = true;
          setOpen(true);
        }
        return;
      }
      if (!openRef.current || isModalOpen()) return;

      if (event.key === "Escape" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        close();
      } else if (plainCtrl && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const value = evaluateCalculatorExpression(expressionInput.current?.value ?? expression);
        if (value === null) {
          expressionInput.current?.setCustomValidity("Enter a valid arithmetic expression first.");
          expressionInput.current?.reportValidity();
          return;
        }
        insertResult(savedFocus.current, formatCalculatorValue(value));
        close(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [expression]);

  useEffect(() => {
    if (open) {
      window.requestAnimationFrame(() => expressionInput.current?.focus());
    }
  }, [open]);

  if (!open) return null;
  const value = evaluateCalculatorExpression(expression);
  const formattedResult = value === null ? "" : formatCalculatorValue(value);

  const changeExpression = (next: string) => {
    setExpression(next.slice(0, 256));
    setShowResult(false);
    expressionInput.current?.setCustomValidity("");
  };

  const insertKey = (key: string) => {
    const input = expressionInput.current;
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    let next = input.value;
    let caret = start;
    if (key === "±") {
      const current = input.value;
      const nextValue = current.startsWith("-") ? current.slice(1) : `-${current}`;
      changeExpression(nextValue);
      caret = nextValue.length;
    } else {
      next = input.value.slice(0, start) + key + input.value.slice(end);
      changeExpression(next);
      caret = start + key.length;
    }
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };

  const pressKey = (key: (typeof KEYS)[number]) => {
    if (key.action === "clear") { changeExpression(""); expressionInput.current?.focus(); return; }
    if (key.action === "backspace") {
      const input = expressionInput.current;
      if (!input) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const from = start === end ? Math.max(0, start - 1) : start;
      changeExpression(input.value.slice(0, from) + input.value.slice(end));
      requestAnimationFrame(() => { input.focus(); input.setSelectionRange(from, from); });
      return;
    }
    if (key.action === "equals") {
      if (value !== null) { changeExpression(formattedResult); setShowResult(true); }
      else expressionInput.current?.focus();
      return;
    }
    if (key.value) insertKey(key.value);
  };

  return createPortal(
    <section
      role="dialog" aria-label="Quick calculator" data-global-calculator
      className="fixed bottom-4 right-4 z-[80] w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-300 bg-white shadow-2xl shadow-slate-900/25 ring-1 ring-slate-900/5"
    >
      <header className="flex h-11 items-center justify-between bg-slate-900 px-3.5 text-white">
        <div className="flex items-center gap-2 text-[13px] font-semibold"><CalculatorIcon size={16} aria-hidden /> Quick calculator</div>
        <div className="flex items-center gap-2 text-[10px] text-slate-300"><kbd className="rounded border border-white/20 px-1 py-0.5">Ctrl+0</kbd><button type="button" onClick={() => close()} aria-label="Close calculator" className="grid h-7 w-7 place-items-center rounded hover:bg-white/10"><X size={16} /></button></div>
      </header>
      <div className="p-3.5">
        <input
          ref={expressionInput} value={expression} onChange={(event) => changeExpression(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.ctrlKey && !event.metaKey) { event.preventDefault(); if (value !== null) { changeExpression(formattedResult); setShowResult(true); } } }}
          aria-label="Calculator expression" placeholder="Type an expression, e.g. 8 × (2 + 3)"
          autoComplete="off" spellCheck={false} maxLength={256}
          className="h-11 w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-right font-mono text-[18px] text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
        />
        <div className="mt-2 flex min-h-7 items-center justify-between gap-2 px-1" aria-live="polite">
          <span className="text-[11px] text-slate-500">{showResult ? "Result" : expression ? "Output" : "Enter a calculation"}</span>
          <output className={`truncate font-mono text-[17px] font-semibold tabular-nums ${value === null ? "text-slate-400" : "text-slate-900"}`}>
            {value === null ? (expression ? "—" : "0") : formattedResult}
          </output>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {KEYS.map((key, index) => (
            <button
              key={`${key.label}-${index}`} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pressKey(key)}
              className={`h-10 rounded-md border border-slate-200 bg-slate-50 text-[15px] font-medium text-slate-800 transition-colors hover:bg-slate-100 active:bg-slate-200 ${key.className ?? ""}`}
            >
              {key.action === "backspace" ? <Delete size={17} className="mx-auto" aria-label="Backspace" /> : key.label}
            </button>
          ))}
        </div>
        <footer className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[10.5px] text-slate-500">
          <span>Esc closes without inserting</span><span><kbd className="kbd">Ctrl+Enter</kbd> insert & close</span>
        </footer>
      </div>
    </section>,
    document.body,
  );
}
