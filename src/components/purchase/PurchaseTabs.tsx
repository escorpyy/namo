import type { KeyboardEvent, ReactNode } from "react";
import { Calculator, FileText, Package } from "lucide-react";

export type PurchaseTabId = "header" | "lines" | "terms";

const ICONS = { header: FileText, lines: Package, terms: Calculator };

export interface PurchaseTabSpec {
  id: PurchaseTabId;
  label: string;
  detail: string;
  badge?: string | number;
  alert?: boolean;
}

export function PurchaseTabs({ active, onChange, tabs, prefix, label = "Document sections" }: {
  active: PurchaseTabId;
  onChange: (id: PurchaseTabId) => void;
  tabs: PurchaseTabSpec[];
  prefix: string;
  label?: string;
}) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    onChange(tabs[next].id);
    requestAnimationFrame(() => document.getElementById(`${prefix}-tab-${tabs[next].id}`)?.focus());
  };

  return (
    <div className="purchase-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const Icon = ICONS[tab.id];
        const selected = active === tab.id;
        return (
          <button key={tab.id} id={`${prefix}-tab-${tab.id}`} type="button" role="tab"
            aria-selected={selected} aria-controls={`${prefix}-panel-${tab.id}`} tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)} onKeyDown={(e) => move(e, index)}
            className={`purchase-tab ${selected ? "purchase-tab-active" : ""}`}>
            <span className="purchase-tab-icon"><Icon size={17} strokeWidth={1.8} /></span>
            <span className="purchase-tab-copy"><span className="purchase-tab-label">{tab.label}</span><span className="purchase-tab-detail">{tab.detail}</span></span>
            {tab.badge !== undefined && <span className={`purchase-tab-badge ${tab.alert ? "purchase-tab-badge-alert" : ""}`}>{tab.badge}</span>}
            <span className="sr-only">{selected ? "Current section" : `Section ${index + 1} of ${tabs.length}`}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PurchaseTabPanel({ active, id, prefix, children, className = "" }: {
  active: PurchaseTabId;
  id: PurchaseTabId;
  prefix: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div id={`${prefix}-panel-${id}`} role="tabpanel" aria-labelledby={`${prefix}-tab-${id}`} hidden={active !== id}
      className={`purchase-tab-panel ${className}`}>
      {children}
    </div>
  );
}
