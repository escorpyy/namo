import type { DialogApi } from "../components/Dialog";
import type { LedgerImpact } from "../api";

// The two questions asked when the ledger of a master (a billing term) is changed and transactions already carry the old ledger.
// Step 1 tells the person what is happening and how many transactions are involved; step 2 asks whether those are moved too.
// Resolves "ALL" (reassign everything till date), "UPCOMING" (only transactions from now on) or null (cancel: nothing is saved).
export async function askLedgerChange(dlg: DialogApi, o: { masterLabel: string; field?: string; noun?: string; oldLedger: string; newLedger: string; impact: LedgerImpact }): Promise<"ALL" | "UPCOMING" | null> {
  const { impact } = o;
  const n = impact.documents;
  const field = o.field ?? "General Ledger", noun = o.noun ?? "term";
  const first = await dlg.choose(
    <div className="space-y-2">
      <p>You are changing the {field} of <b>{o.masterLabel}</b> in the master.</p>
      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px]">
        <span className="text-slate-500">From</span> <b>{o.oldLedger}</b> <span className="text-slate-500">to</span> <b>{o.newLedger}</b>
      </p>
      <p><b>{n}</b> {n === 1 ? "transaction is" : "transactions are"} already posted or saved with <b>{o.oldLedger}</b> for this {noun}{impact.posted !== n ? ` (${impact.posted} posted, ${n - impact.posted} draft)` : ""}.</p>
      <p className="text-slate-500">Every change is recorded in the audit trail.</p>
    </div>,
    { title: "Change ledger of this master?", variant: "warning", choices: [{ label: "Cancel", value: "CANCEL", kind: "neutral" }, { label: "Reassign…", value: "REASSIGN", kind: "primary" }] },
  );
  if (first !== "REASSIGN") return null;
  const scope = await dlg.choose(
    <div className="space-y-2">
      <p>Which transactions should use <b>{o.newLedger}</b>?</p>
      <ul className="list-disc space-y-1 pl-5 text-[12.5px]">
        <li><b>Upcoming only</b>: bills and invoices posted from now on. The {n} existing {n === 1 ? "transaction keeps" : "transactions keep"} {o.oldLedger}.</li>
        <li><b>All till date</b>: the {n} existing {n === 1 ? "transaction" : "transactions"} are moved to {o.newLedger} as well, so reports show them there.</li>
      </ul>
      <p className="text-slate-500">Moving existing transactions can take a while. It runs in the background and you will be notified when it is done.</p>
    </div>,
    { title: "Reassign ledger", variant: "confirm", choices: [{ label: "Cancel", value: "CANCEL", kind: "neutral" }, { label: "Upcoming only", value: "UPCOMING", kind: "neutral" }, { label: "All till date", value: "ALL", kind: "primary" }] },
  );
  return scope === "ALL" || scope === "UPCOMING" ? scope : null;
}
