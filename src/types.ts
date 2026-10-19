export type Mode = "new" | "view" | "edit";
export type MsgKind = "ok" | "err" | "info";

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
