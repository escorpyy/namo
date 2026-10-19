// Ek hi jagah har master ki definition: server (validation, duplicate check) aur UI (form, list) dono yahin se padhte hain.
export type FieldType = "text" | "number" | "select" | "lookup" | "checkbox" | "date";

export interface Opt {
  value: string;
  label: string;
  short?: string;
  hotkey?: string;
  badge?: string;
}

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  max?: number; // text: max length
  upper?: boolean; // auto-UPPERCASE
  min?: number;
  maxValue?: number;
  decimals?: number; // number: 0 = whole number, 2 = numeric(.., 2)
  options?: Opt[]; // select
  lookup?: string; // lookup: master key jisse options aayenge
  default?: string | boolean;
  span?: 1 | 2;
  placeholder?: string;
  showIf?: { field: string; in: string[] }; // field tabhi dikhega jab doosre field ki value in me ho
  section?: string; // is field se pehle chhota section heading
  readOnly?: boolean; // sirf VIEW me dikhta hai; form se edit nahi hota (jaise isClosed: iska alag workflow hoga)
  editOnly?: boolean; // NEW me nahi dikhta (jaise Retained Earnings GL: company ban jaane ke baad hi set ho sakta hai)
  lookupScope?: "record"; // options selected record ki company se aate hain (Company screen par)
  format?: "email";
  lower?: boolean; // auto-lowercase
  lookupWhere?: { field: string; value: unknown }; // lookup options sirf wahi rows jinme row[field] === value
}

export interface ColumnDef {
  name: string;
  label: string;
  width: string; // css grid width
  kind?: "mono" | "text" | "badge" | "dot" | "lookup" | "date";
  empty?: string; // khali value par kya dikhana hai (jaise "All branches")
}

export interface MasterDef {
  key: string; // api path + sidebar id
  title: string; // screen heading
  singular: string;
  labelFields: [string, string]; // record label: "AG01 — Current Assets"
  fields: FieldDef[];
  columns: ColumnDef[];
  unique: string[][]; // case-insensitive uniqueness sets
  parent?: { field: string; label: string }; // child master: uniqueness parent ke andar
  counts?: { key: string; label: string }[]; // child counts: info strip + delete block
  warnOnChange?: { field: string; countKey: string; text: string };
  cols?: 1 | 2;
  uniqueScope?: "system"; // unique check company ke andar nahi, poore system me (jaise SubLedger.code)
  noDelete?: string; // delete allowed nahi: ye message dikhao
  sortBy?: string;
  sortDir?: "asc" | "desc";
  refreshContext?: boolean; // save/delete ke baad header ke Company/Branch/FY switcher refresh
  loads?: string[]; // lookup ke alawa jo masters bhi load karne hain (label prefix / suggest ke liye)
  // Ek field badalne par doosra field suggest karo (sirf NEW mode me). Chain: lookup -> row -> fk -> row -> attribute -> map
  suggest?: { from: string; hops: { master: string; via?: string }[]; attr: string; map: Record<string, string>; target: string };
}

const ACCOUNT_TYPES: Opt[] = [
  { value: "ASSET", label: "ASSET", hotkey: "A", badge: "bg-blue-100 text-blue-800 border-blue-300" },
  { value: "LIABILITY", label: "LIABILITY", hotkey: "L", badge: "bg-orange-100 text-orange-800 border-orange-300" },
  { value: "EQUITY", label: "EQUITY", hotkey: "E", badge: "bg-purple-100 text-purple-800 border-purple-300" },
  { value: "REVENUE", label: "REVENUE", hotkey: "R", badge: "bg-green-100 text-green-800 border-green-300" },
  { value: "EXPENSE", label: "EXPENSE", hotkey: "X", badge: "bg-red-100 text-red-800 border-red-300" },
];

const NORMAL_BALANCE: Opt[] = [
  { value: "DEBIT", label: "DEBIT", hotkey: "D", badge: "bg-blue-100 text-blue-800 border-blue-300" },
  { value: "CREDIT", label: "CREDIT", hotkey: "C", badge: "bg-orange-100 text-orange-800 border-orange-300" },
];
const GL_TYPES: Opt[] = [
  { value: "CUSTOMER", label: "CUSTOMER", hotkey: "C" },
  { value: "VENDOR", label: "VENDOR", hotkey: "V" },
  { value: "BOTH", label: "BOTH", hotkey: "B" },
  { value: "OTHER", label: "OTHER", hotkey: "O" },
];
const PARTY_TYPES: Opt[] = [
  { value: "CUSTOMER", label: "CUSTOMER", hotkey: "C", badge: "bg-green-100 text-green-800 border-green-300" },
  { value: "VENDOR", label: "VENDOR", hotkey: "V", badge: "bg-orange-100 text-orange-800 border-orange-300" },
  { value: "BOTH", label: "BOTH", hotkey: "B", badge: "bg-purple-100 text-purple-800 border-purple-300" },
];
const BUSINESS_TYPES: Opt[] = [
  { value: "SOLE_PROPRIETORSHIP", label: "Sole Proprietorship" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "PRIVATE_LIMITED", label: "Private Limited" },
  { value: "PUBLIC_LIMITED", label: "Public Limited" },
  { value: "OTHER", label: "Other" },
];
const CALENDAR_PREF: Opt[] = [
  { value: "BS", label: "BS", hotkey: "B" },
  { value: "AD", label: "AD", hotkey: "A" },
];
const ROLES: Opt[] = [
  { value: "ADMIN", label: "ADMIN", hotkey: "A", badge: "bg-red-100 text-red-800 border-red-300" },
  { value: "ACCOUNTANT", label: "ACCOUNTANT", hotkey: "C", badge: "bg-blue-100 text-blue-800 border-blue-300" },
  { value: "VIEWER", label: "VIEWER", hotkey: "V", badge: "bg-slate-100 text-slate-700 border-slate-300" },
];
const flag = (name: string, label: string): FieldDef => ({ name, label, type: "checkbox", default: false });

const code = (): FieldDef => ({ name: "code", label: "Code", type: "text", required: true, max: 10, upper: true });
const text = (name: string, label: string, max: number, required = true): FieldDef => ({ name, label, type: "text", required, max });
const lookup = (name: string, label: string, key: string, required = true): FieldDef => ({ name, label, type: "lookup", lookup: key, required });
const active = (): FieldDef => ({ name: "isActive", label: "Active", type: "checkbox", default: true });
const CODE_COL: ColumnDef = { name: "code", label: "Code", width: "56px", kind: "mono" };
const ON_COL: ColumnDef = { name: "isActive", label: "On", width: "28px", kind: "dot" };

const list: MasterDef[] = [
  {
    key: "account-groups", title: "Account Group", singular: "Account Group", labelFields: ["code", "description"],
    fields: [code(), text("description", "Description", 50), { name: "type", label: "Type", type: "select", required: true, options: ACCOUNT_TYPES, placeholder: "Type or pick (A / L / E / R / X)" }, active()],
    columns: [CODE_COL, { name: "description", label: "Description", width: "1fr", kind: "text" }, { name: "type", label: "Type", width: "80px", kind: "badge" }, ON_COL],
    unique: [["code"], ["description"]],
    counts: [{ key: "subGroupCount", label: "Sub Group(s)" }],
    warnOnChange: { field: "type", countKey: "subGroupCount", text: "Changing its Type affects all of them." },
  },
  {
    key: "account-sub-groups", title: "Account Sub Group", singular: "Account Sub Group", labelFields: ["code", "description"],
    fields: [lookup("accountGroupId", "Account Group", "account-groups"), code(), text("description", "Description", 50), active()],
    columns: [CODE_COL, { name: "description", label: "Description", width: "1fr", kind: "text" }, { name: "accountGroupId", label: "Group", width: "64px", kind: "lookup" }, ON_COL],
    unique: [["accountGroupId", "code"], ["accountGroupId", "description"]],
    parent: { field: "accountGroupId", label: "Account Group" },
    counts: [{ key: "ledgerCount", label: "General Ledger(s)" }],
  },
  {
    key: "general-ledger", title: "General Ledger", singular: "General Ledger", labelFields: ["code", "name"], cols: 2,
    loads: ["account-groups", "areas"],
    fields: [
      { name: "code", label: "Code", type: "text", required: true, max: 20, upper: true },
      text("name", "Name", 100),
      lookup("accountSubGroupId", "Sub Group", "account-sub-groups"),
      { name: "normalBalance", label: "Normal Balance", type: "select", required: true, options: NORMAL_BALANCE, placeholder: "Auto from group type" },
      { name: "glType", label: "GL Type", type: "select", required: true, options: GL_TYPES, default: "OTHER" },
      lookup("parentId", "Parent Ledger", "general-ledger", false),
      lookup("subAreaId", "Sub Area", "sub-areas", false),
      lookup("agentId", "Agent", "agents", false),
      flag("isCashOrBank", "Cash / Bank"),
      flag("postsToCashBook", "Posts to Cash Book"),
      flag("requiresSubLedger", "Requires Sub Ledger"),
      flag("allowDocAdjust", "Allow Doc Adjust"),
      active(),
    ],
    columns: [{ name: "code", label: "Code", width: "84px", kind: "mono" }, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "normalBalance", label: "Bal", width: "56px", kind: "text" }, ON_COL],
    unique: [["code"]],
    counts: [
      { key: "childCount", label: "Child Ledger(s)" },
      { key: "subLedgerCount", label: "Sub Ledger(s)" },
      { key: "voucherLineCount", label: "Voucher Line(s)" },
      { key: "openingCount", label: "Opening Balance(s)" },
      { key: "partyCount", label: "Party record(s)" },
    ],
    // Asset/Expense ka normal balance Debit, baaki Credit: group type se suggest hota hai
    suggest: {
      from: "accountSubGroupId", target: "normalBalance", attr: "type",
      hops: [{ master: "account-sub-groups", via: "accountGroupId" }, { master: "account-groups" }],
      map: { ASSET: "DEBIT", EXPENSE: "DEBIT", LIABILITY: "CREDIT", EQUITY: "CREDIT", REVENUE: "CREDIT" },
    },
  },
  {
    // Party = ek GL (leaf) + Party row + Customer/Vendor detail: ek form se teeno save hote hain (server/routes/party.ts)
    key: "party", title: "Party", singular: "Party", labelFields: ["code", "name"], cols: 2,
    loads: ["account-groups", "areas"],
    fields: [
      { name: "code", label: "Code", type: "text", required: true, max: 20, upper: true, section: "Ledger" },
      text("name", "Name", 100),
      lookup("accountSubGroupId", "Sub Group", "account-sub-groups"),
      { name: "glType", label: "Party Type", type: "select", required: true, options: PARTY_TYPES, default: "CUSTOMER" },
      lookup("subAreaId", "Sub Area", "sub-areas", false),
      lookup("agentId", "Agent", "agents", false),
      { ...text("address", "Address", 255, false), span: 2, section: "Contact" },
      text("city", "City", 50, false),
      text("state", "State / Province", 50, false),
      { ...text("country", "Country", 50, false), default: "Nepal" },
      text("phone", "Phone", 25, false),
      text("mobile", "Mobile", 15, false),
      { ...text("email", "Email", 255, false), format: "email" },
      text("contactPerson", "Contact Person", 50, false),
      text("panNo", "PAN No", 25, false),
      { ...flag("isVatRegistered", "VAT Registered"), section: "Tax & Terms" },
      active(),
      { name: "creditLimit", label: "Credit Limit", type: "number", decimals: 2, min: 0, showIf: { field: "glType", in: ["CUSTOMER", "BOTH"] } },
      { name: "creditDays", label: "Credit Days", type: "number", decimals: 0, min: 0, showIf: { field: "glType", in: ["CUSTOMER", "BOTH"] } },
      { name: "paymentTermDays", label: "Payment Term Days", type: "number", decimals: 0, min: 0, showIf: { field: "glType", in: ["VENDOR", "BOTH"] } },
    ],
    columns: [{ name: "code", label: "Code", width: "70px", kind: "mono" }, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "glType", label: "Type", width: "78px", kind: "badge" }, ON_COL],
    unique: [["code"], ["panNo"]],
    counts: [
      { key: "childCount", label: "Child Ledger(s)" },
      { key: "subLedgerCount", label: "Sub Ledger(s)" },
      { key: "voucherLineCount", label: "Voucher Line(s)" },
      { key: "openingCount", label: "Opening Balance(s)" },
      { key: "productCount", label: "Product(s) (default vendor)" },
    ],
  },
  {
    key: "companies", title: "Company", singular: "Company", labelFields: ["code", "name"], cols: 2, refreshContext: true,
    fields: [
      { name: "code", label: "Code", type: "text", required: true, max: 15, upper: true, section: "Identity" },
      text("name", "Name", 200),
      text("legalName", "Legal Name", 200, false),
      { name: "businessType", label: "Business Type", type: "select", required: true, options: BUSINESS_TYPES, default: "OTHER" },
      { ...text("registrationNo", "Registration No", 50, false), section: "Registration & Tax" },
      text("panNo", "PAN No", 25, false),
      text("vatNo", "VAT No", 25, false),
      text("taxOfficeName", "Tax Office", 100, false),
      flag("isVatRegistered", "VAT Registered"),
      active(),
      { ...text("address", "Address", 300, false), span: 2, section: "Contact" },
      text("city", "City", 50, false),
      text("district", "District", 50, false),
      text("province", "Province", 50, false),
      { ...text("country", "Country", 50, false), default: "Nepal" },
      text("phone", "Phone", 20, false),
      { ...text("email", "Email", 255, false), format: "email" },
      { ...text("website", "Website", 255, false), span: 2 },
      { name: "baseCurrency", label: "Base Currency", type: "text", required: true, max: 3, upper: true, default: "NPR", section: "Defaults" },
      { name: "defaultCalendarPref", label: "Calendar", type: "select", required: true, options: CALENDAR_PREF, default: "BS" },
      { name: "retainedEarningsGLId", label: "Retained Earnings GL", type: "lookup", lookup: "general-ledger", lookupScope: "record", editOnly: true, span: 2, placeholder: "Year-end close se pehle set karna zaroori" },
    ],
    columns: [{ name: "code", label: "Code", width: "70px", kind: "mono" }, { name: "name", label: "Name", width: "1fr", kind: "text" }, ON_COL],
    unique: [["code"]],
    counts: [
      { key: "branchCount", label: "Branch(es)" },
      { key: "fiscalYearCount", label: "Fiscal Year(s)" },
      { key: "accountGroupCount", label: "Account Group(s)" },
      { key: "ledgerCount", label: "Ledger(s)" },
    ],
  },
  {
    key: "branches", title: "Branch", singular: "Branch", labelFields: ["code", "name"], cols: 2, refreshContext: true,
    fields: [
      { ...code(), max: 15 },
      text("name", "Name", 100),
      { ...text("address", "Address", 300, false), span: 2 },
      text("phone", "Phone", 20, false),
      { ...text("email", "Email", 255, false), format: "email" },
      flag("isHeadOffice", "Head Office"),
      active(),
    ],
    columns: [{ name: "code", label: "Code", width: "70px", kind: "mono" }, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "isHeadOffice", label: "HO", width: "28px", kind: "dot" }, ON_COL],
    unique: [["code"], ["name"]],
    counts: [
      { key: "voucherCount", label: "Voucher(s)" },
      { key: "openingCount", label: "Opening Balance(s)" },
      { key: "accessCount", label: "User Access row(s)" },
    ],
  },
  {
    key: "fiscal-years", title: "Fiscal Year", singular: "Fiscal Year", labelFields: ["code", "code"], refreshContext: true, sortBy: "startDate", sortDir: "desc",
    fields: [
      { name: "code", label: "Code", type: "text", required: true, max: 15, upper: true, placeholder: "2082/083" },
      { name: "startDate", label: "Start Date", type: "date", required: true },
      { name: "endDate", label: "End Date", type: "date", required: true },
      flag("isCurrent", "Current Year"),
      active(),
      { name: "isClosed", label: "Closed", type: "checkbox", readOnly: true },
      { name: "isOpeningBalanceLocked", label: "Opening Balance Locked", type: "checkbox", readOnly: true },
    ],
    columns: [{ name: "code", label: "Code", width: "84px", kind: "mono" }, { name: "startDate", label: "Start (AD)", width: "1fr", kind: "date" }, { name: "endDate", label: "End (AD)", width: "1fr", kind: "date" }, { name: "isCurrent", label: "Cur", width: "28px", kind: "dot" }],
    unique: [["code"]],
    counts: [{ key: "openingCount", label: "Opening Balance(s)" }, { key: "stockOpeningCount", label: "Stock Opening(s)" }],
  },
  {
    key: "users", title: "User", singular: "User", labelFields: ["name", "email"], sortBy: "name",
    noDelete: "Users cannot be deleted (their name stays in the audit history). Mark the user inactive instead.",
    fields: [
      text("name", "Name", 100),
      { name: "email", label: "Email", type: "text", required: true, max: 255, lower: true, format: "email" },
      { name: "calendarPreference", label: "Calendar", type: "select", required: true, options: CALENDAR_PREF, default: "BS" },
      active(),
    ],
    columns: [{ name: "name", label: "Name", width: "120px", kind: "text" }, { name: "email", label: "Email", width: "1fr", kind: "text" }, ON_COL],
    unique: [["email"]],
    counts: [{ key: "accessCount", label: "Company Access row(s)" }],
  },
  {
    key: "user-access", title: "User Access", singular: "User Access", labelFields: ["userName", "role"], sortBy: "userName",
    fields: [
      lookup("userId", "User", "users"),
      { ...lookup("branchId", "Branch", "branches", false), placeholder: "All branches" },
      { name: "role", label: "Role", type: "select", required: true, options: ROLES, default: "VIEWER" },
      active(),
    ],
    columns: [{ name: "userName", label: "User", width: "1fr", kind: "text" }, { name: "branchName", label: "Branch", width: "92px", kind: "text", empty: "All branches" }, { name: "role", label: "Role", width: "78px", kind: "badge" }, ON_COL],
    unique: [],
  },
  {
    key: "sub-ledger", title: "Sub Ledger", singular: "Sub Ledger", labelFields: ["code", "name"],
    fields: [
      { ...lookup("generalLedgerId", "General Ledger", "general-ledger"), lookupWhere: { field: "requiresSubLedger", value: true }, placeholder: "Sirf 'Requires Sub Ledger' wale ledgers" },
      { name: "code", label: "Code", type: "text", required: true, max: 20, upper: true },
      text("name", "Name", 100),
      lookup("partyId", "Party", "party", false),
      active(),
    ],
    columns: [{ name: "code", label: "Code", width: "84px", kind: "mono" }, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "generalLedgerId", label: "GL", width: "70px", kind: "lookup" }, ON_COL],
    unique: [["code"]],
    uniqueScope: "system",
    parent: { field: "generalLedgerId", label: "General Ledger" },
    counts: [{ key: "openingCount", label: "Opening Balance(s)" }],
  },
  {
    key: "areas", title: "Area", singular: "Area", labelFields: ["code", "name"],
    fields: [code(), text("name", "Name", 50), { ...text("shortName", "Short Name", 10), upper: true }, active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "shortName", label: "Short", width: "64px", kind: "text" }, ON_COL],
    unique: [["code"], ["name"], ["shortName"]],
    counts: [{ key: "subAreaCount", label: "Sub Area(s)" }],
  },
  {
    key: "sub-areas", title: "Sub Area", singular: "Sub Area", labelFields: ["code", "name"],
    fields: [lookup("areaId", "Area", "areas"), code(), text("name", "Name", 50), { ...text("shortName", "Short Name", 10), upper: true }, active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "areaId", label: "Area", width: "64px", kind: "lookup" }, ON_COL],
    unique: [["areaId", "code"], ["areaId", "name"], ["areaId", "shortName"]],
    parent: { field: "areaId", label: "Area" },
  },
  {
    key: "agents", title: "Agent", singular: "Agent", labelFields: ["code", "name"],
    fields: [code(), text("name", "Name", 100), text("phone", "Phone", 25, false), active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "phone", label: "Phone", width: "92px", kind: "text" }, ON_COL],
    unique: [["code"]],
  },
  {
    key: "product-groups", title: "Product Group", singular: "Product Group", labelFields: ["code", "name"],
    fields: [code(), text("name", "Name", 50), active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, ON_COL],
    unique: [["code"], ["name"]],
    counts: [{ key: "subGroupCount", label: "Sub Group(s)" }],
  },
  {
    key: "product-sub-groups", title: "Product Sub Group", singular: "Product Sub Group", labelFields: ["code", "name"],
    fields: [lookup("productGroupId", "Product Group", "product-groups"), code(), text("name", "Name", 50), active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "productGroupId", label: "Group", width: "64px", kind: "lookup" }, ON_COL],
    unique: [["productGroupId", "code"], ["productGroupId", "name"]],
    parent: { field: "productGroupId", label: "Product Group" },
    counts: [{ key: "productCount", label: "Product(s)" }],
  },
  {
    key: "product-units", title: "Unit", singular: "Unit", labelFields: ["code", "name"],
    fields: [code(), text("name", "Name", 50), { name: "decimalPlaces", label: "Decimal Places", type: "number", required: true, decimals: 0, min: 0, maxValue: 6, default: "0", placeholder: "0 for PCS, 2-3 for KG/LTR" }, active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "decimalPlaces", label: "Dec", width: "40px", kind: "text" }, ON_COL],
    unique: [["code"], ["name"]],
  },
  {
    key: "tax-rates", title: "Tax Rate", singular: "Tax Rate", labelFields: ["code", "name"],
    fields: [code(), text("name", "Name", 50), { name: "ratePercent", label: "Rate %", type: "number", required: true, decimals: 2, min: 0, maxValue: 100 }, text("hsnSacCode", "HSN / SAC Code", 20, false), active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "ratePercent", label: "Rate %", width: "56px", kind: "text" }, ON_COL],
    unique: [["code"]],
  },
  {
    key: "stock-categories", title: "Stock Category", singular: "Stock Category", labelFields: ["code", "name"],
    fields: [code(), text("name", "Name", 50), active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, ON_COL],
    unique: [["code"], ["name"]],
  },
  {
    key: "locations", title: "Location", singular: "Location", labelFields: ["code", "name"],
    fields: [code(), text("name", "Name", 50), lookup("parentId", "Parent Location", "locations", false), active()],
    columns: [CODE_COL, { name: "name", label: "Name", width: "1fr", kind: "text" }, { name: "parentId", label: "Parent", width: "64px", kind: "lookup" }, ON_COL],
    unique: [["code"]],
    counts: [{ key: "childCount", label: "Child Location(s)" }],
  },
];

export const MASTERS: Record<string, MasterDef> = Object.fromEntries(list.map((m) => [m.key, m]));
