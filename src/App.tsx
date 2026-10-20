import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ContextData, StatusInfo } from "./types";
import { Header } from "./components/Header";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import MasterScreen from "./screens/MasterScreen";
import OpeningBalanceScreen from "./screens/OpeningBalanceScreen";
import StockOpeningScreen from "./screens/StockOpeningScreen";
import { MASTERS } from "../shared/masters";

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
  const dirtyRef = useRef(false);

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
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.context().then((d) => {
      if (!d.companies.length) return setError("Database me koi company nahi hai. `npm run db:seed` chalao.");
      setCtx(d); setCompanyId(d.companies[0].id); pickDefaults(d.companies[0]);
    }).catch((e: Error) => setError(e.message));
  }, []);

  const toggleSidebar = useCallback(() => setCollapsed((c) => { localStorage.setItem("sb-collapsed", c ? "0" : "1"); return !c; }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  if (error) {
    return (
      <div className="h-full grid place-items-center">
        <div className="max-w-md border border-red-300 bg-white p-5">
          <h1 className="font-semibold text-red-700 mb-1">Cannot start NamoErp</h1>
          <p className="mb-2">{error}</p>
          <p className="text-slate-600 text-[12px]">Checklist: .env me DATABASE_URL, <code>npm run db:push</code>, <code>npm run db:seed</code>, aur API (<code>npm run dev</code>) chal rahi ho.</p>
        </div>
      </div>
    );
  }
  if (!ctx) return <div className="h-full grid place-items-center text-slate-500">Loading…</div>;

  const co = ctx.companies.find((c) => c.id === companyId)!;
  const changeCompany = (id: number) => {
    if (id === companyId) return;
    if (dirtyRef.current && !window.confirm("Unsaved changes will be lost. Switch company anyway?")) return;
    setCompanyId(id);
    pickDefaults(ctx.companies.find((c) => c.id === id)!);
  };

  // Branch / FY badalne se bhi unsaved grid/form ka data jaata hai: wahi guard
  const guarded = (fn: () => void) => () => {
    if (dirtyRef.current && !window.confirm("Unsaved changes will be lost. Continue?")) return;
    fn();
  };

  const navigate = (id: string) => {
    if (id === screen) return;
    if (dirtyRef.current && !window.confirm("Unsaved changes will be lost. Leave this screen?")) return;
    setScreen(id);
  };

  return (
    <div className="h-full flex flex-col">
      <Header
        companies={ctx.companies} companyId={companyId} branchId={branchId} fyId={fyId} userName={ctx.user.name} calendar={calendar}
        onToggleSidebar={toggleSidebar} onCompany={changeCompany} onBranch={(id) => guarded(() => setBranchId(id))()} onFy={(id) => guarded(() => setFyId(id))()}
        onCalendar={(c) => { setCalendar(c); localStorage.setItem("cal", c); }}
      />
      <div className="flex-1 min-h-0 flex">
        <Sidebar collapsed={collapsed} active={screen} onToggle={toggleSidebar} onNavigate={navigate} onNotify={(text) => setNote({ text, n: Date.now() })} />
        {/* key: screen ya company badalne par list reload + form reset */}
        {screen === "stock-opening" ? (
          <StockOpeningScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} fyId={fyId}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            calendar={calendar} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note}
          />
        ) : screen === "opening-balance" ? (
          <OpeningBalanceScreen
            key={`${screen}:${companyId}:${branchId}:${fyId}`} companyId={companyId} branchId={branchId} fyId={fyId} userId={ctx.user.id}
            branchName={co.branches.find((b) => b.id === branchId)?.name ?? "-"} fyCode={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
            setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note}
          />
        ) : (
        <MasterScreen key={`${screen}:${companyId}`} def={MASTERS[screen]} companyId={companyId} setStatus={setStatus} dirtyRef={dirtyRef} externalMessage={note} calendar={calendar} onContextChanged={refreshCtx} />
        )}
      </div>
      <StatusBar
        status={status} company={co.name}
        branch={co.branches.find((b) => b.id === branchId)?.name ?? "-"}
        fy={co.fiscalYears.find((y) => y.id === fyId)?.code ?? "-"}
      />
    </div>
  );
}
