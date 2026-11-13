import { useEffect, useSyncExternalStore } from "react";
import { masterApi, narrationEditCount } from "../api";

// The active entries of the Narration Master, shared by every narration / remarks field on screen: a voucher grid with twenty lines
// asks once, not twenty times. The list is refreshed when a field gets the focus and the master has been edited since it was loaded.
// It is only a convenience, so a failed load leaves the list empty and the fields behave as plain text boxes.

export interface NarrationEntry { id: number; code: string; narration: string }

const EMPTY: NarrationEntry[] = [];
type Slot = { rows: NarrationEntry[]; edits: number; loading?: Promise<void> };
const slots = new Map<number, Slot>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Loads (or refreshes, when the master changed since) the list for a company. Never rejects. */
export function ensureNarrations(companyId: number): Promise<void> {
  const slot = slots.get(companyId);
  if (slot?.loading) return slot.loading;
  if (slot && slot.edits === narrationEditCount()) return Promise.resolve();
  const edits = narrationEditCount();
  const loading = masterApi("narrations").list(companyId)
    .then((rows) => {
      const next = rows.filter((r) => r.isActive).map((r) => ({ id: Number(r.id), code: String(r.code), narration: String(r.narration) }));
      slots.set(companyId, { rows: next.length ? next : EMPTY, edits });
    })
    .catch(() => {
      // keep what we had; try again the next time a field gets the focus
      const old = slots.get(companyId);
      slots.set(companyId, { rows: old?.rows ?? EMPTY, edits: -1 });
    })
    .finally(() => notify());
  slots.set(companyId, { rows: slot?.rows ?? EMPTY, edits: slot?.edits ?? -1, loading });
  return loading;
}

/** The company's active narrations (empty until loaded). Starts the load on first use. */
export function useNarrations(companyId: number): NarrationEntry[] {
  useEffect(() => { void ensureNarrations(companyId); }, [companyId]);
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => slots.get(companyId)?.rows ?? EMPTY,
    () => EMPTY, // server rendering (tests): nothing loaded yet
  );
}

/** Test hook: forget everything that was cached. */
export function resetNarrationCache() { slots.clear(); notify(); }
