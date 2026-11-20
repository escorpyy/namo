import type { LedgerReportRow, LedgerReportSummary } from "../api";
import type { Month } from "./ledgerReportLayout";

export type LedgerGroupFieldId =
  | "accountGroup"
  | "accountSubGroup"
  | "generalLedger"
  | "subLedger"
  | "agent"
  | "area"
  | "subArea"
  | "month"
  | "source"
  | "postingStatus"
  | "postedBy";

export type LedgerGroupField = { id: LedgerGroupFieldId; label: string; summary: boolean };

/** Summary-compatible dimensions are stable ledger/master attributes; the rest belong to transaction rows. */
export const LEDGER_GROUP_FIELDS: LedgerGroupField[] = [
  { id: "accountGroup", label: "Account Group", summary: true },
  { id: "accountSubGroup", label: "Account Subgroup", summary: true },
  { id: "generalLedger", label: "General Ledger", summary: true },
  { id: "subLedger", label: "Sub-ledger", summary: false },
  { id: "agent", label: "Agent", summary: true },
  { id: "area", label: "Area", summary: true },
  { id: "subArea", label: "Sub-area", summary: true },
  { id: "month", label: "Month", summary: false },
  { id: "source", label: "Source module", summary: false },
  { id: "postingStatus", label: "Posting status", summary: false },
  { id: "postedBy", label: "Posted by", summary: false },
];

export type LedgerGroupItem = LedgerReportRow | LedgerReportSummary;
export type LedgerGroupNode<T> = {
  field: LedgerGroupFieldId;
  label: string;
  depth: number;
  rows: T[];
  children: LedgerGroupNode<T>[];
};

export function firstLedgerGroupRow<T>(nodes: LedgerGroupNode<T>[]): T | undefined {
  let node = nodes[0];
  while (node?.children.length) node = node.children[0];
  return node?.rows[0];
}

type DimensionValue = { key: string; label: string };
const unassigned = { key: "unassigned", label: "Unassigned" };
const pair = (id: number | null | undefined, code: string | null | undefined, name: string | null | undefined): DimensionValue =>
  id == null || !name ? unassigned : { key: String(id), label: code ? `${code} — ${name}` : name };

function dimension(item: LedgerGroupItem, field: LedgerGroupFieldId, months: Month[]): DimensionValue {
  const row = "d" in item ? item : null;
  switch (field) {
    case "accountGroup": return pair(item.accountGroupId, item.accountGroupCode, item.accountGroupName);
    case "accountSubGroup": return pair(item.accountSubGroupId, item.accountSubGroupCode, item.accountSubGroupName);
    case "generalLedger": return row ? pair(row.generalLedgerId, row.ledgerCode, row.ledgerName) : pair(item.generalLedgerId, "code" in item ? item.code : null, "name" in item ? item.name : null);
    case "subLedger": return row ? pair(row.subLedgerId, row.subLedgerCode, row.subLedgerName) : unassigned;
    case "agent": return pair(item.agentId, item.agentCode, item.agentName);
    case "area": return pair(item.areaId, item.areaCode, item.areaName);
    case "subArea": return pair(item.subAreaId, item.subAreaCode, item.subAreaName);
    case "month": {
      if (!row) return unassigned;
      const date = row.d.slice(0, 10), month = months.find((m) => m.from <= date && m.to >= date);
      return month ? { key: month.from, label: month.label } : unassigned;
    }
    case "source": return row && row.sourceLabel ? { key: row.sourceLabel, label: row.sourceLabel } : unassigned;
    case "postingStatus": return row ? { key: row.posted ? "posted" : "draft", label: row.posted ? "Posted" : "Draft" } : unassigned;
    case "postedBy": return row ? pair(row.postedBy, null, row.postedByName) : unassigned;
  }
}

/** Builds a deterministic, ordered tree. Each node carries its full descendant rows for exact subtotals. */
export function buildLedgerGroupTree<T extends LedgerGroupItem>(items: T[], fields: LedgerGroupFieldId[], months: Month[]): LedgerGroupNode<T>[] {
  if (!fields.length) return [];
  const build = (rows: T[], depth: number): LedgerGroupNode<T>[] => {
    const field = fields[depth];
    const buckets = new Map<string, { label: string; rows: T[] }>();
    for (const row of rows) {
      const value = dimension(row, field, months);
      const bucket = buckets.get(value.key) ?? { label: value.label, rows: [] };
      bucket.rows.push(row);
      buckets.set(value.key, bucket);
    }
    return [...buckets.entries()]
      .sort((a, b) => field === "month"
        ? a[0].localeCompare(b[0])
        : a[1].label.localeCompare(b[1].label, undefined, { numeric: true, sensitivity: "base" }))
      .map(([key, bucket]) => ({
        field,
        label: bucket.label,
        depth,
        rows: bucket.rows,
        children: depth + 1 < fields.length ? build(bucket.rows, depth + 1) : [],
      }));
  };
  return build(items, 0);
}
