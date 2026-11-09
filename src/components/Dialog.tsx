/**
 * The one dialog box of the application: every error, warning, notice, confirmation and question is shown with it.
 *
 *   const dialog = useDialog();                       // needs <DialogProvider> (mounted once in main.tsx)
 *   await dialog.error("Cannot reach the server.");   // red, OK button
 *   await dialog.warning("Fix the highlighted fields.");
 *   if (!(await dialog.confirm("Delete this bill?", { variant: "danger", confirmLabel: "Delete" }))) return;
 *   const reason = await dialog.prompt("Reason for reversing:", { required: true });   // string, or null when cancelled
 *
 * Every dialog closes with Esc, takes the keyboard while it is open (so Ctrl+S, F-keys or Esc never reach the screen behind it),
 * traps Tab inside itself and gives focus back to where it was. Several requests queue up and show one after the other.
 *
 * Screens that need their own set of buttons (Save / Discard / Stay) render <Dialog spec={...} /> directly.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleHelp, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";

export type DialogVariant = "error" | "warning" | "info" | "success" | "confirm" | "danger";

export interface DialogSpec {
  title: string;
  body: ReactNode;
  /** Colour and icon. Left out: "danger" when a button is destructive, "info" for a lone OK, otherwise "confirm". */
  variant?: DialogVariant;
  buttons: { label: string; kind: "primary" | "danger" | "neutral"; onClick: () => void; autoFocus?: boolean }[];
  /** Esc. Defaults to the onClose the dialog was given. */
  onCancel?: () => void;
}

// ---------------------------------------------------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------------------------------------------------

const TONES: Record<DialogVariant, { Icon: LucideIcon; bar: string; badge: string; primary: string; title: string }> = {
  error: { Icon: CircleX, bar: "bg-rose-500", badge: "bg-rose-100 text-rose-600", primary: "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500/50", title: "Error" },
  warning: { Icon: TriangleAlert, bar: "bg-amber-500", badge: "bg-amber-100 text-amber-600", primary: "bg-amber-700 hover:bg-amber-800 focus-visible:ring-amber-500/50", title: "Warning" },
  info: { Icon: Info, bar: "bg-cobalt-600", badge: "bg-cobalt-100 text-cobalt-700", primary: "bg-cobalt-700 hover:bg-cobalt-800 focus-visible:ring-cobalt-600/50", title: "Information" },
  success: { Icon: CircleCheck, bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-600", primary: "bg-emerald-700 hover:bg-emerald-800 focus-visible:ring-emerald-500/50", title: "Done" },
  confirm: { Icon: CircleHelp, bar: "bg-cobalt-600", badge: "bg-cobalt-100 text-cobalt-700", primary: "bg-cobalt-700 hover:bg-cobalt-800 focus-visible:ring-cobalt-600/50", title: "Please confirm" },
  danger: { Icon: TriangleAlert, bar: "bg-rose-500", badge: "bg-rose-100 text-rose-600", primary: "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500/50", title: "Are you sure?" },
};

const BTN = "inline-flex h-9 min-w-[88px] items-center justify-center rounded-lg px-4 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50";
const BTN_NEUTRAL = "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-slate-400/60";
const BTN_DANGER = "bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/50";

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Dialogs that are open right now, newest last: only the newest one answers the keyboard. */
const openStack: symbol[] = [];

// ---------------------------------------------------------------------------------------------------------------------
// The dialog box
// ---------------------------------------------------------------------------------------------------------------------

export function Dialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [returnTo] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  const escape = useRef<() => void>(onClose);
  escape.current = spec.onCancel ?? onClose;

  const variant: DialogVariant = spec.variant ?? (spec.buttons.some((b) => b.kind === "danger") ? "danger" : spec.buttons.length === 1 ? "info" : "confirm");
  const tone = TONES[variant];
  const Icon = tone.Icon;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const id = Symbol("dialog");
    openStack.push(id);

    const focusInitial = () => {
      (root.querySelector<HTMLElement>("[data-af]") ?? root.querySelector<HTMLElement>('[data-kind="primary"], [data-kind="danger"]') ?? root.querySelector<HTMLElement>("button"))?.focus();
    };
    focusInitial();

    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && root.contains(active);

      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        escape.current();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const list = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (list.length) list[inside ? (list.indexOf(active!) + (e.shiftKey ? -1 : 1) + list.length) % list.length : 0].focus();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && inside && active instanceof HTMLButtonElement) {
        e.preventDefault();
        const btns = Array.from(root.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        btns[(btns.indexOf(active) + (e.key === "ArrowLeft" ? -1 : 1) + btns.length) % btns.length]?.focus();
      } else if (e.key === "Enter" && inside && active instanceof HTMLInputElement) {
        e.preventDefault(); // Enter in a text box answers the question
        root.querySelector<HTMLElement>('[data-kind="primary"], [data-kind="danger"]')?.click();
      } else if ((e.key === "y" || e.key === "Y") && inside && active?.dataset.kind === "danger" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); // Y confirms only while the destructive button has the focus
        active.click();
      } else if (!inside && e.key.length > 1 && !["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) {
        focusInitial(); // focus had slipped out (a click on the backdrop): bring it back
      }
      // Capture phase: the shortcuts of the screen behind (Ctrl+S, F2, Esc ...) must not fire while a dialog is open. Typing still works.
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown, true);

    // Screens often focus a field right after raising an error ("go to the first invalid field"). While the dialog is open that focus is
    // held back inside the dialog, and given to the field once the dialog closes, so that behaviour survives.
    let wanted: HTMLElement | null = null;
    const onFocusIn = (e: FocusEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      const target = e.target as HTMLElement | null;
      if (!target || root.contains(target)) return;
      wanted = target;
      focusInitial();
    };
    document.addEventListener("focusin", onFocusIn);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      const at = openStack.indexOf(id);
      if (at >= 0) openStack.splice(at, 1);
      // Hand the focus back, unless the button that closed the dialog already moved it somewhere on purpose.
      setTimeout(() => {
        const a = document.activeElement;
        const back = wanted?.isConnected ? wanted : returnTo;
        if ((!a || a === document.body) && back?.isConnected) back.focus();
      }, 0);
    };
  }, [returnTo]);

  const role = variant === "info" || variant === "success" ? "dialog" : "alertdialog";
  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[3px] animate-dialog-fade motion-reduce:animate-none"
      onMouseDown={(e) => { if (e.target === e.currentTarget) e.preventDefault(); }}
    >
      <div
        ref={ref} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId} data-variant={variant}
        className="relative w-full max-w-[440px] overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-900/25 ring-1 ring-slate-900/10 animate-dialog-pop motion-reduce:animate-none"
      >
        <div className={`h-1 ${tone.bar}`} />
        <div className="flex gap-4 px-6 pb-5 pt-5">
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone.badge}`}><Icon size={22} strokeWidth={2.2} aria-hidden /></div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="break-words text-[16px] font-semibold leading-6 text-slate-900">{spec.title}</h2>
            <div id={bodyId} className="mt-1.5 max-h-[50vh] overflow-y-auto whitespace-pre-line break-words text-[13.5px] leading-relaxed text-slate-600">{spec.body}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3.5">
          <span className="mr-auto text-[11.5px] text-slate-400"><kbd className="kbd">Esc</kbd> to {spec.buttons.length > 1 ? "cancel" : "close"}</span>
          {spec.buttons.map((b) => (
            <button
              key={b.label} type="button" data-af={b.autoFocus ? "" : undefined} data-kind={b.kind} onClick={b.onClick}
              className={`${BTN} ${b.kind === "primary" ? `text-white ${spec.buttons.length === 1 ? tone.primary : TONES.confirm.primary}` : b.kind === "danger" ? BTN_DANGER : BTN_NEUTRAL}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  return createPortal(dialog, document.body);
}

// ---------------------------------------------------------------------------------------------------------------------
// useDialog(): the promise API
// ---------------------------------------------------------------------------------------------------------------------

export interface AlertOptions { title?: string; okLabel?: string }
export interface ConfirmOptions {
  title?: string; confirmLabel?: string; cancelLabel?: string;
  /** "danger" for anything destructive: the safe button (Cancel) then has the focus. */
  variant?: "confirm" | "warning" | "danger";
}
export interface PromptOptions { title?: string; label?: string; placeholder?: string; defaultValue?: string; required?: boolean; confirmLabel?: string; cancelLabel?: string }

export interface DialogApi {
  error(message: ReactNode, options?: AlertOptions): Promise<void>;
  warning(message: ReactNode, options?: AlertOptions): Promise<void>;
  info(message: ReactNode, options?: AlertOptions): Promise<void>;
  success(message: ReactNode, options?: AlertOptions): Promise<void>;
  /** Resolves true on the confirm button, false on Cancel or Esc. */
  confirm(message: ReactNode, options?: ConfirmOptions): Promise<boolean>;
  /** Resolves the trimmed text, or null on Cancel or Esc. */
  prompt(message: ReactNode, options?: PromptOptions): Promise<string | null>;
}

type Request =
  | { type: "alert"; variant: "error" | "warning" | "info" | "success"; message: ReactNode; options: AlertOptions }
  | { type: "confirm"; message: ReactNode; options: ConfirmOptions }
  | { type: "prompt"; message: ReactNode; options: PromptOptions };
interface Item { id: number; request: Request; promise: Promise<any>; resolve: (value: any) => void }

// Without a provider (a test, a stray preview) nothing is shown, and a question is answered "no" rather than "yes".
const unmounted: DialogApi = {
  error: async (m) => void console.error("[dialog]", m),
  warning: async (m) => void console.warn("[dialog]", m),
  info: async () => {},
  success: async () => {},
  confirm: async () => false,
  prompt: async () => null,
};
const Context = createContext<DialogApi>(unmounted);
export const useDialog = () => useContext(Context);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Item[]>([]);
  const queueRef = useRef<Item[]>([]); // always the latest queue, so two requests made in the same tick both see each other
  const nextId = useRef(1);

  const enqueue = useCallback(<T,>(request: Request): Promise<T> => {
    // The same notice twice in a row (a retry loop, two failing requests) is shown once.
    if (request.type === "alert" && typeof request.message === "string") {
      const same = queueRef.current.find((i) => i.request.type === "alert" && i.request.variant === request.variant && i.request.message === request.message && i.request.options.title === request.options.title);
      if (same) return same.promise;
    }
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    const item: Item = { id: nextId.current++, request, promise, resolve };
    queueRef.current = [...queueRef.current, item];
    setQueue(queueRef.current);
    return promise;
  }, []);

  const api = useMemo<DialogApi>(() => {
    const alert = (variant: "error" | "warning" | "info" | "success") => (message: ReactNode, options: AlertOptions = {}) => enqueue<void>({ type: "alert", variant, message, options });
    return {
      error: alert("error"), warning: alert("warning"), info: alert("info"), success: alert("success"),
      confirm: (message, options = {}) => enqueue<boolean>({ type: "confirm", message, options }),
      prompt: (message, options = {}) => enqueue<string | null>({ type: "prompt", message, options }),
    };
  }, [enqueue]);

  // Safety net: a failure nobody caught still reaches the person instead of vanishing into the console.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      if (r && typeof r === "object" && (r as { name?: string }).name === "AbortError") return;
      const text = r instanceof Error ? r.message : typeof r === "string" ? r : "";
      void api.error(text || "Something went wrong. Please try again.", { title: "Unexpected error" });
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, [api]);

  const current = queue[0];
  const settle = (item: Item, value: unknown) => {
    queueRef.current = queueRef.current.filter((i) => i.id !== item.id);
    setQueue(queueRef.current);
    item.resolve(value);
  };

  return (
    <Context.Provider value={api}>
      {children}
      {current && <Current key={current.id} item={current} settle={settle} />}
    </Context.Provider>
  );
}

function Current({ item, settle }: { item: Item; settle: (item: Item, value: unknown) => void }) {
  const r = item.request;
  if (r.type === "alert") {
    const done = () => settle(item, undefined);
    return <Dialog onClose={done} spec={{ title: r.options.title ?? TONES[r.variant].title, body: r.message, variant: r.variant, buttons: [{ label: r.options.okLabel ?? "OK", kind: "primary", autoFocus: true, onClick: done }] }} />;
  }
  if (r.type === "confirm") {
    const variant = r.options.variant ?? "confirm";
    const no = () => settle(item, false);
    return (
      <Dialog onClose={no} spec={{
        title: r.options.title ?? TONES[variant].title, body: r.message, variant,
        buttons: [
          { label: r.options.cancelLabel ?? "Cancel", kind: "neutral", autoFocus: variant === "danger", onClick: no },
          { label: r.options.confirmLabel ?? "OK", kind: variant === "danger" ? "danger" : "primary", autoFocus: variant !== "danger", onClick: () => settle(item, true) },
        ],
      }} />
    );
  }
  return <Question item={item} request={r} settle={settle} />;
}

function Question({ item, request, settle }: { item: Item; request: Extract<Request, { type: "prompt" }>; settle: (item: Item, value: unknown) => void }) {
  const { options } = request;
  const [value, setValue] = useState(options.defaultValue ?? "");
  const [problem, setProblem] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const no = () => settle(item, null);
  const submit = () => {
    const text = value.trim();
    if (options.required && !text) { setProblem("Please enter a value to continue."); input.current?.focus(); return; }
    settle(item, text);
  };
  return (
    <Dialog onClose={no} spec={{
      title: options.title ?? "Please answer", variant: "confirm",
      body: (
        <div>
          <p>{request.message}</p>
          {options.label && <label htmlFor={fieldId} className="mt-3 block text-[12px] font-medium text-slate-500">{options.label}</label>}
          <input
            ref={input} id={fieldId} data-af="" value={value} placeholder={options.placeholder} autoComplete="off"
            aria-label={options.label ? undefined : typeof request.message === "string" ? request.message : "Answer"}
            aria-invalid={problem ? true : undefined}
            onChange={(e) => { setValue(e.target.value); setProblem(""); }}
            className={`${options.label ? "mt-1" : "mt-3"} block h-10 w-full rounded-lg border bg-white px-3 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-[3px] ${problem ? "border-rose-500 focus:border-rose-600 focus:ring-rose-500/20" : "border-slate-300 hover:border-slate-400 focus:border-cobalt-700 focus:ring-cobalt-700/20"}`}
          />
          {problem && <p role="alert" className="mt-1.5 text-[12px] font-medium text-rose-700">{problem}</p>}
        </div>
      ),
      buttons: [
        { label: options.cancelLabel ?? "Cancel", kind: "neutral", onClick: no },
        { label: options.confirmLabel ?? "OK", kind: "primary", onClick: submit },
      ],
    }} />
  );
}
