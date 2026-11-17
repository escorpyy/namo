import { useMemo } from "react";
import { Receipt } from "lucide-react";
import { salesInvoiceApi, type PLookups, type SalesInvoiceRow } from "../../api";
import { Pill, money } from "../../components/purchase/Bits";
import DocWorkspace, { type DocWorkspaceConfig } from "../../components/purchase/DocWorkspace";
import SalesInvoiceEntry, { STATE_OPTIONS, STATE_TONE, toPLookups, type SForm, type SalesScreenProps } from "./SalesInvoiceScreen";

// The Sales Invoice screen: a tab strip with the invoice list first and one tab per invoice being entered or viewed.
export default function SalesInvoiceWorkspace(p: SalesScreenProps) {
  const cfg = useMemo<DocWorkspaceConfig<SForm, SalesInvoiceRow, PLookups>>(() => ({
    plural: "Sales invoices", singular: "invoice", tabsLabel: "Sales invoice tabs", icon: <Receipt size={20} />,
    grid: "grid-cols-[130px_108px_minmax(220px,2fr)_112px_132px]", minWidth: "min-w-[760px]",
    columns: [
      { header: "Invoice no", cell: (r) => <span className="font-mono text-[13px] font-semibold text-cobalt-800">{r.invoiceNumber}</span> },
      { header: "Date", align: "right", cell: (r, dateText) => <span className="tabular-nums text-slate-600">{dateText(r.invoiceDate)}</span> },
      { header: "Customer", cell: (r) => <span className="text-slate-600">{r.customerName}</span> },
      { header: "Status", cell: (r) => <Pill text={r.state} tone={STATE_TONE[r.state]} /> },
      { header: "Amount", align: "right", cell: (r) => <span className="font-medium tabular-nums text-ink">{money(r.totalAmount)}</span> },
    ],
    numberOf: (r) => r.invoiceNumber, stateOf: (r) => r.state, deletableStates: ["DRAFT"],
    cannotDeleteText: (no, state) => `Invoice ${no} is ${state.toLowerCase()}; only a draft invoice can be deleted. Reverse a posted invoice instead.`,
    statusOptions: STATE_OPTIONS, searchPlaceholder: "Search by number or customer…  (/)",
    loadLookups: async (companyId) => toPLookups(await salesInvoiceApi.lookups({ companyId, branchId: p.branchId, userId: p.userId })),
    list: (q) => salesInvoiceApi.list(q),
    remove: (id, companyId, userId) => salesInvoiceApi.remove(id, companyId, userId),
  }), [p.branchId, p.userId]);
  return <DocWorkspace cfg={cfg} ctx={p} renderEntry={(e) => <SalesInvoiceEntry {...p} {...e} />} />;
}
