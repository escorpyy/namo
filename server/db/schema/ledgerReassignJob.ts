import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers";
import { generalLedger } from "./accounting";
import { company, user } from "./core";

// ============================================================
// LEDGER REASSIGN JOB
//
// When the ledger of a master (a billing term, later a product) is changed and the person chooses to move the transactions already posted with the
// old ledger, the move runs in the background and is recorded here: what was changed, how far it is, and whether the person was told it finished.
// The move is safe to repeat: each document moves in its own transaction and is picked up again only while it still carries the old ledger, so a job
// interrupted by a restart simply continues.  What changed in each voucher is in the audit trail (AuditLog), not here.
// ============================================================
export const ledgerReassignJob = pgTable(
  "LedgerReassignJob",
  {
    id: serial().primaryKey(),
    companyId: integer().notNull().references(() => company.id, { onDelete: "restrict" }),
    kind: varchar({ length: 30 }).notNull(), // PURCHASE_TERM | SALES_TERM
    masterId: integer().notNull(),
    masterName: varchar({ length: 200 }).notNull(),
    fromLedgerId: integer().notNull().references(() => generalLedger.id, { onDelete: "restrict" }),
    toLedgerId: integer().notNull().references(() => generalLedger.id, { onDelete: "restrict" }),
    status: varchar({ length: 10 }).notNull().default("QUEUED"), // QUEUED | RUNNING | DONE | FAILED
    total: integer().notNull().default(0), // documents to move when the job was started
    processed: integer().notNull().default(0),
    skipped: integer().notNull().default(0), // documents whose voucher did not carry the old ledger (nothing to move)
    message: text(),
    createdBy: integer().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp({ precision: 3 }),
    finishedAt: timestamp({ precision: 3 }),
    seenAt: timestamp({ precision: 3 }), // the person has been told it finished
  },
  (t) => [
    index("LedgerReassignJob_companyId_idx").on(t.companyId),
    index("LedgerReassignJob_status_idx").on(t.status),
    check("LedgerReassignJob_status_check", sql`${t.status} IN ('QUEUED', 'RUNNING', 'DONE', 'FAILED')`),
    check("LedgerReassignJob_ledgers_check", sql`${t.fromLedgerId} <> ${t.toLedgerId}`),
  ],
);
