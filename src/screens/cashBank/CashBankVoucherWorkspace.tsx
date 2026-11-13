import { Landmark } from "lucide-react";
import { cashBankApi, type CbListRow, type CbLookups } from "../../api";
import { Pill, groupIN } from "../../components/purchase/Bits";
import DocWorkspace, { type DocWorkspaceConfig } from "../../components/purchase/DocWorkspace";
import CashBankVoucherEntry, { STATUS_OPTIONS, TONE, type CashBankScreenProps, type CbForm } from "./CashBankVoucherScreen";

// The Cash / Bank Voucher screen: a tab strip with the voucher list first and one tab per voucher being entered or viewed.
const CFG: DocWorkspaceConfig<CbForm, CbListRow, CbLookups> = {
  plural: "Cash / bank vouchers", singular: "voucher", tabsLabel: "Cash / bank voucher tabs", icon: <Landmark size={20} />,
  grid: "grid-cols-[130px_108px_minmax(220px,2fr)_112px_132px_132px]", minWidth: "min-w-[820px]",
  columns: [
    { header: "Voucher no", cell: (r) => <span className="font-mono text-[13px] font-semibold text-cobalt-800">{r.voucherNumber}</span> },
    { header: "Date", align: "right", cell: (r, dateText) => <span className="tabular-nums text-slate-600">{dateText(r.voucherDate)}</span> },
    { header: "Cash / bank ledger", cell: (r) => <span className="text-slate-600">{r.cashBankLedgerName}{r.payeeReference ? <span className="ml-2 text-[11.5px] text-slate-400">{r.payeeReference}</span> : null}</span> },
    { header: "Status", cell: (r) => <Pill text={r.status} tone={TONE[r.status]} /> },
    { header: "Receipts", align: "right", cell: (r) => <span className="tabular-nums text-ink">{groupIN(r.totalReceipts)}</span> },
    { header: "Payments", align: "right", cell: (r) => <span className="tabular-nums text-ink">{groupIN(r.totalPayments)}</span> },
  ],
  numberOf: (r) => r.voucherNumber, stateOf: (r) => r.status, deletableStates: ["DRAFT"],
  cannotDeleteText: (no, state) => `Voucher ${no} is ${state.toLowerCase()}; only a draft can be deleted. Reverse a posted voucher instead.`,
  statusOptions: STATUS_OPTIONS, searchPlaceholder: "Search by number, ledger or payee…  (/)",
  loadLookups: (companyId) => cashBankApi.lookups(companyId),
  list: (q) => cashBankApi.list(q),
  remove: (id, companyId, userId) => cashBankApi.remove(id, companyId, userId),
};

export default function CashBankVoucherWorkspace(p: CashBankScreenProps) {
  return <DocWorkspace cfg={CFG} ctx={{ ...p, externalMessage: p.externalMessage ?? null }} renderEntry={(e) => <CashBankVoucherEntry {...p} {...e} />} />;
}
