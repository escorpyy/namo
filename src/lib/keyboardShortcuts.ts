export interface ReadyScreenOption {
  id: string;
  label: string;
  section: string;
}

export type ShortcutActionDefinition =
  | { id: string; label: string; kind: "screen-key"; key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }
  | { id: string; label: string; kind: "toggle-sidebar" }
  | { id: string; label: string; kind: "navigate"; target: string; section: string };

export interface ShortcutBinding {
  id: string;
  actionId: string;
  combination: string;
}

export interface ShortcutConflict {
  bindingId: string;
  combination: string;
  message: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const COMMON_SHORTCUT_ACTIONS: ShortcutActionDefinition[] = [
  { id: "save", label: "Save / update current screen", kind: "screen-key", key: "s", ctrlKey: true },
  { id: "new", label: "Create a new record or document", kind: "screen-key", key: "F3" },
  { id: "edit", label: "Edit selected record or document", kind: "screen-key", key: "F2" },
  { id: "search", label: "Search current screen", kind: "screen-key", key: "f", ctrlKey: true },
  { id: "help", label: "Show keyboard help", kind: "screen-key", key: "F1" },
  { id: "toggle-sidebar", label: "Toggle the sidebar", kind: "toggle-sidebar" },
];

export function getShortcutActions(screens: readonly ReadyScreenOption[]): ShortcutActionDefinition[] {
  return [
    ...COMMON_SHORTCUT_ACTIONS,
    ...screens.map((screen) => ({
      id: `navigate:${screen.id}`,
      label: `Open ${screen.label}`,
      kind: "navigate" as const,
      target: screen.id,
      section: screen.section,
    })),
  ];
}

const RESERVED_COMBINATIONS: Record<string, string> = {
  "Ctrl+B": "the built-in Toggle sidebar shortcut",
  "Ctrl+S": "the built-in Save / Update shortcut",
  "Ctrl+N": "the built-in New shortcut",
  "Ctrl+F": "the built-in Search shortcut",
  "Ctrl+D": "the built-in Fill down shortcut",
  "Ctrl+Delete": "the built-in Delete shortcut",
  "Ctrl+ArrowUp": "the built-in Previous record shortcut",
  "Ctrl+ArrowDown": "the built-in Next record shortcut",
  "Ctrl+ArrowLeft": "the built-in tab navigation shortcut",
  "Ctrl+ArrowRight": "the built-in tab navigation shortcut",
  "Shift+Delete": "the built-in Remove row shortcut",
  "Alt+D": "the built-in Delete shortcut",
  "Alt+1": "the built-in Focus sidebar shortcut",
  "Alt+2": "the built-in Focus form shortcut",
  "Alt+3": "the built-in Focus list shortcut",
  "Alt+4": "the built-in Expand / collapse document list shortcut",
  "Alt+ArrowDown": "the built-in Open picker shortcut",
  "Ctrl+W": "the browser Close tab shortcut",
  "Ctrl+R": "the browser Reload shortcut",
  "Ctrl+L": "the browser Address bar shortcut",
  "Ctrl+T": "the browser New tab shortcut",
  "Ctrl+P": "the browser Print shortcut",
  "Ctrl+O": "the browser Open file shortcut",
  "Ctrl+U": "the browser View source shortcut",
  "Ctrl+Tab": "the browser Next tab shortcut",
  "Ctrl+Shift+Tab": "the browser Previous tab shortcut",
  "Ctrl+PageUp": "the browser Previous tab shortcut",
  "Ctrl+PageDown": "the browser Next tab shortcut",
  "Ctrl+Shift+I": "the browser Developer tools shortcut",
  "Ctrl+Shift+J": "the browser Developer tools shortcut",
  "Ctrl+Shift+C": "the browser Inspect shortcut",
  "Ctrl+Shift+R": "the browser Hard reload shortcut",
  "Ctrl+Shift+T": "the browser Reopen closed tab shortcut",
  "Ctrl+Shift+N": "the browser Private window shortcut",
  "Ctrl+Shift+P": "the browser Private window / print shortcut",
  "Ctrl+Shift+S": "the browser Save page as shortcut",
  "Ctrl+Shift+Delete": "the browser Clear browsing data shortcut",
  "Ctrl+Backspace": "the text editor Delete previous word shortcut",
  "Alt+ArrowLeft": "the browser Back shortcut",
  "Alt+ArrowRight": "the browser Forward shortcut",
  "Alt+F4": "the operating system Close window shortcut",
  "Ctrl+Alt+Delete": "the operating system security shortcut",
  "Ctrl+Escape": "the operating system Start menu shortcut",
};

for (let i = 1; i <= 12; i += 1) RESERVED_COMBINATIONS[`F${i}`] = `the built-in or browser F${i} shortcut`;

const KEY_ALIASES: Record<string, string> = {
  Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight",
  "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight",
  Esc: "Escape", Spacebar: "Space", " ": "Space", Del: "Delete",
  PgUp: "PageUp", PgDn: "PageDown", Cmd: "Ctrl", Command: "Ctrl", Meta: "Ctrl", Control: "Ctrl",
};

function normalizeKey(value: string): string | null {
  const alias = KEY_ALIASES[value] ?? value;
  if (/^[a-z]$/i.test(alias)) return alias.toUpperCase();
  if (/^\d$/.test(alias)) return alias;
  if (/^F(?:[1-9]|1\d|2[0-4])$/.test(alias)) return alias;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Escape", "Enter", "Tab"].includes(alias)) return alias;
  if (alias.length === 1 && !/[\u0000-\u001f]/.test(alias)) return alias.toUpperCase();
  return null;
}

function normalizeModifier(value: string): string | null {
  const modifier = value.toLowerCase();
  if (["ctrl", "control", "meta", "cmd", "command"].includes(modifier)) return "Ctrl";
  if (modifier === "alt") return "Alt";
  if (modifier === "shift") return "Shift";
  return null;
}

/** Canonicalizes saved text; ordinary single keys are intentionally not valid global shortcuts. */
export function normalizeShortcutCombination(value: string): string | null {
  if (!value || value.length > 80) return null;
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const modifiers = new Set<string>();
  const keys: string[] = [];
  for (const part of parts) {
    const modifier = normalizeModifier(part);
    if (modifier) { modifiers.add(modifier); continue; }
    const key = normalizeKey(part);
    if (!key) return null;
    keys.push(key);
  }
  if (keys.length !== 1) return null;
  const [key] = keys;
  if (!modifiers.size && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return null;
  return [...["Ctrl", "Alt", "Shift"].filter((modifier) => modifiers.has(modifier)), key].join("+");
}

/** Returns a stable identifier for an event; single unmodified character keys are ignored. */
export function getShortcutCombination(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  const key = normalizeKey(event.key);
  if (!key || ["Ctrl", "Alt", "Shift", "Meta", "Control"].includes(event.key)) return null;
  if (!modifiers.length && !/^F(?:[1-9]|1\d|2[0-4])$/.test(key)) return null;
  return [...modifiers, key].join("+");
}

export function formatShortcutCombination(value: string): string {
  const normalized = normalizeShortcutCombination(value);
  if (!normalized) return value || "Not recorded";
  return normalized
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("PageUp", "Page Up")
    .replace("PageDown", "Page Down");
}

function reservedReason(combination: string): string | null {
  const exact = RESERVED_COMBINATIONS[combination];
  if (exact) return exact;
  const parts = combination.split("+");
  const key = parts[parts.length - 1];
  const modifiers = new Set(parts.slice(0, -1));
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) return `the built-in or browser ${key} shortcut`;
  if (key === "Enter") return "the built-in Enter / Shift+Enter field-navigation shortcuts";
  if (key === "Escape") return "the built-in Cancel / close shortcut";
  if (key === "Tab") return "the browser and built-in focus-navigation shortcuts";
  if (key === "Delete") return "the built-in Delete / remove-row or browser clear-history shortcut";
  if (key === "/" || key === "?") return "the built-in list-search shortcut";
  if (modifiers.has("Ctrl")) {
    const ctrlKeys: Record<string, string> = {
      B: "the built-in Toggle sidebar shortcut", S: "the built-in Save / Update shortcut",
      N: "the built-in New shortcut", F: "the built-in Search shortcut", D: "the built-in Fill down shortcut",
      ArrowUp: "the built-in Previous record shortcut", ArrowDown: "the built-in Next record shortcut",
      ArrowLeft: "the built-in tab navigation shortcut", ArrowRight: "the built-in tab navigation shortcut",
    };
    if (ctrlKeys[key]) return ctrlKeys[key];
  }
  if (modifiers.has("Alt")) {
    const altKeys: Record<string, string> = {
      D: "the built-in Delete shortcut", "1": "the built-in Focus sidebar shortcut",
      "2": "the built-in Focus form shortcut", "3": "the built-in Focus list shortcut",
      "4": "the built-in document-list shortcut", ArrowDown: "the built-in Open picker shortcut",
      ArrowLeft: "the browser Back shortcut", ArrowRight: "the browser Forward shortcut",
    };
    if (altKeys[key]) return altKeys[key];
  }
  return null;
}

export function findShortcutConflicts(
  bindings: readonly ShortcutBinding[],
  actions: readonly ShortcutActionDefinition[],
): ShortcutConflict[] {
  const knownActions = new Map(actions.map((action) => [action.id, action]));
  const conflicts: ShortcutConflict[] = [];
  const canonical = new Map<string, ShortcutBinding[]>();

  for (const binding of bindings) {
    const combination = normalizeShortcutCombination(binding.combination);
    if (!knownActions.has(binding.actionId)) {
      conflicts.push({ bindingId: binding.id, combination: binding.combination, message: "Choose a supported action before saving." });
      continue;
    }
    if (!combination) {
      conflicts.push({ bindingId: binding.id, combination: binding.combination, message: "Record a key combination before saving." });
      continue;
    }
    const reserved = reservedReason(combination);
    if (reserved) conflicts.push({ bindingId: binding.id, combination, message: `${formatShortcutCombination(combination)} is already used by ${reserved}. Choose another combination.` });
    canonical.set(combination, [...(canonical.get(combination) ?? []), binding]);
  }

  for (const [combination, group] of canonical) {
    if (group.length < 2) continue;
    const labels = group.map((binding) => knownActions.get(binding.actionId)?.label ?? "another action");
    for (const binding of group) {
      const otherLabels = group.filter((other) => other.id !== binding.id).map((other) => knownActions.get(other.actionId)?.label ?? "another action");
      const names = otherLabels.length ? otherLabels.join(", ") : labels[0];
      conflicts.push({
        bindingId: binding.id,
        combination,
        message: `${formatShortcutCombination(combination)} is assigned more than once (also: ${names}). Give each action a different combination.`,
      });
    }
  }
  return conflicts;
}

export function shortcutStorageKey(userId: number): string {
  return `namo:keyboard-shortcuts:user:${userId}`;
}

function isStoredBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 && item.id.length <= 100
    && typeof item.actionId === "string" && item.actionId.length > 0 && item.actionId.length <= 160
    && typeof item.combination === "string" && item.combination.length <= 80;
}

export function readShortcutBindings(
  storage: StorageLike | null,
  userId: number,
  actions: readonly ShortcutActionDefinition[],
): ShortcutBinding[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(shortcutStorageKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const actionIds = new Set(actions.map((action) => action.id));
    return parsed.filter(isStoredBinding)
      .filter((binding) => actionIds.has(binding.actionId))
      .map((binding) => ({ ...binding, combination: normalizeShortcutCombination(binding.combination) ?? binding.combination }));
  } catch {
    return [];
  }
}

export function writeShortcutBindings(
  storage: StorageLike | null,
  userId: number,
  bindings: readonly ShortcutBinding[],
  actions: readonly ShortcutActionDefinition[],
): { ok: true; bindings: ShortcutBinding[] } | { ok: false; conflicts?: ShortcutConflict[]; error?: string } {
  const conflicts = findShortcutConflicts(bindings, actions);
  if (conflicts.length) return { ok: false, conflicts };
  if (!storage) return { ok: false, error: "Browser storage is unavailable. Your shortcuts were not saved." };
  const normalized = bindings.map((binding) => ({ ...binding, combination: normalizeShortcutCombination(binding.combination)! }));
  try {
    storage.setItem(shortcutStorageKey(userId), JSON.stringify(normalized));
    return { ok: true, bindings: normalized };
  } catch {
    return { ok: false, error: "Browser storage is unavailable. Your shortcuts were not saved." };
  }
}

export function getBrowserShortcutStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function dispatchScreenShortcut(action: Extract<ShortcutActionDefinition, { kind: "screen-key" }>): void {
  if (typeof document === "undefined") return;
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target?.dispatchEvent(new KeyboardEvent("keydown", {
    key: action.key,
    bubbles: true,
    cancelable: true,
    ctrlKey: !!action.ctrlKey,
    altKey: !!action.altKey,
    shiftKey: !!action.shiftKey,
  }));
}
