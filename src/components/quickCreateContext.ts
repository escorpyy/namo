import { createContext, useContext } from "react";
import type { Row } from "../lib/form";

// What a field passes to its picker to say "Ctrl+M creates a record of this master".
export interface CreateMasterSpec {
  /** shared/masters.ts key of the master to create */
  key: string;
  /** field -> value to pre-fill in the New form (e.g. a vendor is a Party of type VENDOR) */
  defaults?: Record<string, string | boolean>;
  /** The picker option value for a created row. Default: String(row.id). (A vendor option is the ledger id, not the party id.) */
  valueFrom?: (row: Row) => string;
}

export interface QuickCreateRequest {
  key: string;
  /** what was typed in the picker's search box: becomes the name of the new record */
  name?: string;
  defaults?: Record<string, string | boolean>;
}
/** Opens the New form of a master in a dialog; resolves the saved row, or null when the user cancelled. */
export type QuickCreateFn = (req: QuickCreateRequest) => Promise<Row | null>;

export const QuickCreateContext = createContext<QuickCreateFn | null>(null);
export const useQuickCreate = () => useContext(QuickCreateContext);
