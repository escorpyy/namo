import { useEffect, useState, type MutableRefObject } from "react";
import { LockKeyhole, RotateCw, Save, ShieldCheck } from "lucide-react";
import { ApiError, glSetupApi, productGLDefaultsApi, type GLSetupLedger, type GLSetupRole } from "../api";
import { GL_ENTRY_TYPES } from "../../shared/glSetup";
import type { MsgKind, StatusInfo } from "../types";

interface Props {
  companyId: number;
  userId: number;
  setStatus: (status: StatusInfo) => void;
  dirtyRef: MutableRefObject<boolean>;
}

const HINTS = ["Ctrl+S save"];
const checkedState = (rows: GLSetupRole[]) => JSON.stringify(rows.map(({ role, generalLedgerId, ...controls }) => ({ role, generalLedgerId, ...controls })));
const ledgerLabel = (ledger: GLSetupLedger) => `${ledger.code} — ${ledger.name}`;
const PRODUCT_ROLES = new Set<GLSetupRole["role"]>(["SALES_ACCOUNT", "SALES_RETURN_ACCOUNT", "PURCHASE_ACCOUNT", "PURCHASE_RETURN_ACCOUNT", "OPENING_STOCK_PL", "CLOSING_STOCK_PL", "CLOSING_STOCK_BS"]);

export default function GLSetupScreen({ companyId, userId, setStatus, dirtyRef }: Props) {
  const [roles, setRoles] = useState<GLSetupRole[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [ledgers, setLedgers] = useState<GLSetupLedger[]>([]);
  const [busy, setBusy] = useState(false);
  const [pendingRoles, setPendingRoles] = useState<GLSetupRole["role"][]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; kind: MsgKind }>({ text: "Loading GL Setup…", kind: "info" });
  const dirty = !!savedSnapshot && checkedState(roles) !== savedSnapshot;

  const load = async () => {
    setLoading(true);
    try {
      const data = await glSetupApi.get(companyId);
      setRoles(data.roles);
      setLedgers(data.ledgers);
      setSavedSnapshot(checkedState(data.roles));
      setMsg({ text: "GL Setup loaded. Unassigned roles do not restrict ledgers.", kind: "info" });
    } catch (error) {
      setMsg({ text: error instanceof ApiError ? error.message : "Could not load GL Setup.", kind: "err" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { dirtyRef.current = dirty; }, [dirty, dirtyRef]);
  useEffect(() => {
    setStatus({ mode: dirty ? "edit" : "view", count: roles.length, shown: roles.length, message: msg.text, kind: msg.kind, hints: HINTS });
  }, [dirty, roles.length, msg, setStatus]);

  const update = (role: GLSetupRole["role"], patch: Partial<GLSetupRole>) => {
    setRoles((current) => current.map((row) => row.role === role ? { ...row, ...patch } : row));
  };

  const changedProductRoles = () => {
    if (!savedSnapshot) return [];
    const before = new Map((JSON.parse(savedSnapshot) as { role: GLSetupRole["role"]; generalLedgerId: number | null }[]).map((row) => [row.role, row.generalLedgerId]));
    return roles.filter((row) => PRODUCT_ROLES.has(row.role) && before.get(row.role) !== row.generalLedgerId).map((row) => row.role);
  };
  const save = async (applyMode?: "UPDATE_ALL" | "PRESERVE_EXPLICIT", rolesToApply?: GLSetupRole["role"][]) => {
    if (busy || loading || roles.length === 0) return;
    const shouldSave = dirty;
    if (!shouldSave && !applyMode) return;
    const changed = rolesToApply ?? changedProductRoles();
    if (changed.length && !applyMode) { setPendingRoles(changed); return; }
    setBusy(true);
    try {
      if (shouldSave) {
        const result = await glSetupApi.save(companyId, userId, roles);
        setRoles(result.roles);
        setLedgers(result.ledgers);
        setSavedSnapshot(checkedState(result.roles));
      }
      if (changed.length && applyMode) {
        try {
          const applied = await productGLDefaultsApi.apply(companyId, userId, changed, applyMode);
          setMsg({ text: `GL mappings saved; ${applied.affected} Stock/Non-stock product${applied.affected === 1 ? "" : "s"} updated (${applyMode === "UPDATE_ALL" ? "all values replaced" : "explicit overrides preserved"}).`, kind: "ok" });
          setPendingRoles([]);
        } catch (error) {
          setPendingRoles(changed);
          setMsg({ text: `GL mappings were saved, but product defaults could not be applied: ${error instanceof ApiError ? error.message : "request failed"}. Retry applying these mappings.`, kind: "err" });
        }
      } else {
        setPendingRoles([]);
        setMsg({ text: "GL role-to-ledger mappings saved.", kind: "ok" });
      }
    } catch (error) {
      setMsg({ text: error instanceof ApiError ? error.message : "Could not save GL Setup.", kind: "err" });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const activeCount = roles.filter((row) => row.generalLedgerId !== null).length;
  const labelClass = "flex items-center gap-1.5 text-[11px] text-slate-700";
  const checkboxClass = "accent-blue-800";

  return (
    <main className="ledger flex min-h-0 min-w-0 flex-1 flex-col" aria-label="General Ledger Setup">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="lg-title">GL Setup</h1>
          <p className="mt-1 text-[12px] text-slate-500">Map company ledger roles and control where each mapped ledger can be entered.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="lg-chip"><b>{activeCount}</b> of {roles.length} mapped</span>
          <button type="button" className="btn" disabled={dirty || busy || loading} onClick={() => void load()} title={dirty ? "Save changes before reloading." : "Reload GL Setup"}>
            <RotateCw size={14} /> Reload
          </button>
          <button type="button" className="btn btn-primary" disabled={!dirty || busy || loading} onClick={() => void save()}>
            <Save size={14} /> {busy ? "Saving…" : "Save changes"} <span className="kbd">Ctrl+S</span>
          </button>
        </div>
      </header>

      <div className="lg-scroll min-h-0 flex-1 overflow-auto p-3 sm:p-4">
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-950">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-blue-700" />
          <p>These company defaults do not replace account mappings on individual products. A mapped ledger is allowed only for the entry types checked below; an unmapped ledger keeps the existing behavior.</p>
        </div>

        {pendingRoles.length > 0 && <section role="dialog" aria-modal="true" aria-labelledby="product-default-choice" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <h2 id="product-default-choice" className="font-semibold">Product defaults changed</h2>
          <p className="mt-1">Choose how the new mapped ledgers should be applied to existing Stock and Non-stock products. Unassigned mappings never clear product GL values.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save("UPDATE_ALL", pendingRoles)}>Update all Stock and Non-stock items</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void save("PRESERVE_EXPLICIT", pendingRoles)}>Preserve explicit product ledgers</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setPendingRoles([])}>Cancel</button>
          </div>
        </section>}

        {loading ? <div className="lg-card p-6 text-center text-slate-500">Loading GL Setup…</div> : (
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {roles.map((row) => {
              const selected = ledgers.find((ledger) => ledger.id === row.generalLedgerId);
              return (
                <section key={row.role} className="lg-card p-3 sm:p-4" aria-label={row.label}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-[190px] flex-1">
                      <h2 className="text-[14px] font-semibold text-ink">{row.label}</h2>
                      <p className="mt-0.5 text-[11px] text-slate-500">{row.hint}</p>
                    </div>
                    {selected && !selected.isActive && <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Inactive ledger</span>}
                  </div>

                  <label className="mt-3 block text-[11px] font-medium text-slate-600">
                    General Ledger
                    <select className="fld mt-1" value={row.generalLedgerId ?? ""} onChange={(event) => update(row.role, { generalLedgerId: event.target.value ? Number(event.target.value) : null })}>
                      <option value="">Not assigned</option>
                      {ledgers.map((ledger) => <option key={ledger.id} value={ledger.id} disabled={!ledger.isActive && ledger.id !== row.generalLedgerId}>{ledgerLabel(ledger)}{ledger.isActive ? "" : " (inactive)"}</option>)}
                    </select>
                  </label>

                  <fieldset className="mt-3 border-t border-slate-100 pt-2">
                    <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Entry controls</legend>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
                      {GL_ENTRY_TYPES.map((entry) => (
                        <label key={entry.key} className={labelClass}>
                          <input type="checkbox" className={checkboxClass} checked={row[entry.key]} onChange={(event) => update(row.role, { [entry.key]: event.target.checked })} />
                          {entry.label}
                        </label>
                      ))}
                      <label className={`${labelClass} font-medium text-rose-800`}>
                        <input type="checkbox" className="accent-rose-700" checked={row.isLocked} onChange={(event) => update(row.role, { isLocked: event.target.checked })} />
                        <LockKeyhole size={13} /> Locked
                      </label>
                    </div>
                  </fieldset>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
