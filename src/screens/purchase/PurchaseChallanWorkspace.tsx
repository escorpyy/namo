import { Truck } from "lucide-react";
import { purchaseApi, type PListRow, type PLookups } from "../../api";
import { Pill, money } from "../../components/purchase/Bits";
import DocWorkspace, { type DocWorkspaceConfig } from "../../components/purchase/DocWorkspace";
import PurchaseChallanEntry, { OPTIONS, type CForm } from "./PurchaseChallanScreen";
import type { PurchaseScreenProps } from "./PurchaseOrderScreen";

// The Purchase Challan screen: a tab strip with the challan list first and one tab per challan being entered or viewed.
const stateOf = (r: PListRow) => (r.isConfirmed ? "CONFIRMED" : "DRAFT");
const CFG: DocWorkspaceConfig<CForm, PListRow, PLookups> = {
  plural: "Purchase challans", singular: "challan", tabsLabel: "Purchase challan tabs", icon: <Truck size={20} />,
  grid: "grid-cols-[130px_108px_minmax(220px,2fr)_130px_112px_132px]", minWidth: "min-w-[820px]",
  columns: [
    { header: "Challan no", cell: (r) => <span className="font-mono text-[13px] font-semibold text-cobalt-800">{r.challanNumber}</span> },
    { header: "Date", align: "right", cell: (r, dateText) => <span className="tabular-nums text-slate-600">{dateText(r.challanDate)}</span> },
    { header: "Vendor", cell: (r) => <span className="text-slate-600">{r.vendorName}</span> },
    { header: "Order", cell: (r) => <span className="font-mono text-[12.5px] text-slate-500">{r.orderNumber ?? ""}</span> },
    { header: "Status", cell: (r) => <Pill text={stateOf(r)} tone={r.isConfirmed ? "green" : "slate"} /> },
    { header: "Amount", align: "right", cell: (r) => <span className="font-medium tabular-nums text-ink">{money(r.totalAmount)}</span> },
  ],
  numberOf: (r) => String(r.challanNumber), stateOf, deletableStates: ["DRAFT"],
  cannotDeleteText: (no) => `Challan ${no} is confirmed; a confirmed challan cannot be deleted.`,
  statusOptions: OPTIONS, searchPlaceholder: "Search by number or vendor…  (/)",
  loadLookups: (companyId) => purchaseApi.lookups(companyId),
  list: (q) => purchaseApi.list("challans", q),
  remove: (id, companyId, userId) => purchaseApi.remove("challans", id, companyId, userId),
};

export default function PurchaseChallanWorkspace(p: PurchaseScreenProps & { onCreateBill: (challanId: number) => void }) {
  return <DocWorkspace cfg={CFG} ctx={p} renderEntry={(e) => <PurchaseChallanEntry {...p} {...e} />} />;
}
