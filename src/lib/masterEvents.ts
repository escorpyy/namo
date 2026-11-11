import { useEffect, useRef } from "react";

// A master record was just created without leaving the screen (Ctrl+M on a reference field). Everything that keeps its own copy of
// that master's list (a purchase document's pick-lists, a master form's lookups, a Ctrl+M dialog) registers here and reloads it,
// so the new record is in the options before the field is set to it.
type Reloader = (masterKey: string) => Promise<void> | void;
const reloaders = new Set<Reloader>();

/** Resolves once every registered screen has reloaded; rejects if one could not. */
export async function announceMasterChanged(masterKey: string): Promise<void> {
  await Promise.all([...reloaders].map((fn) => fn(masterKey)));
}

/** Register a reloader for as long as the component is mounted (the latest `fn` is always the one called). */
export function useOnMasterChanged(fn: Reloader, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const reloader: Reloader = (key) => latest.current(key);
    reloaders.add(reloader);
    return () => { reloaders.delete(reloader); };
  }, [enabled]);
}
