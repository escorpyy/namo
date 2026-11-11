import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  BookText,
  Boxes,
  Building2,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  FileBarChart2,
  FileText,
  FolderTree,
  Hash,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  LineChart,
  Map,
  MapPin,
  Network,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Ruler,
  Scale,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  TrendingUp,
  UserCheck,
  UserCog,
  UserSquare,
  Users,
  Warehouse,
  Wrench,
} from "lucide-react";
import { MASTERS } from "../../shared/masters";

// Custom screens that are not driven by the master engine (grids etc.)
export const CUSTOM_SCREENS = [
  "opening-balance",
  "stock-opening",
  "purchase-orders",
  "purchase-challans",
  "purchase-bills",
  "purchase-import-assessments",
  "code-numbering",
];

type Item = { id: string; label: string };
type Section = {
  id: string;
  label: string;
  icon: React.ElementType;
  items: Item[];
};

// An item is "ready" if its id exists in shared/masters.ts or CUSTOM_SCREENS; everything else shows "not built yet".
// Each feature appears exactly once. Where the same thing existed in two groups, the copy that fits best was kept.
const sections: Section[] = [
  {
    id: "master",
    label: "Master",
    icon: Database,
    items: [
      { id: "account-groups", label: "Account Group Master" },
      { id: "account-sub-groups", label: "Account Sub-Group Master" },
      { id: "general-ledger", label: "Ledger Master" },
      { id: "sub-ledger", label: "Sub-Ledger Master" },
      { id: "opening-balance", label: "Opening Balance Master" },
      { id: "party", label: "Party Master" },
      { id: "areas", label: "Area Master" },
      { id: "sub-areas", label: "Sub-Area Master" },
      { id: "agents", label: "Agent Master" },
      { id: "products", label: "Product Master" },
      { id: "product-groups", label: "Product Group Master" },
      { id: "product-sub-groups", label: "Product Sub-Group Master" },
      { id: "product-units", label: "Unit Master" },
      { id: "tax-rates", label: "Tax Rate Master" },
      { id: "stock-categories", label: "Stock Category Master" },
      { id: "locations", label: "Location Master" },
      { id: "purchase-terms", label: "Purchase Bill Terms Master" },
      { id: "sales-terms", label: "Sales Bill Terms Master" },
      { id: "narrations", label: "Narration Master" },
      { id: "fiscal-years", label: "Fiscal Year Master" },
    ],
  },
  {
    id: "transactions",
    label: "Transactions",
    icon: Receipt,
    items: [
      { id: "cash-bank", label: "Cash / Bank Voucher" },
      { id: "journal", label: "Journal Voucher" },
      { id: "purchase-orders", label: "Purchase Order" },
      { id: "purchase-challans", label: "Purchase Challan" },
      { id: "purchase-bills", label: "Purchase Bill" },
      { id: "purchase-import-assessments", label: "Import Cost Assessment" },
      { id: "sales", label: "Sales" },
      { id: "debit-note", label: "Debit Note" },
      { id: "credit-note", label: "Credit Note" },
    ],
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: Package,
    items: [
      { id: "stock-receipt", label: "Stock Receipt" },
      { id: "stock-issue", label: "Stock Issue" },
      { id: "stock-transfer", label: "Stock Transfer" },
      { id: "stock-adjustment", label: "Stock Adjustment" },
      { id: "stock-opening", label: "Stock Opening" },
      { id: "stock-consumption", label: "Stock Consumption" },
      { id: "stock-production", label: "Stock Production" },
      { id: "physical-stock", label: "Physical Stock" },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: FileBarChart2,
    items: [
      { id: "rpt-cash", label: "Cash Reports" },
      { id: "rpt-bank", label: "Bank Reports" },
      { id: "rpt-journal", label: "Journal Reports" },
      { id: "rpt-purchase", label: "Purchase Reports" },
      { id: "rpt-sales", label: "Sales Reports" },
      { id: "rpt-debit-note", label: "Debit Note Reports" },
      { id: "rpt-credit-note", label: "Credit Note Reports" },
      { id: "rpt-receipt-payment", label: "Receipt / Payment Reports" },
      { id: "rpt-outstanding", label: "Outstanding Reports" },
      { id: "rpt-ageing", label: "Ageing Reports" },
    ],
  },
  {
    id: "inventory-reports",
    label: "Inventory Reports",
    icon: FileBarChart2,
    items: [
      { id: "inv-stock-ledger", label: "Stock Ledger" },
      { id: "inv-stock-summary", label: "Stock Summary" },
      { id: "inv-stock-valuation", label: "Stock Valuation" },
      { id: "inv-stock-movement", label: "Stock Movement" },
      { id: "inv-stock-aging", label: "Stock Aging" },
      { id: "inv-slow-fast-moving", label: "Slow / Fast Moving Items" },
      { id: "inv-stock-adjustment-report", label: "Stock Adjustment Report" },
    ],
  },
  {
    id: "financial-statements",
    label: "FS — Financial Statements",
    icon: Landmark,
    items: [
      { id: "fs-ledgers", label: "Ledgers" },
      { id: "fs-trial-balance", label: "Trial Balance" },
      { id: "fs-income-statement", label: "Income Statement" },
      { id: "fs-balance-sheet", label: "Balance Sheet" },
      { id: "fs-cash-flow", label: "Cash Flow Statement" },
      {
        id: "fs-owners-equity",
        label: "Statement of Changes in Owner's Equity",
      },
    ],
  },
  {
    // Working Capital, Ratios, Budget and Profitability live in FM Analysis; not repeated here.
    id: "analysis",
    label: "Analysis",
    icon: LineChart,
    items: [
      { id: "dashboard", label: "Dashboard" },
      { id: "an-sales", label: "Sales Analysis" },
      { id: "an-purchase", label: "Purchase Analysis" },
      { id: "an-expense", label: "Expense Analysis" },
      { id: "an-cash-bank", label: "Cash & Bank Analysis" },
    ],
  },
  {
    id: "fm-analysis",
    label: "FM Analysis",
    icon: TrendingUp,
    items: [
      { id: "fm-financial-dashboard", label: "Financial Dashboard" },
      { id: "fm-financial-performance", label: "Financial Performance" },
      { id: "fm-revenue", label: "Revenue Analysis" },
      { id: "fm-gross-profit", label: "Gross Profit Analysis" },
      { id: "fm-net-profit", label: "Net Profit Analysis" },
      { id: "fm-profit-margin", label: "Profit Margin Analysis" },
      { id: "fm-cash-flow", label: "Cash Flow Analysis" },
      { id: "fm-working-capital", label: "Working Capital Analysis" },
      { id: "fm-liquidity", label: "Liquidity Analysis" },
      { id: "fm-solvency", label: "Solvency Analysis" },
      { id: "fm-efficiency", label: "Efficiency Analysis" },
      { id: "fm-receivable", label: "Receivable Analysis" },
      { id: "fm-payable", label: "Payable Analysis" },
      { id: "fm-inventory-financial", label: "Inventory Financial Analysis" },
      { id: "fm-financial-ratios", label: "Financial Ratios" },
      { id: "fm-budget-vs-actual", label: "Budget vs Actual" },
      { id: "fm-period-comparison", label: "Period Comparison" },
      { id: "fm-financial-trends", label: "Financial Trends" },
    ],
  },
  {
    id: "housekeep",
    label: "Housekeep",
    icon: Wrench,
    items: [
      { id: "hk-data-maintenance", label: "Data Maintenance" },
      { id: "hk-period-management", label: "Period Management" },
      { id: "hk-data-verification", label: "Data Verification" },
      { id: "hk-reconciliation", label: "Reconciliation" },
      { id: "hk-audit-trail", label: "Audit Trail" },
      { id: "hk-backup-recovery", label: "Backup & Recovery" },
    ],
  },
  {
    // Financial Year and Chart of Accounts are not repeated here: they are Fiscal Year / Account masters above.
    id: "setup",
    label: "Setup",
    icon: SlidersHorizontal,
    items: [
      { id: "companies", label: "Company" },
      { id: "branches", label: "Branch" },
      { id: "setup-accounting", label: "Accounting" },
      { id: "setup-tax", label: "Tax" },
      { id: "setup-voucher-configuration", label: "Voucher Configuration" },
      { id: "setup-inventory", label: "Inventory Setup" },
      { id: "setup-sales-purchase", label: "Sales & Purchase" },
      { id: "setup-receivable-payable", label: "Receivable & Payable" },
      { id: "setup-documents", label: "Document Setup" },
      { id: "code-numbering", label: "Code Numbering" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
    items: [
      { id: "users", label: "Users" },
      { id: "user-access", label: "User Access" },
      { id: "set-preferences", label: "Application Preferences" },
      { id: "set-localization", label: "Localization" },
      { id: "set-appearance", label: "Appearance" },
      { id: "set-notifications", label: "Notifications" },
      { id: "set-security", label: "Security" },
      { id: "set-email-communication", label: "Email & Communication" },
      { id: "set-integrations", label: "Integrations" },
      { id: "set-import-export", label: "Import / Export" },
    ],
  },
];

const sectionOf = (itemId: string) =>
  sections.find((s) => s.items.some((i) => i.id === itemId))?.id;

interface Props {
  collapsed: boolean;
  active: string;
  onToggle: () => void;
  onNavigate: (id: string) => void;
  onNotify: (msg: string) => void;
}

export function Sidebar({
  collapsed,
  active,
  onToggle,
  onNavigate,
  onNotify,
}: Props) {
  // With ~11 groups, only the group of the current screen starts open.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const s = sectionOf(active);
    return s ? { [s]: true } : {};
  });

  useEffect(() => {
    const s = sectionOf(active);
    if (s) setOpen((o) => (o[s] ? o : { ...o, [s]: true }));
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const btns = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("button[data-sb]"),
    );
    const i = btns.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      btns[Math.min(i + 1, btns.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      btns[Math.max(i - 1, 0)]?.focus();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      document
        .querySelector<HTMLElement>("[data-zone=form] [data-nav]")
        ?.focus();
    }
  };

  const itemBtn = (it: Item) => {
    const ready = !!MASTERS[it.id] || CUSTOM_SCREENS.includes(it.id);
    const isActive = it.id === active;
    return (
      <button
        key={it.id}
        data-sb
        title={ready ? undefined : "Not built yet"}
        aria-current={isActive ? "page" : undefined}
        onClick={() =>
          ready
            ? !isActive && onNavigate(it.id)
            : onNotify(`${it.label} screen is not built yet`)
        }
        className={`w-full flex items-center h-8 pl-10 pr-3 text-left hover:bg-white/10 ${isActive ? "bg-blue-700 text-white" : ready ? "text-slate-100" : "text-slate-400"}`}
      >
        <span className="truncate">{it.label}</span>
      </button>
    );
  };

  const groupBtn = (s: Section) => {
    const Icon = s.icon;
    const hasActive = s.items.some((i) => i.id === active);
    // Collapsed rail shows one icon per group; clicking it expands the sidebar with that group open.
    const onClick = () => {
      if (collapsed) {
        setOpen((o) => ({ ...o, [s.id]: true }));
        onToggle();
      } else setOpen((o) => ({ ...o, [s.id]: !o[s.id] }));
    };
    return (
      <button
        data-sb
        onClick={onClick}
        title={collapsed ? s.label : undefined}
        aria-expanded={collapsed ? undefined : !!open[s.id]}
        className={`w-full flex items-center gap-3 h-8 hover:bg-white/10 font-semibold ${collapsed ? "justify-center" : "px-4"} ${hasActive && collapsed ? "bg-blue-700 text-white" : ""}`}
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{s.label}</span>
            {open[s.id] ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </>
        )}
      </button>
    );
  };

  return (
    <aside
      data-zone="sidebar"
      onKeyDown={onKeyDown}
      className={`${collapsed ? "w-[52px]" : "w-[240px]"} shrink-0 bg-slate-700 text-slate-100 flex flex-col transition-[width] duration-100`}
    >
      <nav className="flex-1 overflow-y-auto py-1">
        {sections.map((s) => (
          <div
            key={s.id}
            className="border-t border-white/10 first:border-t-0 mt-1 first:mt-0 pt-1 first:pt-0"
          >
            {groupBtn(s)}
            {!collapsed && open[s.id] && s.items.map(itemBtn)}
          </div>
        ))}
      </nav>
      <button
        onClick={onToggle}
        title="Toggle sidebar (Ctrl+B)"
        className="h-10 border-t border-white/10 flex items-center gap-2 px-4 hover:bg-white/10 text-[12px]"
      >
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Collapse Sidebar</span>
            <span className="kbd">Ctrl+B</span>
          </>
        )}
      </button>
    </aside>
  );
}
