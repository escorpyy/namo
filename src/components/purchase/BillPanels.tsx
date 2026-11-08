import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eye, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pencil } from "lucide-react";
import { purchaseApi, type PListRow, type PLookups } from "../../api";
import { adToBs } from "../../lib/nepaliDate";
import { money } from "./Bits";

// The two side panels of the purchase bill entry screen. Each takes 20% of the width, or folds to a thin strip so the lines get the room.

export function SidePanel({ side, title, collapsed, onToggle, shortcut, children }: {
  side: "left" | "right"; title: string; collapsed: boolean; onToggle: () => void; shortcut: string; children: ReactNode;
}) {
  const Icon = side === "left" ? (collapsed ? PanelLeftOpen : PanelLeftClose) : (collapsed ? PanelRightOpen : PanelRightClose);
  const label = `${collapsed ? "Expand" : "Collapse"} ${title.toLowerCase()} (${shortcut})`;
  const toggle = (
    <button type="button" data-panel-toggle={side} onClick={onToggle} aria-expanded={!collapsed} aria-label={label} title={label}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-sm hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-blue-700">
      <Icon size={16} />
    </button>
  );
  return (
    <aside aria-label={title} data-side-panel={side}
      className={`flex min-h-0 shrink-0 flex-col overflow-hidden bg-white/50 transition-[width] duration-150 ${side === "left" ? "border-r" : "border-l"} border-slate-400 ${collapsed ? "w-9" : "w-[20%] min-w-[200px]"}`}>
      {collapsed ? (
        <div className="flex flex-col items-center gap-2 pt-1.5">
          {toggle}
          <span className="text-[11px] font-semibold text-slate-600 [writing-mode:vertical-rl]">{title}</span>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-300 bg-slate-50 px-2.5 py-1">
            <h2 className="text-[12px] font-semibold text-slate-700">{title}</h2>
            {toggle}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">{children}</div>
        </>
      )}
    </aside>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return <p className="rounded-sm border border-dashed border-slate-300 px-2.5 py-3 text-[12px] leading-snug text-slate-500">{children}</p>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b border-slate-200 py-1 last:border-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-words text-[12.5px] text-slate-900">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

const PURCHASE_TYPE: Record<string, string> = {
  GOODS_PURCHASE_OTHERS: "Goods — Others", GOODS_PURCHASE_CAPITAL: "Goods — Capital", SERVICE_PURCHASE_OTHERS: "Service — Others", SERVICE_PURCHASE_CAPITAL: "Service — Capital",
};

export interface SummaryForm {
  invoiceDate: string; invoiceType: string; purchaseType: string; vendorInvoiceNo: string; vendorInvoiceDate: string; dueDays: string; dueDate: string; remarks: string;
  challanNo: string; orderNo: string; imp: Record<string, string>;
}

// Left panel: the header the user just entered, read-only, with a way back to the form.
export function HeaderSummary({ form, invoiceNumber, calendar, readOnly, onEdit }: {
  form: SummaryForm; invoiceNumber?: string; calendar: "BS" | "AD"; readOnly: boolean; onEdit: () => void;
}) {
  const date = (v: string) => (!v || v.startsWith("?") ? "" : calendar === "BS" ? (adToBs(v) ?? v) : v);
  const links = [form.challanNo && `Challan ${form.challanNo}`, form.orderNo && `Order ${form.orderNo}`].filter(Boolean).join(" · ");
  return (
    <div>
      <dl>
        <Row label="Invoice No"><span className="font-mono">{invoiceNumber || "(next number)"}</span></Row>
        <Row label={`Invoice date (${calendar})`}>{date(form.invoiceDate)}</Row>
        <Row label="Type">{form.invoiceType === "IMPORT" ? "Import" : "Local"} · {PURCHASE_TYPE[form.purchaseType] ?? form.purchaseType}</Row>
        <Row label="Vendor invoice">{[form.vendorInvoiceNo, date(form.vendorInvoiceDate)].filter(Boolean).join(" · ")}</Row>
        <Row label="Payment due">{[form.dueDays && `${form.dueDays} days`, date(form.dueDate)].filter(Boolean).join(" · ")}</Row>
        {links && <Row label="Linked to">{links}</Row>}
        {form.invoiceType === "IMPORT" && form.imp.customsDeclarationNo && <Row label="Customs declaration">{form.imp.customsDeclarationNo}</Row>}
        {form.remarks.trim() && <Row label="Remarks"><span className="whitespace-pre-wrap">{form.remarks}</span></Row>}
      </dl>
      <button type="button" className="btn mt-2 h-7 w-full justify-center" onClick={onEdit}>
        {readOnly ? <><Eye size={12} /> View full header</> : <><Pencil size={12} /> Edit header</>}
      </button>
    </div>
  );
}

// Right panel: who the bill is from, and what is already on file for that vendor.
export function VendorPanel({ lookups, companyId, branchId, vendorGLId, subLedgerId, agentId, vendorInvoiceNo, docId, calendar }: {
  lookups: PLookups; companyId: number; branchId: number; vendorGLId: string; subLedgerId: string; agentId: string; vendorInvoiceNo: string; docId?: number; calendar: "BS" | "AD";
}) {
  const vendor = lookups.vendors.find((v) => String(v.id) === vendorGLId);
  const sub = lookups.subLedgers.find((s) => String(s.id) === subLedgerId);
  const agent = lookups.agents.find((a) => String(a.id) === agentId);
  const [bills, setBills] = useState<PListRow[] | null>(null);
  useEffect(() => {
    if (!vendorGLId) { setBills(null); return; }
    let live = true;
    setBills(null);
    purchaseApi.list("bills", { companyId, branchId, fiscalYear: "", vendorGLId: Number(vendorGLId) }).then((r) => { if (live) setBills(r.rows); }).catch(() => { if (live) setBills([]); });
    return () => { live = false; };
  }, [companyId, branchId, vendorGLId, docId]);
  const others = useMemo(() => (bills ?? []).filter((b) => b.id !== docId).sort((a, b) => String(b.invoiceDate).localeCompare(String(a.invoiceDate)) || b.id - a.id), [bills, docId]);
  const typed = vendorInvoiceNo.trim().toLowerCase();
  const duplicate = typed ? others.find((b) => String(b.vendorInvoiceNo ?? "").trim().toLowerCase() === typed) : undefined;
  const date = (v: unknown) => { const s = String(v ?? "").slice(0, 10); return calendar === "BS" ? (adToBs(s) ?? s) : s; };
  return (
    <div>
      <dl>
        <Row label="Vendor ledger">{vendor ? <><span className="font-mono text-[11px] text-slate-600">{vendor.code}</span> {vendor.name}{!vendor.isActive && <span className="ml-1 text-[11px] text-amber-700">(inactive)</span>}</> : ""}</Row>
        <Row label="Sub ledger">{sub ? `${sub.code} — ${sub.name}` : vendor?.requiresSubLedger ? <span className="text-red-700">Required — not chosen</span> : ""}</Row>
        <Row label="Agent">{agent ? `${agent.code} — ${agent.name}` : ""}</Row>
      </dl>
      {duplicate && (
        <p role="alert" className="mt-2 border border-amber-300 bg-amber-50 px-2 py-1 text-[11.5px] text-amber-900">
          Vendor invoice <b>{vendorInvoiceNo.trim()}</b> is already on bill <b className="font-mono">{duplicate.invoiceNumber}</b>. A repeated vendor invoice number is refused on save.
        </p>
      )}
      <h3 className="mt-3 mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recent bills from this vendor</h3>
      {bills === null ? <p className="text-[12px] text-slate-500">Loading…</p>
        : others.length === 0 ? <p className="text-[12px] text-slate-500">No earlier bills.</p>
        : (
          <ul className="divide-y divide-slate-200 border border-slate-200 bg-white">
            {others.slice(0, 5).map((b) => (
              <li key={b.id} className="px-2 py-1 text-[12px]">
                <div className="flex justify-between gap-2"><span className="font-mono">{b.invoiceNumber}</span><span className="tabular-nums">{money(b.totalAmount)}</span></div>
                <div className="flex justify-between gap-2 text-[11px] text-slate-500"><span>{date(b.invoiceDate)}</span><span>{String(b.state ?? "").toLowerCase()}</span></div>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
