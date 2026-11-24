import { useEffect, type MutableRefObject } from "react";
import { ArrowRight, BarChart3, BookOpen, CheckCircle2, FileCheck2, FileText, GitCompareArrows, Landmark, ListChecks, Settings2, SlidersHorizontal, WalletCards } from "lucide-react";
import type { StatusInfo } from "../../types";

type Module = {
  title: string;
  description: string;
  icon: typeof Landmark;
  status: "Foundation ready" | "Planned";
};

const modules: Module[] = [
  { title: "SME Reporting Setup", description: "Configure statement templates, note numbering, tax assumptions, and reporting preferences.", icon: Settings2, status: "Planned" },
  { title: "Account Mapping", description: "Map General Ledger accounts to NFRS statement lines and disclosure notes.", icon: SlidersHorizontal, status: "Planned" },
  { title: "Trial Balance", description: "Review posted ledger balances and confirm debit/credit integrity for the selected period.", icon: ListChecks, status: "Foundation ready" },
  { title: "Statement of Financial Position", description: "Generate assets, liabilities, and equity with NFRS classifications.", icon: Landmark, status: "Foundation ready" },
  { title: "Profit or Loss and OCI", description: "Generate income, expenses, profit, and other comprehensive income.", icon: BarChart3, status: "Foundation ready" },
  { title: "Cash Flow Statement", description: "Build the indirect-method cash-flow statement from ledger movements and classifications.", icon: WalletCards, status: "Planned" },
  { title: "Changes in Equity", description: "Reconcile opening equity, profit, OCI, dividends, and closing equity.", icon: GitCompareArrows, status: "Planned" },
  { title: "Notes to Financial Statements", description: "Produce numbered NFRS disclosures for revenue, PPE, tax, leases, payables, and related parties.", icon: BookOpen, status: "Planned" },
  { title: "NFRS Adjustments", description: "Record, post, reverse, and audit revaluation, deferred tax, leases, and first-time-adoption adjustments.", icon: FileText, status: "Planned" },
  { title: "Reconciliations", description: "Manage transition and comparative-year reconciliations from local GAAP to NFRS for SMEs.", icon: GitCompareArrows, status: "Planned" },
  { title: "Validation & Close", description: "Check mappings, balance-sheet equality, cash-flow reconciliation, and period readiness.", icon: FileCheck2, status: "Planned" },
];

export default function NfrsSmeReportingScreen(p: { companyId: number; branchId: number; fyCode: string; setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean> }) {
  useEffect(() => {
    p.dirtyRef.current = false;
    p.setStatus({ mode: "view", count: modules.length, shown: modules.length, message: "NFRS SME reporting workspace ready", kind: "info", hints: ["Start with account mapping", "Reports use posted transactions"] });
  }, [p.dirtyRef, p.setStatus]);

  return <main className="flex-1 min-w-0 overflow-auto bg-slate-50">
    <div className="border-b bg-white px-6 py-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-blue-100 p-2 text-blue-700"><Landmark size={22} /></div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">NFRS Reporting / SMEs</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">SME Financial Reporting</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Build NFRS for SMEs financial statements from the company’s posted ledgers, mappings, supporting schedules, and controlled adjustments.</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
        <span className="rounded border bg-slate-50 px-2 py-1">Company #{p.companyId}</span>
        <span className="rounded border bg-slate-50 px-2 py-1">Branch #{p.branchId}</span>
        <span className="rounded border bg-slate-50 px-2 py-1">Fiscal year {p.fyCode}</span>
        <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">Ledger foundation connected</span>
      </div>
    </div>
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div><h2 className="font-semibold text-slate-800">SME reporting modules</h2><p className="text-xs text-slate-500">The foundation reports reuse the current accounting engine; the remaining modules will be added in sequence.</p></div>
        <span className="text-xs text-slate-500">{modules.filter((m) => m.status === "Foundation ready").length} connected · {modules.filter((m) => m.status === "Planned").length} planned</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {modules.map((module) => { const Icon = module.icon; const ready = module.status === "Foundation ready"; return <article key={module.title} className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3"><div className={`rounded-md p-2 ${ready ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}><Icon size={18} /></div><div className="min-w-0 flex-1"><h3 className="font-medium text-slate-800">{module.title}</h3><p className="mt-1 text-xs leading-5 text-slate-500">{module.description}</p></div></div>
          <div className="mt-4 flex items-center justify-between border-t pt-3"><span className={`text-[11px] font-medium ${ready ? "text-emerald-700" : "text-slate-500"}`}>{ready ? <><CheckCircle2 size={13} className="mr-1 inline" />{module.status}</> : module.status}</span><ArrowRight size={14} className="text-slate-400" /></div>
        </article>; })}
      </div>
    </div>
  </main>;
}
