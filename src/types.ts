export type Mode = "new" | "view" | "edit";
/** ok / info stay in the status bar; warn and err also open a dialog (see the flash() of each screen). */
export type MsgKind = "ok" | "err" | "warn" | "info";

export interface StatusInfo {
  mode: Mode;
  count: number;
  shown: number;
  message: string;
  kind: MsgKind;
  hints?: string[]; // custom screens apne shortcuts dikhate hain
}

export interface CompanyCtx {
  id: number;
  code: string;
  name: string;
  branches: { id: number; name: string; isHeadOffice: boolean }[];
  fiscalYears: { id: number; code: string; isCurrent: boolean }[];
}
export interface ContextData {
  user: { id: number; name: string };
  companies: CompanyCtx[];
}
