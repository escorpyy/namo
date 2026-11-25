import { useEffect, useState } from "react";
import { entryControlApi } from "../api";
import { ENTRY_DEFAULTS, featureOf, resolveEntry, type EntryModuleKey, type EntryValues } from "../../shared/entryControl";

/** The company's Entry Control for one source module: `ec("remarks")` is the feature's show / edit / mandatory. Defaults until loaded
 *  (or if it cannot be loaded): the server enforces Mandatory anyway, this only shapes the screen. */
export function useEntryControl(companyId: number, module: EntryModuleKey) {
  const [controls, setControls] = useState<Record<string, EntryValues>>({});
  useEffect(() => {
    let live = true;
    entryControlApi.get(companyId).then((d) => { if (live) setControls(d.controls[module] ?? {}); }).catch(() => { /* defaults */ });
    return () => { live = false; };
  }, [companyId, module]);
  return (feature: string): EntryValues => controls[feature] ?? (featureOf(module, feature) ? resolveEntry(featureOf(module, feature)!) : ENTRY_DEFAULTS);
}
