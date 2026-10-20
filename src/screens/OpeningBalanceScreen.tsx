import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { AlertTriangle, Lock, LockOpen, RotateCcw, Save, Search } from "lucide-react";
import { ApiError, obApi, type ObData, type ObRow } from "../api";
import { editStr, fmtPaise, toPaise } from "../lib/money";
import type { MsgKind, StatusInfo } from "../types";
import { ConfirmDialog, type DialogSpec } from "../components/ConfirmDialog";
import { ShortcutsOverlay } from "../components/ShortcutsOverlay";

const HELP: [string, string][] = [
  ["Enter", "Debit amount ke baad agli row ka Debit; khali Debit par Credit"],
  ["Shift+Enter", "Pichla cell"],
  ["↑ / ↓", "Usi column me upar / neeche"],
  ["Ctrl+S", "Saare badlav save"],
  ["F4 / /", "Search (code ya naam)"],
  ["Esc", "Search se grid me wapas"],
  ["Ctrl+L", "Lock / Unlock opening balance"],
  ["F1 / ?", "Ye help"],
];
const HINTS = ["Enter: Next", "↑↓: Rows", "Ctrl+S: Save", "F4: Search", "Ctrl+L: Lock", "F1: Help"];
type Draft = Record<string, { dr: string; cr: string }>;
type Chip = "all" | "balance" | "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
const CHIPS: [Chip, string][] = [["all", "All"], ["balance", "With balance"], ["ASSET", "Assets"], ["LIABILITY", "Liabilities"], ["EQUITY", "Equity"], ["REVENUE", "Revenue"], ["EXPENSE", "Expense"]];
const PL = (t: string) => t === "REVENUE" || t === "EXPENSE";
const COLS = "88px 1fr 104px 132px 132px";

interface Props {
  companyId: number; branchId: number; fyId: number; userId: number;
  branchName: string; fyCode: string;
  setStatus: (s: StatusInfo) => void;
  dirtyRef: MutableRefObject<boolean>;
  externalMessage: { text: string; n: number } | null;
}

export default function OpeningBalanceScreen({ companyId, branchId, fyId, userId, branchName, fyCode, setStatus, dirtyRef, externalMessage }: Props) {
  const [data, setData] = useState<ObData | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [hideInactive, setHideInactive] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [help, setHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading…", kind: "info" });
  const searchRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const flash = (text: string, kind: MsgKind = "info") => setMsg({ text, kind });

  const load = async () => {
    try {
      const d = await obApi.get(companyId, branchId, fyId);
      setData(d); setDraft({});
      flash(`Loaded ${d.rows.length} ledger row(s)`, "info");
    } catch (e) { flash((e as Error).message, "err"); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, branchId, fyId]);
  useEffect(() => { if (externalMessage) flash(externalMessage.text, "info"); }, [externalMessage]);

  const fy = data?.fiscalYear;
  const readOnly = !fy || fy.isClosed || fy.isOpeningBalanceLocked;
  const dirty = Object.keys(draft).length > 0;
  useEffect(() => { dirtyRef.current = dirty; });
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Current (draft ya server) value of a row
  const cur = (r: ObRow) => draft[r.key] ?? { dr: editStr(r.debit), cr: editStr(r.credit) };
  const hasBal = (r: ObRow) => { const c = cur(r); return toPaise(c.dr) > 0 || toPaise(c.cr) > 0; };

  // ---- totals (paise integers) ----
  const totals = useMemo(() => {
    if (!data) return { dr: 0, cr: 0, companyDiff: 0, pl: 0, count: 0 };
    let dr = 0, cr = 0, pl = 0, count = 0;
    for (const r of data.rows) {
      const c = draft[r.key] ?? { dr: editStr(r.debit), cr: editStr(r.credit) };
      const d = toPaise(c.dr), k = toPaise(c.cr);
      dr += d; cr += k;
      if (d > 0 || k > 0) { count++; if (PL(r.groupType)) pl++; }
    }
    // Company-wide diff = server ki saari branches - is branch ka saved + is branch ka draft
    const sb = data.totals.branch, sc = data.totals.company;
    const companyDr = toPaise(sc.debit) - toPaise(sb.debit) + dr, companyCr = toPaise(sc.credit) - toPaise(sb.credit) + cr;
    return { dr, cr, companyDiff: companyDr - companyCr, pl, count };
  }, [data, draft]);
  const diff = totals.dr - totals.cr;

  const rows = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (hideInactive && !r.isActive && !hasBal(r)) return false;
      if (chip === "balance" ? !hasBal(r) : chip !== "all" && r.groupType !== chip) return false;
      return !s || `${r.code} ${r.name} ${r.subLedgerCode ?? ""} ${r.subLedgerName ?? ""}`.toLowerCase().includes(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, draft, search, chip, hideInactive]);

  useEffect(() => setStatus({ mode: dirty ? "edit" : "view", count: totals.count, shown: rows.length, message: msg.text, kind: msg.kind, hints: HINTS }), [dirty, totals.count, rows.length, msg, setStatus]);

  // ---- editing ----
  const sameAsBase = (r: ObRow, d: { dr: string; cr: string }) => d.dr === editStr(r.debit) && d.cr === editStr(r.credit);
  const edit = (r: ObRow, col: "dr" | "cr", raw: string) => {
    const v = raw.replace(/,/g, "");
    if (!/^\d{0,12}(\.\d{0,2})?$/.test(v)) return; // sirf digits aur max 2 decimals
    const c = cur(r);
    const next = { ...c, [col]: v };
    if (toPaise(v) > 0) next[col === "dr" ? "cr" : "dr"] = ""; // ek row me Debit ya Credit, dono nahi
    setDraft((p) => {
      const n = { ...p };
      if (sameAsBase(r, next)) delete n[r.key]; else n[r.key] = next;
      return n;
    });
  };

  const cell = (r: number, c: "dr" | "cr") => document.querySelector<HTMLInputElement>(`[data-cell="${r}:${c}"]`);
  const goto = (r: number, c: "dr" | "cr", step: 1 | -1) => {
    for (let i = r; i >= 0 && i < rows.length; i += step) { const el = cell(i, c); if (el && !el.disabled) { el.focus(); return; } }
    if (step === 1) document.querySelector<HTMLElement>("[data-save]")?.focus();
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number, c: "dr" | "cr", r: ObRow) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) return c === "cr" ? cell(i, "dr")?.focus() : goto(i - 1, "cr", -1);
      if (c === "dr") return cur(r).dr !== "" ? goto(i + 1, "dr", 1) : cell(i, "cr")?.focus(); // Debit bhara to Credit skip
      return goto(i + 1, "dr", 1);
    }
    if (e.key === "ArrowDown") { e.preventDefault(); goto(i + 1, c, 1); }
    if (e.key === "ArrowUp") { e.preventDefault(); goto(i - 1, c, -1); }
  };

  // ---- save ----
  const save = async () => {
    if (!data || readOnly || savingRef.current) return;
    if (!dirty) return flash("No changes to save.", "info");
    const items = data.rows.filter((r) => draft[r.key]).map((r) => ({
      generalLedgerId: r.generalLedgerId, subLedgerId: r.subLedgerId,
      debit: draft[r.key].dr || "0", credit: draft[r.key].cr || "0",
    }));
    savingRef.current = true; setSaving(true);
    try {
      const out = await obApi.save({ companyId, branchId, fiscalYearId: fyId, userId, items });
      await load();
      flash(`Saved: ${out.saved} updated, ${out.deleted} cleared.`, "ok");
    } catch (e) { flash((e as Error).message, "err"); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const reset = () => {
    if (!dirty) return;
    setDialog({
      title: "Discard changes?", body: `${Object.keys(draft).length} edited row(s) will be reverted.`,
      buttons: [
        { label: "Stay", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
        { label: "Discard", kind: "danger", onClick: () => { setDialog(null); setDraft({}); flash("Changes discarded.", "info"); } },
      ],
    });
  };

  // ---- lock / unlock ----
  // Stock opening ledger se match na kare to server "stockMismatch" deta hai: saaf warning, "Lock anyway" se hi aage
  const doLock = async (force: boolean) => {
    try { await obApi.lock({ companyId, fiscalYearId: fyId, userId, force }); await load(); flash("Opening balance locked.", "ok"); }
    catch (e) {
      if (e instanceof ApiError && e.field === "stockMismatch") {
        flash(e.message, "err");
        return setDialog({
          title: "Stock does not match the ledger", body: e.message,
          buttons: [
            { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
            { label: "Lock anyway", kind: "danger", onClick: () => { setDialog(null); void doLock(true); } },
          ],
        });
      }
      flash((e as Error).message, "err");
    }
  };
  const toggleLock = () => {
    if (!fy || fy.isClosed) return;
    if (fy.isOpeningBalanceLocked) {
      setDialog({
        title: "Unlock opening balance?", body: `FY ${fy.code}: opening balances ko dobara edit kiya ja sakega. Iska record audit me rakhna hoga.`,
        buttons: [
          { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
          { label: "Unlock", kind: "danger", onClick: async () => { setDialog(null); try { await obApi.unlock({ companyId, fiscalYearId: fyId }); await load(); flash("Opening balance unlocked.", "ok"); } catch (e) { flash((e as Error).message, "err"); } } },
        ],
      });
      return;
    }
    if (dirty) return flash("Save the changes before locking.", "err");
    if (totals.companyDiff !== 0) {
      const t = `Cannot lock: company-wide opening balance is not balanced (difference ${fmtPaise(totals.companyDiff)} ${totals.companyDiff > 0 ? "Dr" : "Cr"}).`;
      flash(t, "err");
      return setDialog({ title: "Cannot lock", body: t, buttons: [{ label: "OK", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) }] });
    }
    setDialog({
      title: "Lock opening balance?", body: `FY ${fy.code}: Dr = Cr. Lock ke baad koi edit nahi hoga jab tak Unlock na ho.`,
      buttons: [
        { label: "Cancel", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
        { label: "Lock", kind: "primary", onClick: () => { setDialog(null); void doLock(false); } },
      ],
    });
  };

  // ---- global shortcuts ----
  const H = useRef({ save, toggleLock, dialogOpen: false, help: false });
  H.current = { save, toggleLock, dialogOpen: !!dialog, help };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = H.current;
      if (h.dialogOpen) return;
      if (h.help) { if (e.key === "Escape" || e.key === "F1") { e.preventDefault(); setHelp(false); } return; }
      const ctrl = e.ctrlKey || e.metaKey, kl = e.key.toLowerCase();
      const typing = (e.target as HTMLElement).tagName === "INPUT";
      if (ctrl && kl === "s") { e.preventDefault(); void h.save(); }
      else if (ctrl && kl === "l") { e.preventDefault(); h.toggleLock(); }
      else if (e.key === "F4" || (ctrl && kl === "f") || (e.key === "/" && !typing)) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F1" || (e.key === "?" && !typing)) { e.preventDefault(); setHelp(true); }
      else if (e.altKey && e.key === "1") { e.preventDefault(); document.querySelector<HTMLElement>("[data-zone=sidebar] button[data-sb]")?.focus(); }
      else if (e.altKey && e.key === "2") { e.preventDefault(); goto(0, "dr", 1); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  const fmtDate = (iso?: string | null) => (iso ? iso.slice(0, 10) : "");
  const status = !fy ? "" : fy.isClosed ? "CLOSED" : fy.isOpeningBalanceLocked ? "LOCKED" : "OPEN";
  const balanced = diff === 0;

  return (
    <>
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex items-end gap-3">
            <h1 className="text-[22px] font-semibold">Opening Balance</h1>
            <span className="pb-1 text-slate-600">Branch: <b>{branchName}</b> · FY <b>{fyCode}</b> {fy && <span className="tabular-nums">({fmtDate(fy.startDate)} to {fmtDate(fy.endDate)} AD)</span>}</span>
            {fy && <span className={`mb-1 text-[10px] font-semibold px-1.5 py-px border rounded-sm ${status === "OPEN" ? "bg-green-100 text-green-800 border-green-300" : "bg-amber-100 text-amber-800 border-amber-300"}`}>{status}</span>}
            {dirty && <span className="pb-1 text-[11px] text-amber-700">• {Object.keys(draft).length} unsaved</span>}
          </div>
          <div className="double-rule mt-1" />
          {fy?.isOpeningBalanceLocked && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1"><Lock size={13} /> Locked{fy.lockedByName ? ` by ${fy.lockedByName}` : ""}{fy.lockedAt ? ` on ${fmtDate(fy.lockedAt)}` : ""}. Unlock (Ctrl+L) to edit.</p>}
          {fy?.isClosed && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1"><Lock size={13} /> This fiscal year is closed. Opening balances are read-only.</p>}
        </div>

        <div className="px-4 pb-2 flex flex-wrap items-center gap-2 shrink-0">
          <div className="relative w-[260px]">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search code or name…  (F4)" aria-label="Search ledgers" className="fld pl-7"
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); goto(0, "dr", 1); } }} />
          </div>
          <div className="flex gap-1">
            {CHIPS.map(([k, label]) => (
              <button key={k} onClick={() => setChip(k)} aria-pressed={chip === k} className={`h-7 px-2 text-[12px] border rounded-sm ${chip === k ? "bg-navy text-white border-navy" : "bg-white border-slate-400 hover:bg-slate-100"}`}>{label}</button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[12px] ml-1"><input type="checkbox" className="accent-blue-800" checked={hideInactive} onChange={(e) => setHideInactive(e.target.checked)} /> Hide inactive</label>
        </div>

        {/* grid: sirf andar ka scroll */}
        <div className="mx-4 flex-1 min-h-0 border border-slate-400 bg-white/60 flex flex-col">
          <div style={{ gridTemplateColumns: COLS }} className="grid px-2 py-1 text-[11px] font-semibold text-slate-600 border-b border-slate-300 bg-slate-100 shrink-0">
            <span>Code</span><span>Ledger</span><span>Group</span><span className="text-right pr-2">Debit</span><span className="text-right pr-2">Credit</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!data && <div className="p-4 text-slate-500">Loading…</div>}
            {data && rows.length === 0 && <div className="p-4 text-slate-500">No ledgers match.</div>}
            {rows.map((r, i) => {
              const c = cur(r);
              const edited = !!draft[r.key];
              const off = readOnly || r.needsSubLedger;
              const abnormal = (side: "DEBIT" | "CREDIT") => r.normalBalance !== side;
              const input = (col: "dr" | "cr") => {
                const id = `${r.key}:${col}`, val = c[col];
                const side = col === "dr" ? "DEBIT" : "CREDIT";
                return (
                  <input
                    data-cell={`${i}:${col}`} disabled={off} inputMode="decimal" autoComplete="off" aria-label={`${r.code} ${col === "dr" ? "debit" : "credit"}`}
                    value={focus === id ? val : val ? fmtPaise(toPaise(val)) : ""}
                    onFocus={(e) => { setFocus(id); e.currentTarget.select(); }} onBlur={() => setFocus(null)}
                    onChange={(e) => edit(r, col, e.target.value)} onKeyDown={(e) => onKey(e, i, col, r)}
                    title={val && abnormal(side) ? `Normal balance of this ledger is ${r.normalBalance === "DEBIT" ? "Debit" : "Credit"}` : undefined}
                    className={`fld h-7 text-right tabular-nums ${val && abnormal(side) ? "bg-amber-50 border-amber-400" : ""} ${off ? "bg-slate-100 text-slate-500" : ""}`}
                  />
                );
              };
              return (
                <div key={r.key} style={{ gridTemplateColumns: COLS }} className={`grid items-center gap-x-1 px-2 h-8 border-b border-slate-200 ${edited ? "bg-yellow-50" : ""} ${!r.isActive ? "text-slate-500" : ""}`}>
                  <span className="font-mono tabular-nums truncate">{r.code}</span>
                  <span className="truncate pr-2" title={`${r.name}${r.subLedgerName ? " › " + r.subLedgerName : ""}`}>
                    {r.name}{r.subLedgerCode && <span className="text-slate-600"> › {r.subLedgerCode} {r.subLedgerName}</span>}
                    {r.needsSubLedger && <span className="ml-2 text-[11px] text-amber-700">Sub Ledger required — add one in Sub Ledger master</span>}
                    {PL(r.groupType) && <span className="ml-1.5 text-[10px] px-1 border border-slate-300 rounded-sm text-slate-500">P&amp;L</span>}
                  </span>
                  <span className="text-[12px] text-slate-600 truncate">{r.groupCode} / {r.subGroupCode}</span>
                  {input("dr")}{input("cr")}
                </div>
              );
            })}
          </div>
        </div>

        {/* totals + actions: hamesha dikhte hain */}
        <div className="shrink-0 mx-4 my-2 border border-slate-400 bg-slate-50">
          <div className="flex items-center gap-6 px-3 py-1.5 text-[13px]">
            <span>Total Debit <b className="tabular-nums ml-1">{fmtPaise(totals.dr)}</b></span>
            <span>Total Credit <b className="tabular-nums ml-1">{fmtPaise(totals.cr)}</b></span>
            <span className={`font-semibold tabular-nums ${balanced ? "text-green-700" : "text-red-700"}`}>
              {balanced ? "✓ Balanced (this branch)" : `Difference ${fmtPaise(diff)} ${diff > 0 ? "Dr" : "Cr"} excess`}
            </span>
            <span className="flex-1" />
            <span className={`text-[12px] ${totals.companyDiff === 0 ? "text-slate-600" : "text-amber-700"}`}>
              Company-wide: {totals.companyDiff === 0 ? "balanced" : `${fmtPaise(totals.companyDiff)} ${totals.companyDiff > 0 ? "Dr" : "Cr"} difference`}
            </span>
          </div>
          {totals.pl > 0 && <p className="px-3 pb-1 text-[12px] text-amber-800 flex items-center gap-1"><AlertTriangle size={12} /> {totals.pl} P&amp;L (Revenue/Expense) ledger(s) have an opening balance. Normally only Balance Sheet ledgers carry one.</p>}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-300">
            <button data-save className="btn btn-primary" disabled={readOnly || saving || !dirty} onClick={() => void save()}><Save size={14} /> Save <span className="kbd">Ctrl+S</span></button>
            <button className="btn" disabled={!dirty} onClick={reset}><RotateCcw size={14} /> Reset</button>
            <span className="flex-1" />
            <button className="btn" disabled={!fy || fy.isClosed} onClick={toggleLock}>
              {fy?.isOpeningBalanceLocked ? <><LockOpen size={14} /> Unlock</> : <><Lock size={14} /> Lock</>} <span className="kbd">Ctrl+L</span>
            </button>
          </div>
        </div>
      </main>
      {dialog && <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />}
      {help && <ShortcutsOverlay onClose={() => setHelp(false)} shortcuts={HELP} />}
    </>
  );
}
