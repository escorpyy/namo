import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { AlertTriangle, Lock, Plus, RotateCcw, Save, Search, X } from "lucide-react";
import { mulRound2 } from "../../shared/decimal";
import type { Opt } from "../../shared/masters";
import { soApi, type SoData, type SoLine } from "../api";
import { fmtPaise, toPaise } from "../lib/money";
import type { MsgKind, StatusInfo } from "../types";
import { Combobox } from "../components/Combobox";
import { ConfirmDialog, type DialogSpec } from "../components/ConfirmDialog";
import { DateInput } from "../components/DateInput";
import { ShortcutsOverlay } from "../components/ShortcutsOverlay";

const HELP: [string, string][] = [
  ["Enter", "Agla cell; aakhri row ke Rate par Enter = nayi row"],
  ["Shift+Enter", "Pichla cell"],
  ["↑ / ↓", "Usi column me upar / neeche (text cells)"],
  ["Shift+Delete", "Row hatao"],
  ["Ctrl+S", "Saare badlav save"],
  ["F4 / /", "Search"],
  ["Alt+2", "Grid par jao"],
  ["F1 / ?", "Ye help"],
];
const HINTS = ["Enter: Next", "Ctrl+S: Save", "Shift+Del: Remove row", "F4: Search", "F1: Help"];
const COLS = "minmax(180px,1.6fr) minmax(110px,1fr) 104px 128px 92px 96px 116px 28px";

interface Row { key: string; id?: number; sd: string; loc: string; batch: string; exp: string; qty: string; rate: string }
const newKey = () => Math.random().toString(36).slice(2);
const trimDec = (v: string) => (v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v);
const blankRow = (loc = ""): Row => ({ key: newKey(), sd: "", loc, batch: "", exp: "", qty: "", rate: "" });
const isBlank = (r: Row) => !r.sd && !r.qty && !r.rate && !r.batch && !r.exp;
const fromLine = (l: SoLine): Row => ({ key: newKey(), id: l.id, sd: String(l.stockDetailId), loc: l.locationId ? String(l.locationId) : "", batch: l.batchNo ?? "", exp: l.expiryDate ? l.expiryDate.slice(0, 10) : "", qty: trimDec(l.quantity), rate: trimDec(l.rate) });
const sig = (r: Row) => [r.sd, r.loc, r.batch, r.exp, r.qty, r.rate].join("|");
const cents = (s: string) => { const neg = s.startsWith("-"); const c = toPaise(neg ? s.slice(1) : s); return neg ? -c : c; };

interface Props {
  companyId: number; branchId: number; fyId: number; branchName: string; fyCode: string; calendar: "BS" | "AD";
  setStatus: (s: StatusInfo) => void; dirtyRef: MutableRefObject<boolean>; externalMessage: { text: string; n: number } | null;
}

export default function StockOpeningScreen({ companyId, branchId, fyId, branchName, fyCode, calendar, setStatus, dirtyRef, externalMessage }: Props) {
  const [data, setData] = useState<SoData | null>(null);
  const [orig, setOrig] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [errs, setErrs] = useState<Record<string, { col: string; msg: string }>>({});
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [help, setHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading…", kind: "info" });
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const flash = (text: string, kind: MsgKind = "info") => setMsg({ text, kind });

  const load = async () => {
    try {
      const d = await soApi.get(companyId, branchId, fyId);
      const r = d.lines.map(fromLine);
      setData(d); setOrig(r); setRows(r.length ? r.map((x) => ({ ...x })) : [blankRow()]); setErrs({});
      flash(`Loaded ${d.lines.length} stock line(s)`, "info");
    } catch (e) { flash((e as Error).message, "err"); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, branchId, fyId]);
  useEffect(() => { if (externalMessage) flash(externalMessage.text, "info"); }, [externalMessage]);

  const fy = data?.fiscalYear;
  const readOnly = !fy || fy.isClosed || fy.isOpeningBalanceLocked;
  const prodBy = useMemo(() => new Map((data?.products ?? []).map((p) => [String(p.stockDetailId), p])), [data]);

  const live = useMemo(() => rows.filter((r) => !isBlank(r)), [rows]);
  const origMap = useMemo(() => new Map(orig.map((r) => [r.id!, sig(r)])), [orig]);
  const upserts = live.filter((r) => r.id == null || origMap.get(r.id) !== sig(r));
  const deletes = orig.filter((o) => !live.some((r) => r.id === o.id)).map((o) => o.id!);
  const dirty = upserts.length > 0 || deletes.length > 0;
  useEffect(() => { dirtyRef.current = dirty; });
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const valueOf = (r: Row) => (r.qty && r.rate ? mulRound2(r.qty, r.rate) : "");

  // ---- totals + reconciliation (live: unsaved edits bhi) ----
  const summary = useMemo(() => {
    let total = 0;
    const byGl = new Map<number | null, number>();
    for (const r of live) {
      const c = toPaise(valueOf(r) || "0");
      total += c;
      const gl = prodBy.get(r.sd)?.closingBSGLId ?? null;
      byGl.set(gl, (byGl.get(gl) ?? 0) + c);
    }
    const lines: { label: string; stock: number; ledger: number }[] = [];
    for (const g of data?.ledgers ?? []) lines.push({ label: `${g.code} ${g.name}`, stock: byGl.get(g.id) ?? 0, ledger: cents(g.balance) });
    if ((byGl.get(null) ?? 0) !== 0) lines.push({ label: "Products without Closing Stock GL", stock: byGl.get(null)!, ledger: 0 });
    return { total, lines, bad: lines.filter((l) => l.stock !== l.ledger) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, data, prodBy]);

  useEffect(() => setStatus({ mode: dirty ? "edit" : "view", count: live.length, shown: live.length, message: msg.text, kind: msg.kind, hints: HINTS }), [dirty, live.length, msg, setStatus]);

  // ---- options ----
  const productOpts = useMemo<Opt[]>(() => (data?.products ?? []).filter((p) => p.isActive || rows.some((r) => r.sd === String(p.stockDetailId))).map((p) => ({ value: String(p.stockDetailId), label: `${p.code} — ${p.description} (${p.unitCode})`, short: p.code })), [data, rows]);
  const locOpts = useMemo<Opt[]>(() => (data?.locations ?? []).filter((l) => l.isActive || rows.some((r) => r.loc === String(l.id))).map((l) => ({ value: String(l.id), label: `${l.code} — ${l.name}`, short: l.code })), [data, rows]);

  // ---- edit helpers ----
  const patch = (key: string, p: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r))); setErrs((e) => { const n = { ...e }; delete n[key]; return n; }); };
  const pickProduct = (r: Row, sd: string) => {
    const p = prodBy.get(sd);
    const qtyOk = p && (r.qty.split(".")[1]?.length ?? 0) <= p.decimals ? r.qty : r.qty.split(".")[0];
    patch(r.key, {
      sd, qty: sd ? qtyOk : r.qty,
      batch: p?.tracksBatch ? r.batch : "", exp: p?.tracksExpiry ? r.exp : "",
      loc: r.loc || (p?.defaultLocationId ? String(p.defaultLocationId) : ""), // product ki default location (dikhta hai, badal sakte ho)
    });
  };
  const addRow = () => {
    const last = rows[rows.length - 1];
    const nr = blankRow(last?.loc ?? ""); // pichli row ki location aage badhti hai (visible)
    setRows((rs) => [...rs, nr]);
    setTimeout(() => gridRef.current?.querySelector<HTMLElement>(`[data-field="L.${rows.length}.p"]`)?.focus(), 40);
  };
  const removeRow = (r: Row) => setRows((rs) => { const n = rs.filter((x) => x.key !== r.key); return n.length ? n : [blankRow()]; });

  // ---- keyboard ----
  const cells = () => Array.from(gridRef.current?.querySelectorAll<HTMLInputElement>('[data-field^="L."]') ?? []).filter((el) => !el.disabled);
  const step = (el: Element, dir: 1 | -1) => {
    const all = cells(), i = all.indexOf(el as HTMLInputElement);
    if (dir === 1 && i === all.length - 1) { if (!isBlank(rows[rows.length - 1])) addRow(); return; }
    all[i + dir]?.focus();
  };
  const onGridKey = (e: React.KeyboardEvent) => {
    const el = e.target as HTMLElement, f = el.getAttribute("data-field") ?? "";
    const m = /^L\.(\d+)\.(\w)$/.exec(f);
    if (!m) return;
    const i = Number(m[1]), col = m[2];
    if (e.key === "Enter") { e.preventDefault(); step(el, e.shiftKey ? -1 : 1); }
    else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && el.getAttribute("role") !== "combobox") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      for (let k = i + dir; k >= 0 && k < rows.length; k += dir) { const t = gridRef.current?.querySelector<HTMLInputElement>(`[data-field="L.${k}.${col}"]`); if (t && !t.disabled) { t.focus(); break; } }
    } else if (e.key === "Delete" && e.shiftKey) { e.preventDefault(); e.stopPropagation(); removeRow(rows[i]); }
  };

  // ---- save ----
  const validateRows = () => {
    const out: Record<string, { col: string; msg: string }> = {};
    const seen = new Map<string, string>();
    live.forEach((r) => {
      const p = prodBy.get(r.sd);
      const bad = (col: string, msg: string) => { if (!out[r.key]) out[r.key] = { col, msg }; };
      if (!p) return bad("p", "Select a product.");
      const d = r.qty.split(".")[1]?.length ?? 0;
      if (!r.qty || Number(r.qty) <= 0) bad("q", `${p.code}: quantity must be greater than 0.`);
      else if (d > p.decimals) bad("q", `${p.code}: ${p.unitCode} allows at most ${p.decimals} decimal place(s).`);
      if (r.rate === "") bad("r", `${p.code}: rate is required (0 allowed).`);
      if (p.tracksBatch && !r.batch.trim()) bad("b", `${p.code}: batch no is required.`);
      if (p.tracksExpiry && (!r.exp || r.exp.startsWith("?"))) bad("e", `${p.code}: a valid expiry date is required.`);
      const k = `${r.sd}|${r.loc}|${r.batch.trim().toLowerCase()}`;
      if (seen.has(k)) bad("p", `${p.code}: same product / location / batch appears twice.`); else seen.set(k, r.key);
    });
    return out;
  };
  const save = async () => {
    if (!data || readOnly || savingRef.current) return;
    if (!dirty) return flash("No changes to save.", "info");
    const e = validateRows();
    setErrs(e);
    const firstKey = live.find((r) => e[r.key])?.key;
    if (firstKey) {
      flash(e[firstKey].msg, "err");
      const i = rows.findIndex((r) => r.key === firstKey);
      gridRef.current?.querySelector<HTMLElement>(`[data-field="L.${i}.${e[firstKey].col}"]`)?.focus();
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
      const out = await soApi.save({
        companyId, branchId, fiscalYearId: fyId,
        upserts: upserts.map((r) => ({
          id: r.id, stockDetailId: Number(r.sd), locationId: r.loc ? Number(r.loc) : null, batchNo: r.batch.trim() || null,
          expiryDate: r.exp || null, quantity: r.qty, rate: r.rate, value: mulRound2(r.qty, r.rate),
        })),
        deletes,
      });
      await load();
      flash(`Saved: ${out.saved} line(s) saved, ${out.deleted} removed.`, "ok");
    } catch (er) { flash((er as Error).message, "err"); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const reset = () => {
    if (!dirty) return;
    setDialog({
      title: "Discard changes?", body: "Saare unsaved badlav hat jayenge.",
      buttons: [
        { label: "Stay", kind: "neutral", autoFocus: true, onClick: () => setDialog(null) },
        { label: "Discard", kind: "danger", onClick: () => { setDialog(null); setRows(orig.length ? orig.map((x) => ({ ...x })) : [blankRow()]); setErrs({}); flash("Changes discarded.", "info"); } },
      ],
    });
  };

  const H = useRef({ save, dialogOpen: false, help: false });
  H.current = { save, dialogOpen: !!dialog, help };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const h = H.current;
      if (h.dialogOpen) return;
      if (h.help) { if (e.key === "Escape" || e.key === "F1") { e.preventDefault(); setHelp(false); } return; }
      const ctrl = e.ctrlKey || e.metaKey, kl = e.key.toLowerCase(), typing = (e.target as HTMLElement).tagName === "INPUT";
      if (ctrl && kl === "s") { e.preventDefault(); void h.save(); }
      else if (e.key === "F4" || (ctrl && kl === "f") || (e.key === "/" && !typing)) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === "F1" || (e.key === "?" && !typing)) { e.preventDefault(); setHelp(true); }
      else if (e.altKey && e.key === "1") { e.preventDefault(); document.querySelector<HTMLElement>("[data-zone=sidebar] button[data-sb]")?.focus(); }
      else if (e.altKey && e.key === "2") { e.preventDefault(); gridRef.current?.querySelector<HTMLElement>('[data-field^="L."]:not(:disabled)')?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const s = search.trim().toLowerCase();
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (!s) return true;
    const p = prodBy.get(r.sd);
    return `${p?.code ?? ""} ${p?.description ?? ""} ${r.batch}`.toLowerCase().includes(s) || isBlank(r);
  });
  const status = !fy ? "" : fy.isClosed ? "CLOSED" : fy.isOpeningBalanceLocked ? "LOCKED" : "OPEN";
  const diffAll = summary.bad.reduce((a, l) => a + (l.stock - l.ledger), 0);

  return (
    <>
      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="px-4 pt-3 pb-2 shrink-0">
          <div className="flex items-end gap-3">
            <h1 className="text-[22px] font-semibold">Stock Opening Balance</h1>
            <span className="pb-1 text-slate-600">Branch: <b>{branchName}</b> · FY <b>{fyCode}</b></span>
            {fy && <span className={`mb-1 text-[10px] font-semibold px-1.5 py-px border rounded-sm ${status === "OPEN" ? "bg-green-100 text-green-800 border-green-300" : "bg-amber-100 text-amber-800 border-amber-300"}`}>{status}</span>}
            {dirty && <span className="pb-1 text-[11px] text-amber-700">• {upserts.length + deletes.length} unsaved</span>}
          </div>
          <div className="double-rule mt-1" />
          {readOnly && fy && <p className="mt-2 flex items-center gap-1.5 text-[12px] text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1"><Lock size={13} /> {fy.isClosed ? "This fiscal year is closed." : "Opening balance is locked."} Stock opening is read-only{!fy.isClosed && " (unlock from the Opening Balance screen)"}.</p>}
        </div>

        <div className="px-4 pb-2 flex items-center gap-2 shrink-0">
          <div className="relative w-[260px]">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
            <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product or batch…  (F4)" aria-label="Search" className="fld pl-7"
              onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => { if (e.key === "Escape" || e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); gridRef.current?.querySelector<HTMLElement>('[data-field^="L."]:not(:disabled)')?.focus(); } }} />
          </div>
          <span className="text-[12px] text-slate-500">Value = Quantity × Rate (2 decimals me round); ledger se match hona zaroori hai.</span>
        </div>

        <div className="mx-4 flex-1 min-h-0 border border-slate-400 bg-white/60 flex flex-col">
          <div style={{ gridTemplateColumns: COLS }} className="grid gap-x-1 px-2 py-1 text-[11px] font-semibold text-slate-600 border-b border-slate-300 bg-slate-100 shrink-0">
            <span>Product</span><span>Location</span><span>Batch</span><span>Expiry ({calendar})</span><span className="text-right pr-2">Quantity</span><span className="text-right pr-2">Rate</span><span className="text-right pr-2">Value</span><span />
          </div>
          <div ref={gridRef} onKeyDown={onGridKey} className="flex-1 min-h-0 overflow-y-auto">
            {!data && <div className="p-4 text-slate-500">Loading…</div>}
            {data && data.products.length === 0 && <div className="p-4 text-slate-500">Koi Stock-type product nahi hai. Pehle Product master me Stock product banao.</div>}
            {shown.map(({ r, i }) => {
              const p = prodBy.get(r.sd), er = errs[r.key];
              const off = readOnly;
              const cls = (col: string, extra = "") => `fld h-8 ${extra} ${er?.col === col ? "fld-err" : ""} ${off ? "bg-slate-100 text-slate-500" : ""}`;
              const dec = p?.decimals ?? 0;
              return (
                <div key={r.key} className={`border-b border-slate-200 ${er ? "bg-red-50" : upserts.includes(r) ? "bg-yellow-50" : ""}`}>
                  <div style={{ gridTemplateColumns: COLS }} className="grid gap-x-1 px-2 py-1 items-center">
                    <Combobox fieldName={`L.${i}.p`} placeholder="Product…" value={r.sd} hasError={er?.col === "p"} options={productOpts} onChange={(v) => pickProduct(r, v)} onCommit={(el) => step(el, 1)} />
                    <Combobox fieldName={`L.${i}.l`} placeholder="Location (optional)" value={r.loc} hasError={false} options={locOpts} onChange={(v) => patch(r.key, { loc: v })} onCommit={(el) => step(el, 1)} />
                    <input data-field={`L.${i}.b`} disabled={off || !p?.tracksBatch} placeholder={p && !p.tracksBatch ? "—" : "Batch"} value={r.batch} maxLength={50} autoComplete="off"
                      onChange={(e) => patch(r.key, { batch: e.target.value })} onFocus={(e) => e.currentTarget.select()} className={cls("b", !p?.tracksBatch ? "bg-slate-100" : "")} />
                    {p?.tracksExpiry && !off
                      ? <DateInput fieldName={`L.${i}.e`} value={r.exp} onChange={(v) => patch(r.key, { exp: v })} calendar={calendar} hasError={er?.col === "e"} onBlurField={() => {}} compact />
                      : <input data-field={`L.${i}.e`} disabled value={p?.tracksExpiry ? r.exp : ""} placeholder="—" className="fld h-8 bg-slate-100 text-slate-500" readOnly />}
                    <input data-field={`L.${i}.q`} disabled={off || !p} inputMode="decimal" autoComplete="off" value={r.qty} placeholder={p ? `0${dec ? "." + "0".repeat(dec) : ""}` : ""}
                      onChange={(e) => { const x = e.target.value; const re = dec === 0 ? /^\d{0,12}$/ : new RegExp(`^\\d{0,12}(\\.\\d{0,${dec}})?$`); if (re.test(x)) patch(r.key, { qty: x }); }}
                      onFocus={(e) => e.currentTarget.select()} className={cls("q", "text-right tabular-nums")} aria-label="Quantity" />
                    <input data-field={`L.${i}.r`} disabled={off || !p} inputMode="decimal" autoComplete="off" value={r.rate} placeholder="0.00"
                      onChange={(e) => { const x = e.target.value; if (/^\d{0,12}(\.\d{0,6})?$/.test(x)) patch(r.key, { rate: x }); }}
                      onFocus={(e) => e.currentTarget.select()} className={cls("r", "text-right tabular-nums")} aria-label="Rate" />
                    <span className="text-right pr-2 tabular-nums font-medium">{valueOf(r) ? fmtPaise(toPaise(valueOf(r))) : ""}</span>
                    <button type="button" tabIndex={-1} disabled={off} onClick={() => removeRow(r)} title="Remove row (Shift+Delete)" aria-label="Remove row" className="h-8 grid place-items-center text-slate-500 hover:text-red-700 disabled:opacity-30"><X size={14} /></button>
                  </div>
                  {er && <p className="px-3 pb-1 text-[12px] text-red-700">{er.msg}</p>}
                </div>
              );
            })}
            {!readOnly && data && data.products.length > 0 && <div className="px-2 py-1.5"><button type="button" className="btn h-7" onClick={addRow}><Plus size={13} /> Add line</button></div>}
          </div>
        </div>

        <div className="shrink-0 mx-4 my-2 border border-slate-400 bg-slate-50">
          <div className="flex items-center gap-6 px-3 py-1.5 text-[13px]">
            <span>Lines <b className="tabular-nums ml-1">{live.length}</b></span>
            <span>Total Value <b className="tabular-nums ml-1">{fmtPaise(summary.total)}</b></span>
            <span className="flex-1" />
            {summary.lines.length === 0
              ? <span className="text-[12px] text-slate-500">Koi Closing Stock GL (B/S) mapped nahi: ledger se tulna nahi ho sakti</span>
              : summary.bad.length === 0
                ? <span className="text-[12px] font-semibold text-green-700">✓ Stock matches ledger ({summary.lines.length})</span>
                : <span className="text-[12px] font-semibold text-amber-700">Stock vs ledger difference {fmtPaise(diffAll)} {diffAll > 0 ? "(stock higher)" : "(ledger higher)"}</span>}
          </div>
          {summary.bad.length > 0 && (
            <div className="px-3 pb-1 text-[12px] text-amber-800">
              {summary.bad.slice(0, 3).map((l) => (
                <p key={l.label} className="flex items-center gap-1"><AlertTriangle size={12} /> {l.label}: stock <b className="tabular-nums">{fmtPaise(l.stock)}</b> vs ledger opening <b className="tabular-nums">{fmtPaise(l.ledger)}</b></p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-300">
            <button className="btn btn-primary" disabled={readOnly || saving || !dirty} onClick={() => void save()}><Save size={14} /> Save <span className="kbd">Ctrl+S</span></button>
            <button className="btn" disabled={!dirty} onClick={reset}><RotateCcw size={14} /> Reset</button>
          </div>
        </div>
      </main>
      {dialog && <ConfirmDialog spec={dialog} onClose={() => setDialog(null)} />}
      {help && <ShortcutsOverlay onClose={() => setHelp(false)} shortcuts={HELP} />}
    </>
  );
}
