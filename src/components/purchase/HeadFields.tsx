import { useMemo } from "react";
import type { PLookups } from "../../api";
import { Combobox, type ComboOption } from "../Combobox";
import { DateInput } from "../DateInput";
import { Field, focusStep } from "./Bits";

type Errs = Record<string, string | undefined>;

// Vendor ledger, its sub-ledger (when the ledger needs one) and the agent: the same three fields on every purchase document.
export function VendorFields({ lookups, vendorGLId, subLedgerId, agentId, onChange, readOnly, errors, lockVendor }: {
  lookups: PLookups; vendorGLId: string; subLedgerId: string; agentId: string; readOnly: boolean; errors: Errs; lockVendor?: boolean;
  onChange: (p: { vendorGLId?: string; subLedgerId?: string; agentId?: string }) => void;
}) {
  const vendor = lookups.vendors.find((v) => String(v.id) === vendorGLId);
  const vendors = useMemo<ComboOption[]>(() => lookups.vendors.filter((v) => v.isActive || String(v.id) === vendorGLId).map((v) => ({ value: String(v.id), label: `${v.code} — ${v.name}` })), [lookups.vendors, vendorGLId]);
  const subs = useMemo<ComboOption[]>(() => lookups.subLedgers.filter((s) => String(s.generalLedgerId) === vendorGLId && (s.isActive || String(s.id) === subLedgerId)).map((s) => ({ value: String(s.id), label: `${s.code} — ${s.name}` })), [lookups.subLedgers, vendorGLId, subLedgerId]);
  const agents = useMemo<ComboOption[]>(() => lookups.agents.filter((a) => a.isActive || String(a.id) === agentId).map((a) => ({ value: String(a.id), label: `${a.code} — ${a.name}` })), [lookups.agents, agentId]);
  return (
    <>
      <Field label="Vendor" required error={errors.vendorGLId} className="col-span-1 sm:col-span-2">
        <Combobox fieldName="vendorGLId" placeholder="Vendor ledger…" value={vendorGLId} hasError={!!errors.vendorGLId} options={vendors} disabled={readOnly || lockVendor}
          onChange={(v) => onChange({ vendorGLId: v, subLedgerId: "" })} onCommit={(el, dir) => focusStep(el, dir)} />
      </Field>
      <Field label={vendor?.requiresSubLedger ? "Sub Ledger" : "Sub Ledger (not needed)"} required={!!vendor?.requiresSubLedger} error={errors.subLedgerId}>
        <Combobox fieldName="subLedgerId" placeholder={subs.length ? "Sub ledger…" : "—"} value={subLedgerId} hasError={!!errors.subLedgerId} options={subs} disabled={readOnly || subs.length === 0}
          onChange={(v) => onChange({ subLedgerId: v })} onCommit={(el, dir) => focusStep(el, dir)} />
      </Field>
      <Field label="Agent" error={errors.agentId}>
        <Combobox fieldName="agentId" placeholder="Agent (optional)" value={agentId} hasError={!!errors.agentId} options={agents} disabled={readOnly} onChange={(v) => onChange({ agentId: v })} onCommit={(el, dir) => focusStep(el, dir)} />
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

export function TextField({ label, name, value, onChange, readOnly, error, max = 60, placeholder, required, className }: {
  label: string; name: string; value: string; onChange: (v: string) => void; readOnly: boolean; error?: string; max?: number; placeholder?: string; required?: boolean; className?: string;
}) {
  return (
    <Field label={label} error={error} required={required} className={className}>
      <input data-field={name} value={value} maxLength={max} autoComplete="off" disabled={readOnly} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.currentTarget.select()}
        className={`fld min-w-0 ${error ? "fld-err" : ""} ${readOnly ? "bg-slate-100 text-slate-600" : ""}`} />
    </Field>
  );
}
