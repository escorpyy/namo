import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { updatedAt } from "./_helpers";
import { company, user } from "./core";

// ============================================================
// CODE NUMBERING RULES
//
// How the code of each master is suggested (shared/codeRules.ts holds the rule language and the list of masters). One row per
// company and master; a master with no row uses its built-in default, so a new company works without any setup.
//   mode      MANUAL      the user always types the code
//             SUGGESTED   the form proposes the next code from the template; the user can accept or overtype it
//   template  e.g. "{PARENT}{SEQ:3}" (the parent's code and a 3-digit running number) or "{NAME2}{TYPE}{SEQ:3}"
// Only the suggestion follows the rule. A typed code is never rewritten, and the codes already saved stay as they are.
// ============================================================

export const codeRule = pgTable(
  "CodeRule",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    masterKey: varchar({ length: 40 }).notNull(),
    mode: varchar({ length: 10 }).notNull(),
    template: varchar({ length: 60 }).notNull(),
    updatedAt: updatedAt(),
    updatedBy: integer().references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("CodeRule_companyId_masterKey_key").on(t.companyId, t.masterKey),
    check("CodeRule_mode_check", sql`${t.mode} IN ('MANUAL', 'SUGGESTED')`),
  ],
);
