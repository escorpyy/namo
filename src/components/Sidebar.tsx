import { useState } from "react";
import {
  BarChart3, BookOpen, BookText, Boxes, ChevronDown, ChevronRight, ClipboardList, FileText, FolderTree, Landmark,
  LayoutDashboard, Layers, Map, MapPin, Package, PanelLeftClose, PanelLeftOpen, Percent, Ruler, Settings,
  Scale, Tag, UserCheck, UserSquare, Users, Warehouse, Building2, Network, CalendarRange, UserCog, KeyRound, Receipt, ShoppingCart,
} from "lucide-react";
import { MASTERS } from "../../shared/masters";

// Master-engine ke bahar ki custom screens (grid etc.)
export const CUSTOM_SCREENS = ["opening-balance", "stock-opening"];

type Item = { id: string; label: string; icon: React.ElementType };
type Section = { id: string; label: string; icon: React.ElementType; items: Item[] };

// Jo id shared/masters.ts me hai wo "ready" hai; baaki "not built yet"
const sections: Section[] = [
  {
    id: "accounts", label: "Accounts", icon: ClipboardList,
    items: [
      { id: "account-groups", label: "Account Group", icon: FolderTree },
      { id: "account-sub-groups", label: "Account Sub Group", icon: Layers },
      { id: "general-ledger", label: "General Ledger", icon: BookOpen },
      { id: "sub-ledger", label: "Sub Ledger", icon: BookText },
      { id: "opening-balance", label: "Opening Balance", icon: Scale },
    ],
  },
  {
    id: "parties", label: "Parties", icon: Users,
    items: [
      { id: "areas", label: "Area", icon: Map },
      { id: "sub-areas", label: "Sub Area", icon: MapPin },
      { id: "agents", label: "Agent", icon: UserCheck },
      { id: "party", label: "Party", icon: UserSquare },
    ],
  },
  {
    id: "inventory", label: "Inventory", icon: Package,
    items: [
      { id: "product-groups", label: "Product Group", icon: Boxes },
      { id: "product-sub-groups", label: "Product Sub Group", icon: Layers },
      { id: "product-units", label: "Unit", icon: Ruler },
      { id: "tax-rates", label: "Tax Rate", icon: Percent },
      { id: "stock-categories", label: "Stock Category", icon: Tag },
      { id: "locations", label: "Location", icon: Warehouse },
      { id: "stock-opening", label: "Stock Opening Balance", icon: Scale },
      { id: "products", label: "Product", icon: Package },
    ],
  },
  {
    id: "billing", label: "Billing", icon: Receipt,
    items: [
      { id: "purchase-terms", label: "Purchase Term", icon: ShoppingCart },
      { id: "sales-terms", label: "Sales Term", icon: Receipt },
    ],
  },
  {
    id: "admin", label: "Admin", icon: Settings,
    items: [
      { id: "companies", label: "Company", icon: Building2 },
      { id: "branches", label: "Branch", icon: Network },
      { id: "fiscal-years", label: "Fiscal Year", icon: CalendarRange },
      { id: "users", label: "User", icon: UserCog },
      { id: "user-access", label: "User Access", icon: KeyRound },
    ],
  },
  {
    id: "vouchers", label: "Vouchers", icon: FileText,
    items: [
      { id: "journal", label: "Journal", icon: FileText },
      { id: "cash-bank", label: "Cash/Bank", icon: Landmark },
    ],
  },
];

interface Props {
  collapsed: boolean;
  active: string;
  onToggle: () => void;
  onNavigate: (id: string) => void;
  onNotify: (msg: string) => void;
}

export function Sidebar({ collapsed, active, onToggle, onNavigate, onNotify }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({ accounts: true, parties: true, inventory: true, billing: true, admin: true, vouchers: false });

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const btns = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("button[data-sb]"));
    const i = btns.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); btns[Math.min(i + 1, btns.length - 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); btns[Math.max(i - 1, 0)]?.focus(); }
    else if (e.key === "Escape") { e.stopPropagation(); document.querySelector<HTMLElement>("[data-zone=form] [data-nav]")?.focus(); }
  };

  const itemBtn = (it: Item, indent: boolean) => {
    const Icon = it.icon;
    const ready = !!MASTERS[it.id] || CUSTOM_SCREENS.includes(it.id);
    const isActive = it.id === active;
    return (
      <button
        key={it.id} data-sb title={collapsed ? it.label : ready ? undefined : "Not built yet"}
        aria-current={isActive ? "page" : undefined}
        onClick={() => (ready ? !isActive && onNavigate(it.id) : onNotify(`${it.label} screen is not built yet`))}
        className={`w-full flex items-center gap-3 h-8 text-left hover:bg-white/10 ${collapsed ? "justify-center" : indent ? "pl-8 pr-3" : "px-4"} ${isActive ? "bg-blue-700 text-white" : ready ? "text-slate-100" : "text-slate-400"}`}
      >
        <Icon size={16} className="shrink-0" />
        {!collapsed && <span className="truncate">{it.label}</span>}
      </button>
    );
  };

  return (
    <aside data-zone="sidebar" onKeyDown={onKeyDown} className={`${collapsed ? "w-[52px]" : "w-[240px]"} shrink-0 bg-slate-700 text-slate-100 flex flex-col transition-[width] duration-100`}>
      <nav className="flex-1 overflow-y-auto py-1">
        {itemBtn({ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }, false)}
        {sections.map((s) => (
          <div key={s.id} className="border-t border-white/10 mt-1 pt-1">
            {collapsed ? (
              s.items.map((it) => itemBtn(it, false))
            ) : (
              <>
                <button data-sb onClick={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} className="w-full flex items-center gap-3 h-8 px-4 hover:bg-white/10 font-semibold">
                  <s.icon size={16} /> <span className="flex-1 text-left">{s.label}</span>
                  {open[s.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {open[s.id] && s.items.map((it) => itemBtn(it, true))}
              </>
            )}
          </div>
        ))}
        <div className="border-t border-white/10 mt-1 pt-1">
          {itemBtn({ id: "reports", label: "Reports", icon: BarChart3 }, false)}
          {itemBtn({ id: "settings", label: "Settings", icon: Settings }, false)}
        </div>
      </nav>
      <button onClick={onToggle} title="Toggle sidebar (Ctrl+B)" className="h-10 border-t border-white/10 flex items-center gap-2 px-4 hover:bg-white/10 text-[12px]">
        {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        {!collapsed && (<><span className="flex-1 text-left">Collapse Sidebar</span><span className="kbd">Ctrl+B</span></>)}
      </button>
    </aside>
  );
}
