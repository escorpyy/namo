import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, useDialog } from "./Dialog";
import { ledgerReassignApi, type LedgerJob } from "../api";

// Watches the background jobs that move posted transactions to a new ledger.
//  - right after "All till date" is chosen, a progress box opens; "Run in background" closes it and the work carries on
//  - when a job finishes (or fails) the person is told once, wherever they are in the application; a job finished while they were away is told on their next visit
export function LedgerJobWatcher({ companyId, userId }: { companyId: number; userId: number }) {
  const dlg = useDialog();
  const [jobs, setJobs] = useState<LedgerJob[]>([]);
  const [focus, setFocus] = useState<number | null>(null);
  const told = useRef(new Set<number>());

  const poll = useCallback(async () => {
    try { setJobs(await ledgerReassignApi.jobs(companyId, userId)); } catch { /* the next poll tries again */ }
  }, [companyId, userId]);

  useEffect(() => { void poll(); const t = setInterval(() => void poll(), 2500); return () => clearInterval(t); }, [poll]);
  useEffect(() => {
    const open = (e: Event) => { setFocus((e as CustomEvent<number>).detail); void poll(); };
    window.addEventListener("namo:ledger-job", open);
    return () => window.removeEventListener("namo:ledger-job", open);
  }, [poll]);

  // announce what finished while no progress box is showing it
  useEffect(() => {
    for (const j of jobs) {
      if ((j.status !== "DONE" && j.status !== "FAILED") || j.id === focus || told.current.has(j.id)) continue;
      told.current.add(j.id);
      const text = j.status === "DONE"
        ? `The ledger of "${j.masterName}" has been reassigned on ${j.processed} transaction${j.processed === 1 ? "" : "s"}.${j.skipped ? ` ${j.skipped} had nothing to move on the old ledger and were left as they were.` : ""}`
        : `Reassigning the ledger of "${j.masterName}" stopped after ${j.processed} of ${j.total} transactions: ${j.message ?? "unknown error"}. What was moved stays moved; retry to continue.`;
      void (async () => {
        if (j.status === "DONE") await dlg.success(text, { title: "Ledger reassigned" });
        else if (await dlg.confirm(text, { title: "Ledger reassignment failed", variant: "warning", confirmLabel: "Retry", cancelLabel: "Close" })) { told.current.delete(j.id); await ledgerReassignApi.retry(companyId, j.id).catch(() => {}); void poll(); return; }
        await ledgerReassignApi.seen(companyId, j.id).catch(() => {});
        void poll();
      })();
    }
  }, [jobs, focus, dlg, companyId, poll]);

  const job = focus == null ? null : jobs.find((j) => j.id === focus) ?? null;
  const finished = job && (job.status === "DONE" || job.status === "FAILED");
  const close = () => { const id = focus; setFocus(null); if (id != null && finished) { told.current.add(id); void ledgerReassignApi.seen(companyId, id).then(poll).catch(() => {}); } };
  if (focus == null) return null;
  const pct = job && job.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : job?.status === "DONE" ? 100 : 0;
  return (
    <Dialog onClose={close} spec={{
      title: !job ? "Reassigning ledger" : job.status === "DONE" ? "Ledger reassigned" : job.status === "FAILED" ? "Ledger reassignment failed" : "Reassigning ledger…",
      variant: job?.status === "DONE" ? "success" : job?.status === "FAILED" ? "error" : "info",
      body: (
        <div className="space-y-3">
          <p>{job ? <>Moving the transactions of <b>{job.masterName}</b> to the new ledger.</> : "Starting…"}</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-cobalt-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[12.5px] text-slate-600">{job ? `${job.processed} of ${job.total} transactions` : ""}{job?.skipped ? ` · ${job.skipped} left as they were` : ""}</p>
          {job?.status === "FAILED" && <p className="text-[12.5px] font-medium text-rose-700">{job.message}</p>}
          {!finished && <p className="text-[12px] text-slate-500">This can take a while. You can run it in the background and keep working; you will be notified when it is done.</p>}
        </div>
      ),
      buttons: finished ? [{ label: "OK", kind: "primary", autoFocus: true, onClick: close }] : [{ label: "Run in background", kind: "primary", autoFocus: true, onClick: close }],
    }} />
  );
}
