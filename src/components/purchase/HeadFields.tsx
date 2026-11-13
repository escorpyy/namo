import { useMemo } from "react";
import type { PLookups } from "../../api";
import { MasterReferencePicker, type ReferenceOption } from "../MasterReferencePicker";
import type { CreateMasterSpec } from "../quickCreateContext";
import { DateInput } from "../DateInput";
import { NarrationInput } from "../NarrationInput";
import { Field, focusStep } from "./Bits";

type Errs = Record<string, string | undefined>;

// Ctrl+M on the Vendor field: a vendor is a Party of type VENDOR, and the option value is its ledger, not the party row.
const VENDOR_PARTY: CreateMasterSpec = { key: "party", defaults: { glType: "VENDOR" }, valueFrom: (r) => String(r.generalLedgerId ?? r.id) };

// Vendor ledger, its sub-ledger (when the ledger needs one) and the agent: the same three fields on every purchase document.
export function VendorFields({ lookups, vendorGLId, subLedgerId, agentId, onChange, readOnly, errors, lockVendor, contextKey }: {
  lookups: PLookups; vendorGLId: string; subLedgerId: string; agentId: string; readOnly: boolean; errors: Errs; lockVendor?: boolean; contextKey: string;
  onChange: (p: { vendorGLId?: string; subLedgerId?: string; agentId?: string }) => void;
}) {
  const vendor = lookups.vendors.find((v) => String(v.id) === vendorGLId);
  const vendors = useMemo<ReferenceOption[]>(() => lookups.vendors.map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}`, code: v.code, name: v.name, detail: v.requiresSubLedger ? "Requires sub ledger" : "Vendor ledger", isActive: v.isActive })), [lookups.vendors]);
  const subs = useMemo<ReferenceOption[]>(() => lookups.subLedgers.filter((s) => String(s.generalLedgerId) === vendorGLId).map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}`, code: s.code, name: s.name, detail: vendor?.name ? `For ${vendor.name}` : "Sub ledger", isActive: s.isActive })), [lookups.subLedgers, vendorGLId, vendor?.name]);
  const agents = useMemo<ReferenceOption[]>(() => lookups.agents.map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}`, code: a.code, name: a.name, isActive: a.isActive })), [lookups.agents]);
  return (
    <>
      <Field label="Vendor" required error={errors.vendorGLId} className="col-span-1 sm:col-span-2">
        <MasterReferencePicker fieldName="vendorGLId" label="Vendor ledger" scopeKey="vendor-ledgers" contextKey={contextKey} placeholder="Choose vendor ledger…" required value={vendorGLId} hasError={!!errors.vendorGLId} options={vendors} disabled={readOnly || lockVendor} createMaster={VENDOR_PARTY}
          onChange={(v) => onChange({ vendorGLId: v, subLedgerId: "" })} onCommit={(el, dir) => focusStep(el, dir)} />
      </Field>
      <Field label={vendor?.requiresSubLedger ? "Sub Ledger" : "Sub Ledger (not needed)"} required={!!vendor?.requiresSubLedger} error={errors.subLedgerId}>
        <MasterReferencePicker fieldName="subLedgerId" label="Sub Ledger" scopeKey="sub-ledger" contextKey={`${contextKey}:${vendorGLId || "none"}`} placeholder={subs.length ? "Choose sub ledger…" : vendor?.requiresSubLedger ? "None yet — Ctrl+M to create" : "—"} value={subLedgerId} hasError={!!errors.subLedgerId} options={subs}
          disabled={readOnly || (subs.length === 0 && !vendor?.requiresSubLedger)}
          createMaster={vendor?.requiresSubLedger ? { key: "sub-ledger", defaults: { generalLedgerId: vendorGLId } } : undefined}
          required={!!vendor?.requiresSubLedger}
          onChange={(v) => onChange({ subLedgerId: v })} onCommit={(el, dir) => focusStep(el, dir)} />
      </Field>
      <Field label="Agent" error={errors.agentId}>
        <MasterReferencePicker fieldName="agentId" label="Agent" scopeKey="agents" contextKey={contextKey} placeholder="Agent (optional)" value={agentId} hasError={!!errors.agentId} options={agents} disabled={readOnly} createMaster={{ key: "agents" }}
          onChange={(v) => onChange({ agentId: v })} onCommit={(el, dir) => focusStep(el, dir)} />
      </Field>
    </>
  );
}

export function DateField({ label, name, value, onChange, calendar, readOnly, error, required }: {
  label: string; name: string; value: string; onChange: (v: string) => void; calendar: "BS" | "AD"; readOnly: boolean; error?: string; required?: boolean;
}) {
  return (
    <Field label={`${label} (${calendar})`} error={error} required={required}>
      <DateInput fieldName={name} value={value} onChange={onChange} calendar={calendar} hasError={!!error} onBlurField={() => {}} disabled={readOnly} />
    </Field>
  );
}

/** `narrationCompanyId`: this is a narration / remarks field, so ↓ offers that company's Narration Master (see NarrationInput). */
export function TextField({ label, name, value, onChange, readOnly, error, max = 60, placeholder, required, className, narrationCompanyId }: {
  label: string; name: string; value: string; onChange: (v: string) => void; readOnly: boolean; error?: string; max?: number; placeholder?: string; required?: boolean; className?: string; narrationCompanyId?: number;
}) {
  const cls = `fld min-w-0 ${error ? "fld-err" : ""} ${readOnly ? "bg-slate-100 text-slate-600" : ""}`;
  return (
    <Field label={label} error={error} required={required} className={className}>
      {narrationCompanyId != null
        ? <NarrationInput companyId={narrationCompanyId} data-field={name} value={value} maxLength={max} disabled={readOnly} placeholder={placeholder} onText={onChange} onFocus={(e) => e.currentTarget.select()} className={cls} />
        : <input data-field={name} value={value} maxLength={max} autoComplete="off" disabled={readOnly} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.currentTarget.select()} className={cls} />}
    </Field>
  );
}
