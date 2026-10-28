import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { updatedAt } from "./_helpers";
import { company, user } from "./core";

// ============================================================
// COMPANY LOCK (closing) DATE  (ERP-025, decision S9 / S12)
//
// One optional row per company. While lockDate is set, a document dated ON OR BEFORE it cannot be created, edited or deleted
// (vouchers and their lines, purchase bills and their lines / import detail / terms / allocations). The database enforces it
// (migration 0011, trigger "Audit_lock"); the purchase service pre-checks it for a clear message.
//
// Kept in its own table, not as columns on Company, on purpose: the generic master engine lists and saves Company rows, and the
// password hash must never travel through it.
//
// passwordHash is a scrypt hash (server/services/periodLock.ts), never the password. A lock date requires a password, so the lock
// cannot simply be lifted by anyone: moving the date earlier, clearing it, or changing the password needs the current password
// (the "override"), a reason, and is written to the audit log (without the hash).
// ============================================================

export const companyLock = pgTable(
  "CompanyLock",
  {
    // A surrogate id like every other table (the company registry, namo.company_violations() and the audit trail all address rows
    // by "id"); one row per company is the unique index below.
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    lockDate: date({ mode: "date" }),
    passwordHash: text(),
    updatedAt: updatedAt(),
    updatedBy: integer().references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("CompanyLock_companyId_key").on(t.companyId),
    check(
      "CompanyLock_date_needs_password_check",
      sql`${t.lockDate} IS NULL OR ${t.passwordHash} IS NOT NULL`,
    ),
  ],
);
