import { expect, it } from "vitest";
import { COMMON_SHORTCUT_ACTIONS, findShortcutConflicts } from "../src/lib/keyboardShortcuts";

it("reserves modified variants of legacy function, Ctrl, and Alt shortcuts", () => {
  const bindings = [
    { id: "calculator", actionId: "new", combination: "Ctrl+0" },
    { id: "new", actionId: "new", combination: "Ctrl+Alt+N" },
    { id: "edit", actionId: "edit", combination: "Shift+F2" },
    { id: "delete", actionId: "save", combination: "Alt+Shift+D" },
    { id: "form", actionId: "help", combination: "Ctrl+Enter" },
    { id: "clear-history", actionId: "new", combination: "Ctrl+Shift+Delete" },
    { id: "os-security", actionId: "save", combination: "Ctrl+Alt+Delete" },
    { id: "close-window", actionId: "edit", combination: "Alt+F4" },
  ];
  const conflicts = findShortcutConflicts(bindings, COMMON_SHORTCUT_ACTIONS);
  expect(conflicts).toHaveLength(bindings.length);
  expect(conflicts.map((conflict) => conflict.bindingId)).toEqual(bindings.map((binding) => binding.id));
  expect(conflicts[0].message).toContain("Global calculator");
  expect(conflicts[1].message).toContain("built-in New");
  expect(conflicts[2].message).toContain("F2");
  expect(conflicts[3].message).toContain("built-in Delete");
  expect(conflicts[4].message).toContain("Enter");
  expect(conflicts[5].message).toContain("Clear browsing data");
  expect(conflicts[6].message).toContain("operating system security");
  expect(conflicts[7].message).toContain("Close window");
});
