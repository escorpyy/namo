const rows: [string, string][] = [
  ["Enter / Shift+Enter", "Next / previous field"],
  ["Ctrl+S", "Save / Update"],
  ["F3 / Ctrl+N", "New record"],
  ["F2", "Edit selected"],
  ["Ctrl+Delete / Alt+D", "Delete (confirmation)"],
  ["Esc", "Cancel / close / step back"],
  ["F4 / Ctrl+F / /", "Search list"],
  ["Ctrl+↑ / Ctrl+↓", "Previous / next record"],
  ["Alt+1 / Alt+2 / Alt+3", "Focus Sidebar / Form / List"],
  ["Ctrl+B", "Toggle sidebar"],
  ["Alt+4 (purchase)", "Expand / collapse the document list"],
  ["Ctrl+← / Ctrl+→", "Tabs badlo (Product jaise forms me)"],
  ["Shift+Delete", "Lines me row hatao (Alternate Units, Components)"],
  ["A L E R X", "Quick-pick Type in the combobox"],
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
        <table className="w-full text-[13px] m-1">
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
