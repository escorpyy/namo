// Entry Control: per-company settings of each source module (the voucher / document screens). Each feature of a module can carry up to four controls:
//   show       Show / Hide            the field is on the screen or not
//   edit       Edit / No edit         the user may change the value (a computed one, such as the basic amount) or not
//   mandatory  Mandatory / Optional   the user must fill it
//   rule       Ignore / Warn / Block  what happens when the business rule behind the feature is broken
// A feature lists only the controls that make sense for it. Adding or removing a feature is an edit of this list: a company's saved
// choices for a feature that is gone are simply ignored, and a new feature starts at its defaults.

export type EntryRuleLevel = "IGNORE" | "WARN" | "BLOCK";
export const ENTRY_RULE_LEVELS: { value: EntryRuleLevel; label: string }[] = [
  { value: "IGNORE", label: "Ignore" }, { value: "WARN", label: "Warn" }, { value: "BLOCK", label: "Block" },
];
export type EntryControlKind = "show" | "edit" | "mandatory" | "rule";
export type EntryFeature = {
  key: string; label: string; hint?: string; group: "Header" | "Lines" | "Rules";
  controls: EntryControlKind[];
  defaults?: Partial<EntryValues>;
};
export type EntryValues = { show: boolean; edit: boolean; mandatory: boolean; rule: EntryRuleLevel };
export const ENTRY_DEFAULTS: EntryValues = { show: true, edit: true, mandatory: false, rule: "WARN" };

export type EntryModuleKey = "CASH_BANK_VOUCHER" | "JOURNAL_VOUCHER" | "SALES_INVOICE";
export type EntryModule = { key: EntryModuleKey; label: string; features: EntryFeature[] };

export const ENTRY_MODULES: EntryModule[] = [
  {
    key: "CASH_BANK_VOUCHER", label: "Cash / Bank Voucher",
    features: [
      { key: "instrument", label: "Instrument type", group: "Header", controls: ["show"] },
      { key: "chequeNumber", label: "Cheque / reference no", group: "Header", controls: ["show", "mandatory"] },
      { key: "chequeDate", label: "Cheque / instrument date", group: "Header", controls: ["show", "mandatory"] },
      { key: "payeeReference", label: "Payee / reference", group: "Header", controls: ["show", "mandatory"] },
      { key: "remarks", label: "Remarks", group: "Header", controls: ["show", "mandatory"] },
      { key: "lineSubLedger", label: "Sub-ledger (lines)", hint: "A ledger that needs a party sub-ledger always asks for it.", group: "Lines", controls: ["show", "mandatory"] },
      { key: "lineNarration", label: "Narration (lines)", group: "Lines", controls: ["show", "mandatory"] },
    ],
  },
  {
    key: "JOURNAL_VOUCHER", label: "Journal Voucher",
    features: [
      { key: "remarks", label: "Remarks", group: "Header", controls: ["show", "mandatory"] },
      { key: "lineSubLedger", label: "Sub-ledger (lines)", hint: "A ledger that needs a party sub-ledger always asks for it.", group: "Lines", controls: ["show", "mandatory"] },
      { key: "lineAgent", label: "Agent (lines)", group: "Lines", controls: ["show"] },
      { key: "lineNarration", label: "Narration (lines)", group: "Lines", controls: ["show", "mandatory"] },
    ],
  },
];

ENTRY_MODULES.push({
  key: "SALES_INVOICE", label: "Sales Invoice",
  features: [
    { key: "agent", label: "Salesperson", group: "Header", controls: ["show", "mandatory"] },
    { key: "remarks", label: "Remarks", group: "Header", controls: ["show", "mandatory"] },
    { key: "creditDays", label: "Due days beyond the customer's credit days", hint: "Checked when the invoice is saved.", group: "Rules", controls: ["rule"], defaults: { rule: "WARN" } },
    { key: "zeroStock", label: "Selling stock that is not on hand", hint: "Checked when the invoice is posted. Ignore lets the stock go negative.", group: "Rules", controls: ["rule"], defaults: { rule: "BLOCK" } },
  ],
});

export const ENTRY_MODULE_KEYS = ENTRY_MODULES.map((m) => m.key) as EntryModuleKey[];
export const moduleOf = (key: string) => ENTRY_MODULES.find((m) => m.key === key);
export const featureOf = (module: string, key: string) => moduleOf(module)?.features.find((f) => f.key === key);
export const entryDefaults = (f: EntryFeature): EntryValues => ({ ...ENTRY_DEFAULTS, ...(f.defaults ?? {}) });

/** A saved row or nothing: the control values of one feature, with only the controls the feature has taken from the row. */
export function resolveEntry(f: EntryFeature, saved?: Partial<EntryValues> | null): EntryValues {
  const d = entryDefaults(f), out = { ...d };
  for (const k of f.controls) if (saved && saved[k] !== undefined) (out as Record<string, unknown>)[k] = saved[k];
  // a hidden field cannot be mandatory
  if (!out.show) out.mandatory = false;
  return out;
}
export type EntryControlMap = Record<string, Record<string, EntryValues>>;
