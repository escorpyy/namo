import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import { Building2 } from "lucide-react";
import { ApiError, companyApi, type CompanySetupMode } from "../api";
import { useDialog } from "../components/Dialog";
import { adToBs, bsToAd } from "../lib/nepaliDate";
import type { MsgKind, StatusInfo } from "../types";

interface Props {
  userId: number;
  setStatus: (status: StatusInfo) => void;
  dirtyRef: MutableRefObject<boolean>;
  /** Called after the company exists: the app reloads its company list and switches to the new company. */
  onCreated: (companyId: number, setup: CompanySetupMode) => Promise<void>;
}

const BUSINESS_TYPES = [
  { value: "PRIVATE_LIMITED", label: "Private Limited" },
  { value: "PUBLIC_LIMITED", label: "Public Limited" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "SOLE_PROPRIETORSHIP", label: "Sole Proprietorship" },
  { value: "OTHER", label: "Other" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const addDays = (ad: string, days: number) => {
  const [y, m, d] = ad.split("-").map(Number);
  const t = new Date(y, m - 1, d + days);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
};

// The Nepali fiscal year that contains today: it starts on 1 Shrawan (BS month 4). Falls back to empty fields outside the converter's range.
function currentFiscalYear() {
  const t = new Date();
  const today = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const bs = adToBs(today);
  if (!bs) return { code: "", start: "", end: "" };
  const [y, m] = bs.split("-").map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const start = bsToAd(`${startYear}-04-01`) ?? "";
  const nextStart = bsToAd(`${startYear + 1}-04-01`);
  return { code: `${startYear}/${String(startYear + 1).slice(-3)}`, start, end: nextStart ? addDays(nextStart, -1) : "" };
}

const HINTS = ["Ctrl+S create company"];

export default function NewCompanyScreen({ userId, setStatus, dirtyRef, onCreated }: Props) {
  const dlg = useDialog();
  const fy = useMemo(currentFiscalYear, []);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("PRIVATE_LIMITED");
  const [fiscalYearCode, setFiscalYearCode] = useState(fy.code);
  const [startDate, setStartDate] = useState(fy.start);
  const [endDate, setEndDate] = useState(fy.end);
  const [setup, setSetup] = useState<CompanySetupMode>("DEFAULT");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);

  const dirty = code !== "" || name !== "";
  useEffect(() => { dirtyRef.current = dirty; return () => { dirtyRef.current = false; }; }, [dirty, dirtyRef]);
  useEffect(() => {
    setStatus({ mode: "new", count: 0, shown: 0, message: err ? err.message : "Choose how the new company starts, then create it.", kind: (err ? "err" : "info") as MsgKind, hints: HINTS });
  }, [err, setStatus]);

  const create = async () => {
    if (busy) return;
    if (setup === "BLANK" && !(await dlg.confirm(
      "A blank company has no account groups, ledgers or GL Setup. You will have to create them yourself before posting any entry.",
      { title: "Create a blank company?", variant: "warning", confirmLabel: "Create blank company" },
    ))) return;
    setBusy(true); setErr(null);
    try {
      const created = await companyApi.create({ code, name, businessType, fiscalYearCode, startDate, endDate, setup, userId });
      dirtyRef.current = false;
      await onCreated(created.id, created.setup);
    } catch (e) {
      setErr({ field: e instanceof ApiError ? e.field : undefined, message: e instanceof Error ? e.message : "Could not create the company." });
    } finally {
      setBusy(false);
    }
  };

  // Ctrl+S, like the other screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void create(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const fieldErr = (f: string) => (err?.field === f ? <p role="alert" className="mt-0.5 text-[12px] text-red-700">{err.message}</p> : null);
  const bsOf = (ad: string) => (ad ? adToBs(ad) : null);

  const option = (value: CompanySetupMode, title: string, text: string, badge?: string) => (
    <label className={`flex cursor-pointer gap-3 rounded border p-3 ${setup === value ? "border-blue-700 bg-blue-50" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
      <input type="radio" name="setup" className="mt-1 h-4 w-4 accent-blue-800" checked={setup === value} onChange={() => setSetup(value)} />
      <span>
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">{title}{badge && <span className="rounded bg-emerald-100 px-1.5 text-[11px] font-medium text-emerald-700">{badge}</span>}</span>
        <span className="mt-0.5 block text-[12px] text-slate-600">{text}</span>
      </span>
    </label>
  );

  return (
    <div className="mx-auto max-w-3xl p-5">
      <h1 className="flex items-center gap-2 text-[16px] font-semibold text-slate-800"><Building2 size={18} /> New Company</h1>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label className="text-[12px] font-medium text-slate-600">Code *</label>
          <input className={`fld font-mono ${err?.field === "code" ? "fld-err" : ""}`} maxLength={15} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          {fieldErr("code")}
        </div>
        <div>
          <label className="text-[12px] font-medium text-slate-600">Business Type *</label>
          <select className="fld" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
            {BUSINESS_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {fieldErr("businessType")}
        </div>
        <div className="col-span-2">
          <label className="text-[12px] font-medium text-slate-600">Name *</label>
          <input className={`fld ${err?.field === "name" ? "fld-err" : ""}`} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
          {fieldErr("name")}
        </div>
        <div>
          <label className="text-[12px] font-medium text-slate-600">First Fiscal Year *</label>
          <input className={`fld font-mono ${err?.field === "fiscalYearCode" ? "fld-err" : ""}`} maxLength={15} value={fiscalYearCode} onChange={(e) => setFiscalYearCode(e.target.value)} />
          {fieldErr("fiscalYearCode")}
        </div>
        <div />
        <div>
          <label className="text-[12px] font-medium text-slate-600">Starts (AD) *</label>
          <input type="date" className={`fld ${err?.field === "startDate" ? "fld-err" : ""}`} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <p className="mt-0.5 text-[11px] text-slate-500">{bsOf(startDate) ? `BS ${bsOf(startDate)}` : ""}</p>
          {fieldErr("startDate")}
        </div>
        <div>
          <label className="text-[12px] font-medium text-slate-600">Ends (AD) *</label>
          <input type="date" className={`fld ${err?.field === "endDate" ? "fld-err" : ""}`} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <p className="mt-0.5 text-[11px] text-slate-500">{bsOf(endDate) ? `BS ${bsOf(endDate)}` : ""}</p>
          {fieldErr("endDate")}
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-[12px] font-medium text-slate-600">How should this company start? *</legend>
        <div className="mt-1.5 grid gap-2">
          {option("DEFAULT", "Start with default data", "Standard chart of accounts (groups, sub groups and ledgers) and GL Setup are ready, so you can post entries right away.", "Recommended")}
          {option("BLANK", "Blank company", "Only the company, its Head Office and the fiscal year. You create the account groups, ledgers and GL Setup yourself.")}
        </div>
        {fieldErr("setup")}
      </fieldset>

      <div className="mt-5 flex justify-end">
        <button type="button" disabled={busy} onClick={() => void create()} className="rounded bg-blue-800 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-blue-900 disabled:opacity-60">
          {busy ? "Creating…" : "Create Company"}
        </button>
      </div>
    </div>
  );
}
