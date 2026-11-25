export const GL_ENTRY_TYPES = [
  { key: "allowJournal", label: "Journal Voucher", entryType: "JOURNAL" },
  { key: "allowCashBank", label: "Cash / Bank", entryType: "CASH_BANK" },
  { key: "allowSalesInvoice", label: "Sales Invoice", entryType: "SALES_INVOICE" },
  { key: "allowSalesReturn", label: "Sales Return", entryType: "SALES_RETURN" },
  { key: "allowPurchaseBill", label: "Purchase Bill", entryType: "PURCHASE_BILL" },
  { key: "allowPurchaseReturn", label: "Purchase Return", entryType: "PURCHASE_RETURN" },
  { key: "allowOpeningBalance", label: "Opening Balance", entryType: "OPENING_BALANCE" },
  { key: "allowStockOpening", label: "Stock Opening", entryType: "STOCK_OPENING" },
] as const;

export type GlEntryType = (typeof GL_ENTRY_TYPES)[number]["entryType"];
export type GlEntryControl = (typeof GL_ENTRY_TYPES)[number]["key"];
export type GlRoleKey =
  | "PROFIT_AND_LOSS"
  | "CASH_BOOK"
  | "SALES_ACCOUNT"
  | "SALES_RETURN_ACCOUNT"
  | "PURCHASE_ACCOUNT"
  | "PURCHASE_RETURN_ACCOUNT"
  | "INPUT_VAT"
  | "OUTPUT_VAT"
  | "IMPORT_INPUT_VAT"
  | "OPENING_STOCK_PL"
  | "CLOSING_STOCK_PL"
  | "CLOSING_STOCK_BS";

export type GlSetupControls = Record<GlEntryControl, boolean> & { isLocked: boolean };

const controls = (allowed: GlEntryControl[] = []): GlSetupControls => ({
  allowJournal: allowed.includes("allowJournal"),
  allowCashBank: allowed.includes("allowCashBank"),
  allowSalesInvoice: allowed.includes("allowSalesInvoice"),
  allowSalesReturn: allowed.includes("allowSalesReturn"),
  allowPurchaseBill: allowed.includes("allowPurchaseBill"),
  allowPurchaseReturn: allowed.includes("allowPurchaseReturn"),
  allowOpeningBalance: allowed.includes("allowOpeningBalance"),
  allowStockOpening: allowed.includes("allowStockOpening"),
  isLocked: false,
});

export const GL_SETUP_ROLES: { key: GlRoleKey; label: string; hint: string; defaults: GlSetupControls }[] = [
  { key: "PROFIT_AND_LOSS", label: "Profit and Loss Account", hint: "Year-end profit or loss clearing ledger.", defaults: controls(["allowJournal"]) },
  { key: "CASH_BOOK", label: "Cash Book", hint: "Primary ledger used for cash and bank voucher entries.", defaults: controls(["allowCashBank"]) },
  { key: "SALES_ACCOUNT", label: "Sales Account", hint: "Default account role for sales income; product mappings remain available.", defaults: controls(["allowSalesInvoice"]) },
  { key: "SALES_RETURN_ACCOUNT", label: "Sales Return Account", hint: "Default account role for sales returns.", defaults: controls(["allowSalesReturn"]) },
  { key: "PURCHASE_ACCOUNT", label: "Purchase Account", hint: "Default account role for purchase costs; product mappings remain available.", defaults: controls(["allowPurchaseBill"]) },
  { key: "PURCHASE_RETURN_ACCOUNT", label: "Purchase Return Account", hint: "Default account role for purchase returns.", defaults: controls(["allowPurchaseReturn"]) },
  { key: "INPUT_VAT", label: "Input VAT Receivable", hint: "Recoverable VAT on local purchases and services; keep it outside landed stock value.", defaults: controls(["allowPurchaseBill", "allowPurchaseReturn"]) },
  { key: "OUTPUT_VAT", label: "Output VAT Payable", hint: "VAT collected on sales; keep it separate from sales revenue.", defaults: controls(["allowSalesInvoice", "allowSalesReturn"]) },
  { key: "IMPORT_INPUT_VAT", label: "Import Input VAT Receivable", hint: "Recoverable VAT paid at import/customs; use a separate ledger when customs reconciliation requires it.", defaults: controls(["allowJournal", "allowPurchaseBill"]) },
  { key: "OPENING_STOCK_PL", label: "Opening Stock P&L", hint: "P&L-side ledger role for opening stock adjustments.", defaults: controls(["allowStockOpening"]) },
  { key: "CLOSING_STOCK_PL", label: "Closing Stock P&L", hint: "P&L-side ledger role for closing stock adjustments.", defaults: controls(["allowStockOpening"]) },
  { key: "CLOSING_STOCK_BS", label: "Closing Stock B/S", hint: "Balance-sheet-side ledger role for stock value.", defaults: controls(["allowOpeningBalance", "allowStockOpening"]) },
];

export const GL_SETUP_ROLE_KEYS = GL_SETUP_ROLES.map((role) => role.key) as GlRoleKey[];
export const GL_SETUP_CONTROL_KEYS = [...GL_ENTRY_TYPES.map((entry) => entry.key), "isLocked"] as const;
