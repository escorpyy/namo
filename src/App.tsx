import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ContextData, StatusInfo } from "./types";
import { useDialog } from "./components/Dialog";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { LedgerJobWatcher } from "./components/LedgerJobWatcher";
import { QuickCreateHost } from "./components/QuickCreate";
import MasterScreen from "./screens/MasterScreen";
import CodeNumberingScreen from "./screens/CodeNumberingScreen";
import NumberSeriesScreen from "./screens/NumberSeriesScreen";
import OpeningBalanceScreen from "./screens/OpeningBalanceScreen";
import StockOpeningScreen from "./screens/StockOpeningScreen";
import CashBankVoucherWorkspace from "./screens/cashBank/CashBankVoucherWorkspace";
import JournalVoucherWorkspace from "./screens/accounting/JournalVoucherWorkspace";
import AgeingScreen from "./screens/reports/AgeingScreen";
import StockValuationScreen from "./screens/reports/StockValuationScreen";
import LedgerReportScreen from "./screens/reports/LedgerReportScreen";
import FinancialStatementScreen from "./screens/reports/FinancialStatementScreen";
import NfrsSmeReportingScreen from "./screens/reports/NfrsSmeReportingScreen";
import SalesInvoiceWorkspace from "./screens/sales/SalesInvoiceWorkspace";
import SalesChallanWorkspace from "./screens/sales/SalesChallanWorkspace";
import PurchaseBillWorkspace from "./screens/purchase/PurchaseBillWorkspace";
import PurchaseOrderWorkspace from "./screens/purchase/PurchaseOrderWorkspace";
import PurchaseChallanWorkspace from "./screens/purchase/PurchaseChallanWorkspace";
import ImportCostAssessmentWorkspace from "./screens/purchase/ImportCostAssessmentWorkspace";
import GLSetupScreen from "./screens/GLSetupScreen";
import KeyboardShortcutsScreen from "./screens/KeyboardShortcutsScreen";
import { READY_SCREEN_OPTIONS } from "./components/Sidebar";
import {
  dispatchScreenShortcut, findShortcutConflicts, getBrowserShortcutStorage, getShortcutActions,
  getShortcutCombination, readShortcutBindings, type ShortcutActionDefinition,
} from "./lib/keyboardShortcuts";
import { MASTERS } from "../shared/masters";
import type { OpenRequest } from "./lib/openRequest";

const SHORTCUT_ACTIONS = getShortcutActions(READY_SCREEN_OPTIONS);
const SHORTCUT_ACTION_BY_ID = new Map<string, ShortcutActionDefinition>(SHORTCUT_ACTIONS.map((action) => [action.id, action]));

export default function App() {
  const [ctx, setCtx] = useState<ContextData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState("account-groups");
  const [companyId, setCompanyId] = useState(0);
  const [branchId, setBranchId] = useState(0);
  const [fyId, setFyId] = useState(0);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sb-collapsed") === "1");
  const [calendar, setCalendar] = useState<"BS" | "AD">(() => (localStorage.getItem("cal") as "BS" | "AD") ?? "BS");
  const [status, setStatus] = useState<StatusInfo>({ mode: "new", count: 0, shown: 0, message: "Loading…", kind: "info" });
  const [note, setNote] = useState<{ text: string; n: number } | null>(null);
  const [openReq, setOpenReq] = useState<(OpenRequest & { screen: string }) | null>(null);
  const [fromChallan, setFromChallan] = useState<{ id: number; n: number } | null>(null);
  const [salesFromChallan, setSalesFromChallan] = useState<{ id: number; n: number } | null>(null);
  const dirtyRef = useRef(false);
  const dlg = useDialog();
  const shortcutActionRef = useRef<(actionId: string) => void>(() => {});

  const pickDefaults = (c: ContextData["companies"][number]) => {
    setBranchId((c.branches.find((b) => b.isHeadOffice) ?? c.branches[0])?.id ?? 0);
    setFyId((c.fiscalYears.find((y) => y.isCurrent) ?? c.fiscalYears[0])?.id ?? 0);
  };

  // Company/Branch/Fiscal Year master me badlav ke baad header ke switcher refresh (screen reset nahi hoti)
  const sel = useRef({ companyId, branchId, fyId });
  sel.current = { companyId, branchId, fyId };
  const refreshCtx = useCallback(() => {
    api.context().then((d) => {
      if (!d.companies.length) return setError("Database me koi company nahi hai.");
      setCtx(d);
      const cur = sel.current;
      const co = d.companies.find((c) => c.id === cur.companyId);
      if (!co) { setCompanyId(d.companies[0].id); pickDefaults(d.companies[0]); return; }
      if (!co.branches.some((b) => b.id === cur.branchId)) setBranchId((co.branches.find((b) => b.isHeadOffice) ?? co.branches[0])?.id ?? 0);
      if (!co.fiscalYears.some((y) => y.id === cur.fyId)) setFyId((co.fiscalYears.find((y) => y.isCurrent) ?? co.fiscalYears[0])?.id ?? 0);
    }).catch((e: Error) => void dlg.error(e.message, { title: "Could not refresh the company list" }));
  }, [dlg]);

  const start = useCallback(() => {
    setError(null);
    api.context().then((d) => {
      if (!d.companies.length) return setError("Database me koi company nahi hai. `npm run db:seed` chalao.");
      setCtx(d); setCompanyId(d.companies[0].id); pickDefaults(d.companies[0]);
    }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => { start(); }, [start]);

  // The app cannot start: say why in a dialog; the page behind it only offers "Try again".
  useEffect(() => {
    if (!error) return;
    void dlg.error(
      <>
        <span className="block">{error}</span>
        <span className="mt-2 block text-[12px] text-slate-500">Checklist: .env me DATABASE_URL, <code>npm run db:push</code>, <code>npm run db:seed</code>, aur API (<code>npm run dev</code>) chal rahi ho.</span>
      </>,
      { title: "Cannot start NamoErp" },
    );
  }, [error, dlg]);

  const toggleSidebar = useCallback(() => setCollapsed((c) => { localStorage.setItem("sb-collapsed", c ? "0" : "1"); return !c; }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  const activeUserId = ctx?.user.id;
  useEffect(() => {
    if (activeUserId === undefined) return;
    const onCustomShortcut = (event: KeyboardEvent) => {
      if (event.repeat || event.isComposing) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-shortcut-capture]")) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const combination = getShortcutCombination(event);
      if (!combination) return;
      const bindings = readShortcutBindings(getBrowserShortcutStorage(), activeUserId, SHORTCUT_ACTIONS);
      if (findShortcutConflicts(bindings, SHORTCUT_ACTIONS).length) return;
      const binding = bindings.find((item) => item.combination === combination);
      if (!binding) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      shortcutActionRef.current(binding.actionId);
    };
    window.addEventListener("keydown", onCustomShortcut, true);
    return () => window.removeEventListener("keydown", onCustomShortcut, true);
  }, [activeUserId]);

  if (error) {
    return (
      <div className="h-full grid place-items-center">
        <div className="text-center">
          <p className="mb-3 text-slate-600">NamoErp could not start.</p>
          <button type="button" className="btn btn-primary" onClick={start}>Try again</button>
        </div>
      </div>
    );
  }
  if (!ctx) return <div className="h-full grid place-items-center text-slate-500">Loading…</div>;

  const co = ctx.companies.find((c) => c.id === companyId)!;
  // Unsaved grid / form data is lost by switching screen, company, branch or year, so each of those asks first.
  const okToLeave = async (message: string, title: string, confirmLabel: string) =>
    !dirtyRef.current || dlg.confirm(message, { title, variant: "warning", confirmLabel, cancelLabel: "Stay here" });

  const changeCompany = async (id: number) => {
    if (id === companyId) return;
    if (!(await okToLeave("Unsaved changes will be lost. Switch company anyway?", "Switch company?", "Switch company"))) return;
    setCompanyId(id);
    pickDefaults(ctx.companies.find((c) => c.id === id)!);
  };

  const guarded = (fn: () => void) => async () => {
    if (!(await okToLeave("Unsaved changes will be lost. Continue?", "Discard unsaved changes?", "Continue"))) return;
    fn();
  };

  const navigate = async (id: string) => {
    if (id === screen) return;
    if (!(await okToLeave("Unsaved changes will be lost. Leave this screen?", "Leave this screen?", "Leave screen"))) return;
    setScreen(id);
  };

  shortcutActionRef.current = (actionId) => {
    const action = SHORTCUT_ACTION_BY_ID.get(actionId);
    if (!action) return;
    if (action.kind === "screen-key") dispatchScreenShortcut(action);
    else if (action.kind === "toggle-sidebar") toggleSidebar();
    else void navigate(action.target);
  };

  // Ctrl+Enter on a ledger report line: open the record behind it, in view mode, in its own workspace.
  const openSource = async (target: string, docId: number) => {
    if (!(await okToLeave("Unsaved changes will be lost. Leave this screen?", "Leave this screen?", "Leave screen"))) return;
    setOpenReq({ screen: target, docId, n: Date.now() });
    setScreen(target);
  };
  const openRequest = openReq?.screen === screen ? openReq : null;
  const selectedCompany = ctx.companies.find((c) => c.id === companyId);
  const fiscalYears = [...(selectedCompany?.fiscalYears ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const selectedFyIndex = fiscalYears.findIndex((y) => y.id === fyId);
  const currentFy = fiscalYears.find((y) => y.id === fyId);
  const previousFy = selectedFyIndex > 0 ? fiscalYears[selectedFyIndex - 1] : undefined;

  return (
    <QuickCreateHost companyId={companyId} calendar={calendar}>
    <div className="h-full flex flex-col">
      <Header
        companies={ctx.companies} companyId={companyId} branchId={branchId} fyId={fyId} userName={ctx.user.name} calendar={calendar}
        onToggleSidebar={toggleSidebar} onCompany={changeCompany} onBranch={(id) => guarded(() => setBranchId(id))()} onFy={(id) => guarded(() => setFyId(id))()}
        onCalendar={(c) => { setCalendar(c); localStorage.setItem("cal", c); }}
      />
      <div className="flex-1 min-h-0 flex">
        <Sidebar collapsed={collapsed} active={screen} onToggle={toggleSidebar} onNavigate={navigate} onNotify={(text) => { setNote({ text, n: Date.now() }); void dlg.info(text, { title: "Not available yet" }); }} />
        {/* key: screen ya company badalne par list reload + form reset */}
        {screen === "set-shortcuts" ? (
          <KeyboardShortcutsScreen key={`${screen}:${ctx.user.id}`} userId={ctx.user.id} dirtyRef={dirtyRef} screens={READY_SCREEN_OPTIONS} />
        ) : screen.startsWith("purchase-") && screen !== "purchase-terms" ? (() => {
          const k = `${screen}:${companyId}:${branchId}:${fyId}`;
          const pp = {
            companyId, branchId, userId: ctx.user.id, branchName: co.branches.find((b) => b.id === branchId)?.name ?? "-",
            fyCode: co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-", calendar, setStatus, dirtyRef, externalMessage: note, openRequest,
          };
          return screen === "purchase-orders" ? <PurchaseOrderWorkspace key={k} {...pp} />
            : screen === "purchase-challans" ? <PurchaseChallanWorkspace key={k} {...pp} onCreateBill={(id) => { setFromChallan({ id, n: Date.now() }); dirtyRef.current = false; setScreen("purchase-bills"); }} />
            : screen === "purchase-import-assessments" ? <ImportCostAssessmentWorkspace key={k} {...pp} />
            : <PurchaseBillWorkspace key={k} {...pp} fromChallan={fromChallan} />;
        })() : screen === "gl-setup" ? (
          <GLSetupScreen key={`${screen}:${companyId}`} companyId={companyId} userId={ctx.user.id} setStatus={setStatus} dirtyRef={dirtyRef} />
        ) : screen === "journal" ? (
          <JournalVoucherWorkspace
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} userId={ctx.user.id} companyName={co.name}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} openRequest={openRequest}
          />
        ) : screen === "inv-stock-valuation" ? (
          <StockValuationScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"}
            fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"} calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef}
          />
        ) : screen === "rpt-ageing" || screen === "rpt-outstanding" ? (
          <AgeingScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"}
            fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"} calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef}
          />
        ) : screen === "fs-ledgers" ? (
          <LedgerReportScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            fyStart={co.fiscalYears.find((y) => y.id === fyId)?.startDate ?? ""} fyEnd={co.fiscalYears.find((y) => y.id === fyId)?.endDate ?? ""}
            calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef} onOpenSource={openSource}
          />
        ) : screen === "fs-trial-balance" || screen === "fs-profit-loss" || screen === "fs-balance-sheet" || screen === "nfrs-sme-trial-balance" || screen === "nfrs-sme-profit-loss" || screen === "nfrs-sme-balance-sheet" ? (
          <FinancialStatementScreen companyName={co.name}
            key={`${screen}:${companyId}:${branchId}:${fyId}`} kind={screen === "fs-trial-balance" || screen === "nfrs-sme-trial-balance" ? "trial-balance" : screen === "fs-profit-loss" || screen === "nfrs-sme-profit-loss" ? "profit-loss" : "balance-sheet"}
            companyId={companyId} branchId={branchId} userId={ctx.user.id} fyCode={currentFy?.code ?? "-"}
            fyStart={currentFy?.startDate ?? ""} fyEnd={currentFy?.endDate ?? ""}
            previousFy={previousFy ? { code: previousFy.code, startDate: previousFy.startDate, endDate: previousFy.endDate } : undefined}
            setStatus={setStatus} dirtyRef={dirtyRef} reportFamily={screen.startsWith("nfrs-sme-") ? "NFRS for SMEs" : undefined}
          />
        ) : screen === "nfrs-sme-reporting" ? (
          <NfrsSmeReportingScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId}
            fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"} setStatus={setStatus} dirtyRef={dirtyRef}
          />
        ) : screen === "sales-challans" ? (
          <SalesChallanWorkspace
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} userId={ctx.user.id}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} openRequest={openRequest}
            onCreateInvoice={(id) => { setSalesFromChallan({ id, n: Date.now() }); dirtyRef.current = false; setScreen("sales-invoices"); }}
          />
        ) : screen === "sales-invoices" ? (
          <SalesInvoiceWorkspace
            key={`${screen}:${companyId}:${branchId}:${fyId}`} fromChallan={salesFromChallan} companyId={companyId} branchId={branchId} userId={ctx.user.id}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} openRequest={openRequest}
          />
        ) : screen === "cash-bank" ? (
          <CashBankVoucherWorkspace
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} userId={ctx.user.id}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} openRequest={openRequest}
          />
        ) : screen === "stock-opening" ? (
          <StockOpeningScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} fyId={fyId}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note}
          />
        ) : screen === "code-numbering" ? (
          <CodeNumberingScreen key={`${screen}:${companyId}`} companyId={companyId} userId={ctx.user.id} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} />
        ) : screen === "number-series" ? (
          <NumberSeriesScreen key={`${screen}:${companyId}`} companyId={companyId} userId={ctx.user.id} company={co} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} />
        ) : screen === "opening-balance" ? (
          <OpeningBalanceScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} fyId={fyId} userId={ctx.user.id}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note}
          />
        ) : (
        <MasterScreen key={`${screen}:${companyId}`} def={MASTERS[screen]} companyId={companyId} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} calendar={calendar} onContextChanged={refreshCtx} userId={ctx.user.id} />
        )}
      </div>
      <LedgerJobWatcher companyId={companyId} userId={ctx.user.id} />
      <StatusBar
        status={status} company={co.name}
        branch={co.branches.find((b) => b.id === branchId)?.name ?? "-"}
        fy={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
      />
    </div>
    </QuickCreateHost>
  );
}
