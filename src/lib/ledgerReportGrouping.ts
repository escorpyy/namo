import type { LedgerReportGroupTotal, LedgerReportRow, LedgerReportSummary } from "../api";
import { minor, type Month } from "./ledgerReportLayout";

export type LedgerGroupFieldId =
  | "accountGroup"
  | "accountSubGroup"
  | "generalLedger"
  | "subLedger"
  | "agent"
  | "invoiceAgent"
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
  { id: "invoiceAgent", label: "Invoice Agent", summary: false },
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
  /** Server group keys from the root down to this node (server-grouped Lines view only). */
  path?: (string | null)[];
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
    case "invoiceAgent": return row ? pair(row.invoiceAgentId, row.invoiceAgentCode, row.invoiceAgentName) : unassigned;
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

/**
 * Lines view: the server already ordered the rows by group path (so a group is contiguous across pages) and gave every row its
 * group keys and labels. Keep that order; never re-sort here, or a group could jump around between pages.
 */
export function buildServerGroupTree(rows: LedgerReportRow[], fields: LedgerGroupFieldId[], monthLabel: (key: string) => string | undefined): LedgerGroupNode<LedgerReportRow>[] {
  if (!fields.length) return [];
  const build = (items: LedgerReportRow[], depth: number, path: (string | null)[]): LedgerGroupNode<LedgerReportRow>[] => {
    const buckets = new Map<string, { key: string | null; label: string; rows: LedgerReportRow[] }>();
    for (const r of items) {
      const key = r.groupKeys?.[depth] ?? null, id = key ?? "\u0000unassigned";
      let b = buckets.get(id);
      if (!b) {
        const label = key === null ? "Unassigned" : fields[depth] === "month" ? monthLabel(key) ?? key : r.groupLabels?.[depth] ?? key;
        b = { key, label, rows: [] };
        buckets.set(id, b);
      }
      b.rows.push(r);
    }
    return [...buckets.values()].map((b) => {
      const here = [...path, b.key];
      return { field: fields[depth], label: b.label, depth, rows: b.rows, path: here, children: depth + 1 < fields.length ? build(b.rows, depth + 1, here) : [] };
    });
  };
  return build(rows, 0, []);
}

/** Exact debit, credit and line count of a node over the whole report: the sum of every server total at or below its path. Null when the server sent none. */
export function groupTotalOf(node: LedgerGroupNode<LedgerReportRow>, totals: LedgerReportGroupTotal[] | undefined): { debit: bigint; credit: bigint; count: number } | null {
  if (!totals || !node.path) return null;
  const path = node.path;
  const hit = totals.filter((t) => path.every((k, i) => t.keys[i] === k));
  if (!hit.length) return null;
  return hit.reduce((t, g) => ({ debit: t.debit + minor(g.debit), credit: t.credit + minor(g.credit), count: t.count + g.count }), { debit: 0n, credit: 0n, count: 0 });
}
