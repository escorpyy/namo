import { describe, expect, it } from "vitest";
import {
  COMMON_SHORTCUT_ACTIONS,
  findShortcutConflicts,
  getShortcutCombination,
  normalizeShortcutCombination,
  readShortcutBindings,
  shortcutStorageKey,
  writeShortcutBindings,
  type StorageLike,
} from "../src/lib/keyboardShortcuts";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("keyboard shortcut settings", () => {
  it("normalizes modifiers, key case, aliases, and browser Command to portable Ctrl", () => {
    expect(normalizeShortcutCombination("Meta+shift+s")).toBe("Ctrl+Shift+S");
    expect(normalizeShortcutCombination("Control+Alt+ArrowUp")).toBe("Ctrl+Alt+ArrowUp");
    expect(normalizeShortcutCombination("Ctrl+↑")).toBe("Ctrl+ArrowUp");
    expect(normalizeShortcutCombination("Shift+F13")).toBe("Shift+F13");
    expect(normalizeShortcutCombination("s")).toBeNull();
    expect(normalizeShortcutCombination("Ctrl+A+B")).toBeNull();
  });

  it("normalizes actual key events and does not capture unmodified typing", () => {
    expect(getShortcutCombination({ key: "s", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl+S");
    expect(getShortcutCombination({ key: "s", ctrlKey: false, metaKey: true, altKey: false, shiftKey: true })).toBe("Ctrl+Shift+S");
    expect(getShortcutCombination({ key: "F13", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe("F13");
    expect(getShortcutCombination({ key: "x", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBeNull();
  });

  it("reports duplicate custom bindings on every conflicting row", () => {
    const bindings = [
      { id: "one", actionId: "save", combination: "Ctrl+Alt+K" },
      { id: "two", actionId: "edit", combination: "Alt+Ctrl+k" },
    ];
    const conflicts = findShortcutConflicts(bindings, COMMON_SHORTCUT_ACTIONS);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.map((conflict) => conflict.bindingId)).toEqual(["one", "two"]);
    expect(conflicts[0].message).toContain("assigned more than once");
  });

  it("blocks ERP and browser-reserved combinations and rejects missing keys", () => {
    const bindings = [
      { id: "erp", actionId: "new", combination: "Ctrl+S" },
      { id: "browser", actionId: "help", combination: "Ctrl+W" },
      { id: "empty", actionId: "save", combination: "" },
    ];
    const conflicts = findShortcutConflicts(bindings, COMMON_SHORTCUT_ACTIONS);
    expect(conflicts).toHaveLength(3);
    expect(conflicts[0].message).toContain("built-in Save / Update");
    expect(conflicts[1].message).toContain("browser Close tab");
    expect(conflicts[2].message).toContain("Record a key combination");
  });

  it("saves only conflict-free bindings per user and reads valid data back", () => {
    const storage = new MemoryStorage();
    const binding = { id: "one", actionId: "save", combination: "Alt+Ctrl+k" };
    const saved = writeShortcutBindings(storage, 17, [binding], COMMON_SHORTCUT_ACTIONS);
    expect(saved.ok).toBe(true);
    expect(storage.getItem(shortcutStorageKey(17))).toContain("Ctrl+Alt+K");
    expect(readShortcutBindings(storage, 17, COMMON_SHORTCUT_ACTIONS)).toEqual([
      { ...binding, combination: "Ctrl+Alt+K" },
    ]);
    expect(readShortcutBindings(storage, 18, COMMON_SHORTCUT_ACTIONS)).toEqual([]);

    const blocked = writeShortcutBindings(storage, 17, [{ ...binding, combination: "Ctrl+S" }], COMMON_SHORTCUT_ACTIONS);
    expect(blocked.ok).toBe(false);
    expect(readShortcutBindings(storage, 17, COMMON_SHORTCUT_ACTIONS)[0].combination).toBe("Ctrl+Alt+K");
  });

  it("ignores malformed and unknown persisted records", () => {
    const storage = new MemoryStorage();
    storage.setItem(shortcutStorageKey(4), JSON.stringify([
      { id: "ok", actionId: "save", combination: "Ctrl+Alt+x" },
      { id: "unknown", actionId: "not-an-action", combination: "Ctrl+Alt+X" },
      null,
      { id: "bad", actionId: "save", combination: "x" },
    ]));
    expect(readShortcutBindings(storage, 4, COMMON_SHORTCUT_ACTIONS)).toEqual([
      { id: "ok", actionId: "save", combination: "Ctrl+Alt+X" },
      { id: "bad", actionId: "save", combination: "x" },
    ]);
  });
});
