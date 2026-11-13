import { boolean, index, integer, pgTable, serial, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { createdAt, updatedAt } from "./_helpers";
import { company } from "./core";

// ============================================================
// NARRATION MASTER
//
// Ready-made narration / remarks texts a company reuses on its vouchers and purchase documents ("Being cash deposited in bank",
// "Payment of electricity bill" ...). Screens offer the list from a narration or remarks field on the Down arrow; picking a row copies
// its text into the field. Nothing refers to a narration by id, so the text on a saved voucher never changes when the master does.
// 500 characters is the longest narration a voucher line takes (MAX_NARRATION), so every entry fits every field.
// ============================================================

export const narration = pgTable(
  "Narration",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    narration: varchar({ length: 500 }).notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Narration_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("Narration_companyId_narration_key").on(t.companyId, t.narration),
    index("Narration_companyId_idx").on(t.companyId),
  ],
);
