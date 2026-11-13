import { ClipboardList } from "lucide-react";
import { purchaseApi, type PListRow, type PLookups } from "../../api";
import { Pill, money } from "../../components/purchase/Bits";
import DocWorkspace, { type DocWorkspaceConfig } from "../../components/purchase/DocWorkspace";
import PurchaseOrderEntry, { OPTIONS, STATUS_TONE, type OForm, type PurchaseScreenProps } from "./PurchaseOrderScreen";

// The Purchase Order screen: a tab strip with the order list first and one tab per order being entered or viewed.
const CFG: DocWorkspaceConfig<OForm, PListRow, PLookups> = {
  plural: "Purchase orders", singular: "order", tabsLabel: "Purchase order tabs", icon: <ClipboardList size={20} />,
  grid: "grid-cols-[130px_108px_minmax(220px,2fr)_112px_132px]", minWidth: "min-w-[760px]",
  columns: [
    { header: "Order no", cell: (r) => <span className="font-mono text-[13px] font-semibold text-cobalt-800">{r.orderNumber}</span> },
    { header: "Date", align: "right", cell: (r, dateText) => <span className="tabular-nums text-slate-600">{dateText(r.orderDate)}</span> },
    { header: "Vendor", cell: (r) => <span className="text-slate-600">{r.vendorName}</span> },
    { header: "Status", cell: (r) => <Pill text={r.status} tone={STATUS_TONE[r.status]} /> },
    { header: "Amount", align: "right", cell: (r) => <span className="font-medium tabular-nums text-ink">{money(r.totalAmount)}</span> },
  ],
  numberOf: (r) => String(r.orderNumber), stateOf: (r) => String(r.status), deletableStates: ["DRAFT"],
  cannotDeleteText: (no, state) => `Order ${no} is ${state.toLowerCase()}; only a draft order can be deleted.`,
  statusOptions: OPTIONS, searchPlaceholder: "Search by number or vendor…  (/)",
  loadLookups: (companyId) => purchaseApi.lookups(companyId),
  list: (q) => purchaseApi.list("orders", q),
  remove: (id, companyId, userId) => purchaseApi.remove("orders", id, companyId, userId),
};

export default function PurchaseOrderWorkspace(p: PurchaseScreenProps) {
  return <DocWorkspace cfg={CFG} ctx={p} renderEntry={(e) => <PurchaseOrderEntry {...p} {...e} />} />;
}
