import { useMemo } from "react";
import { Truck } from "lucide-react";
import { salesChallanApi, type PLookups, type SalesChallanRow } from "../../api";
import { Pill, money } from "../../components/purchase/Bits";
import DocWorkspace, { type DocWorkspaceConfig } from "../../components/purchase/DocWorkspace";
import SalesChallanEntry, { CHALLAN_OPTIONS, type CForm } from "./SalesChallanScreen";
import { toPLookups, type SalesScreenProps } from "./SalesInvoiceScreen";

// The Sales Challan screen: a tab strip with the challan list first and one tab per challan being entered or viewed.
export default function SalesChallanWorkspace(p: SalesScreenProps & { onCreateInvoice: (challanId: number) => void }) {
  const cfg = useMemo<DocWorkspaceConfig<CForm, SalesChallanRow, PLookups>>(() => ({
    plural: "Sales challans", singular: "challan", tabsLabel: "Sales challan tabs", icon: <Truck size={20} />,
    grid: "grid-cols-[130px_108px_minmax(220px,2fr)_112px_132px]", minWidth: "min-w-[760px]",
    columns: [
      { header: "Challan no", cell: (r) => <span className="font-mono text-[13px] font-semibold text-cobalt-800">{r.challanNumber}</span> },
      { header: "Date", align: "right", cell: (r, dateText) => <span className="tabular-nums text-slate-600">{dateText(r.challanDate)}</span> },
      { header: "Customer", cell: (r) => <span className="text-slate-600">{r.customerName}</span> },
      { header: "Status", cell: (r) => <Pill text={r.status} tone={r.isConfirmed ? "green" : "slate"} /> },
      { header: "Amount", align: "right", cell: (r) => <span className="font-medium tabular-nums text-ink">{money(r.totalAmount)}</span> },
    ],
    numberOf: (r) => r.challanNumber, stateOf: (r) => r.status, deletableStates: ["DRAFT"],
    cannotDeleteText: (no) => `Challan ${no} is confirmed; a confirmed challan cannot be deleted.`,
    statusOptions: CHALLAN_OPTIONS, searchPlaceholder: "Search by number or customer…  (/)",
    loadLookups: async (companyId) => toPLookups(await salesChallanApi.lookups({ companyId, branchId: p.branchId, userId: p.userId })),
    list: (q) => salesChallanApi.list(q),
    remove: (id, companyId, userId) => salesChallanApi.remove(id, companyId, userId),
  }), [p.branchId, p.userId]);
  return <DocWorkspace cfg={cfg} ctx={p} renderEntry={(e) => <SalesChallanEntry {...p} {...e} />} />;
}
