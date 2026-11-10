const rows: [string, string][] = [
  ["Enter / Shift+Enter", "Next / previous field"],
  ["Ctrl+S", "Save / Update"],
  ["F3 / Ctrl+N", "New record"],
  ["F2", "Edit selected"],
  ["Ctrl+Delete / Alt+D", "Delete (confirmation)"],
  ["Esc", "Cancel / close / step back"],
  ["F4 / Ctrl+F / /", "Search list (or picker search while open)"],
  ["Ctrl+↑ / Ctrl+↓", "Previous / next record"],
  ["Alt+1 / Alt+2 / Alt+3", "Focus Sidebar / Form / List"],
  ["Ctrl+B", "Toggle sidebar"],
  ["Alt+4 (purchase)", "Expand / collapse the document list"],
  ["Ctrl+← / Ctrl+→", "Tabs badlo (Product jaise forms me)"],
  ["Delete", "Select ki hui row hatao (list me record, lines me row — row number par click ya cell me Esc se row select hoti hai)"],
  ["Shift+Delete", "Lines me cell ke andar se row hatao (Alternate Units, Components)"],
  ["Ctrl+D", "Fill down: upar wali cell / row copy karo"],
  ["A L E R X", "Quick-pick Type in the combobox"],
  ["Alt+↓ / Enter", "Open a master reference picker"],
  ["Picker: ↑ / ↓, Enter, Esc", "Move / select / close"],
  ["F1 / ?", "This help"],
];

export function ShortcutsOverlay({ onClose, shortcuts = rows }: { onClose: () => void; shortcuts?: [string, string][] }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30" onClick={onClose}>
      <div className="w-[520px] bg-paper border border-slate-500 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="bg-navy text-white px-3 py-1.5 font-semibold flex justify-between">
          <span>Keyboard Shortcuts</span>
          <span className="text-[11px] opacity-80">Esc to close</span>
        </div>
        <table className="xl-table text-[13px]">
          <tbody>
            {shortcuts.map(([k, d]) => (
              <tr key={k} className="border-b border-rule last:border-0">
                <td className="py-1 px-3 w-[200px]"><span className="kbd">{k}</span></td>
                <td className="py-1 px-3">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
