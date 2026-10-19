import { useEffect, useRef, type ReactNode } from "react";

export interface DialogSpec {
  title: string;
  body: ReactNode;
  buttons: { label: string; kind: "primary" | "danger" | "neutral"; onClick: () => void; autoFocus?: boolean }[];
  onCancel?: () => void;
}

export function ConfirmDialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>("[data-af]") ?? ref.current?.querySelector("button"))?.focus();
    return () => {
      const a = document.activeElement;
      if (!a || a === document.body) setTimeout(() => prev?.focus(), 0);
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const btns = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>("button"));
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      (spec.onCancel ?? onClose)();
    } else if (e.key === "Tab" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dir = e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
      btns[(i + dir + btns.length) % btns.length].focus();
    } else if ((e.key === "y" || e.key === "Y") && btns[i]?.dataset.kind === "danger") {
      btns[i].click(); // Y sirf tab confirm karta hai jab focus Delete button par ho
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onKeyDown={onKeyDown}>
      <div ref={ref} role="alertdialog" aria-modal="true" className="w-[400px] bg-paper border border-slate-500 shadow-lg">
        <div className="bg-navy text-white px-3 py-1.5 font-semibold">{spec.title}</div>
        <div className="px-4 py-4 text-[13px]">{spec.body}</div>
        <div className="flex justify-end gap-2 px-4 pb-3">
          {spec.buttons.map((b) => (
            <button
              key={b.label}
              data-af={b.autoFocus ? "" : undefined}
              data-kind={b.kind}
              onClick={b.onClick}
              className={`btn ${b.kind === "primary" ? "btn-primary" : b.kind === "danger" ? "btn-danger" : ""}`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
