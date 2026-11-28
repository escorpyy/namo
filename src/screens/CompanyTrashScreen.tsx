import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { companyApi, type TrashedCompany } from "../api";
import { useDialog } from "../components/Dialog";
import type { StatusInfo } from "../types";

interface Props {
  setStatus: (status: StatusInfo) => void;
  /** Called after a restore, so the header's company list shows the company again. */
  onRestored: () => void;
}

export default function CompanyTrashScreen({ setStatus, onRestored }: Props) {
  const dlg = useDialog();
  const [items, setItems] = useState<TrashedCompany[] | null>(null);
  const [busy, setBusy] = useState(false);

  const say = useCallback((message: string, kind: StatusInfo["kind"], count: number) =>
    setStatus({ mode: "view", count, shown: count, message, kind, hints: [] }), [setStatus]);
  const load = useCallback(async (done?: string) => {
    try {
      const list = await companyApi.trash();
      setItems(list);
      say(done ?? (list.length ? "Restore a company, or delete it permanently." : "The Trash is empty."), done ? "ok" : "info", list.length);
    } catch (e) { say((e as Error).message, "err", 0); }
  }, [say]);
  useEffect(() => { void load(); }, [load]);

  const act = async (run: () => Promise<unknown>, done: string, after?: () => void) => {
    setBusy(true);
    try { await run(); after?.(); await load(done); }
    catch (e) { void dlg.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const purge = async (c: TrashedCompany) => {
    const typed = await dlg.prompt(
      `Everything of ${c.name} will be erased: branches, accounts, vouchers, bills, stock and history. This cannot be undone. Type ${c.code} to confirm.`,
      { title: "Delete permanently?", label: "Company code", confirmLabel: "Delete permanently", required: true },
    );
    if (typed === null) return;
    await act(() => companyApi.purge(c.id, typed), `Permanently deleted ${c.code}`);
  };

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="mx-auto max-w-3xl">
        <h1 className="flex items-center gap-2 text-[16px] font-semibold text-slate-800"><Trash2 size={18} /> Company Trash</h1>
        <p className="mt-1 text-[12px] text-slate-600">A deleted company stays here for 30 days. After that it is erased permanently.</p>
        {items && !items.length && <p className="mt-6 text-[13px] text-slate-500">No deleted companies.</p>}
        <ul className="mt-4 grid gap-2">
          {items?.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded border border-slate-300 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-800"><span className="font-mono">{c.code}</span> {c.name}</p>
                <p className="text-[12px] text-slate-500">Deleted {c.deletedAt.slice(0, 10)} · {c.daysLeft ? `${c.daysLeft} day(s) left to restore` : "restore period over"}</p>
              </div>
              <button type="button" disabled={busy || !c.daysLeft} onClick={() => void act(() => companyApi.restore(c.id), `Restored ${c.code}`, onRestored)}
                className="rounded border border-slate-300 px-3 py-1.5 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-50">Restore</button>
              <button type="button" disabled={busy} onClick={() => void purge(c)}
                className="rounded bg-rose-700 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-rose-800 disabled:opacity-50">Delete permanently</button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
