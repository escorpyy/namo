import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { createdAt, money, updatedAt } from "./_helpers";
import { company } from "./core";
import { generalLedger } from "./accounting";

// ============================================================
// AREA & SUB AREA
// Area is the top-level region; SubArea is what GeneralLedger/Party tag
// against — same Group/SubGroup pattern as the Chart of Accounts.
// ============================================================

export const area = pgTable(
  "Area",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 50 }).notNull(),
    shortName: varchar({ length: 10 }).notNull(),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Area_companyId_code_key").on(t.companyId, t.code),
    uniqueIndex("Area_companyId_name_key").on(t.companyId, t.name),
    uniqueIndex("Area_companyId_shortName_key").on(t.companyId, t.shortName),
    index("Area_companyId_idx").on(t.companyId),
  ],
);

export const subArea = pgTable(
  "SubArea",
  {
    id: serial().primaryKey(),
    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 50 }).notNull(),
    shortName: varchar({ length: 10 }).notNull(),
    areaId: integer()
      .notNull()
      .references(() => area.id, { onDelete: "restrict" }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("SubArea_areaId_code_key").on(t.areaId, t.code),
    uniqueIndex("SubArea_areaId_name_key").on(t.areaId, t.name),
    uniqueIndex("SubArea_areaId_shortName_key").on(t.areaId, t.shortName),
  ],
);

// Agent: independent lookup (DRAFT in the original schema)
export const agent = pgTable(
  "Agent",
  {
    id: serial().primaryKey(),
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),

    code: varchar({ length: 10 }).notNull(),
    name: varchar({ length: 100 }).notNull(),
    phone: varchar({ length: 25 }),
    isActive: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Agent_companyId_code_key").on(t.companyId, t.code),
    index("Agent_companyId_idx").on(t.companyId),
  ],
);

// ============================================================
// PARTY (DRAFT in the original schema)
// ============================================================

export const party = pgTable(
  "Party",
  {
    id: serial().primaryKey(),
    // Denormalized from generalLedger.companyId — a Party is company-wide.
    // A trigger keeps this in sync with generalLedger.companyId.
    companyId: integer()
      .notNull()
      .references(() => company.id, { onDelete: "restrict" }),
    generalLedgerId: integer()
      .notNull()
      .references(() => generalLedger.id, { onDelete: "cascade" }),

    address: varchar({ length: 255 }),
    city: varchar({ length: 50 }),
    state: varchar({ length: 50 }),
    country: varchar({ length: 50 }),
    phone: varchar({ length: 25 }),
    mobile: varchar({ length: 15 }),
    email: varchar({ length: 255 }),
    contactPerson: varchar({ length: 50 }),

    panNo: varchar({ length: 25 }), // unique per company, not globally
    isVatRegistered: boolean().notNull().default(false),

    bankReconcileDate: timestamp({ precision: 3 }),

    subAreaId: integer().references(() => subArea.id, { onDelete: "set null" }),
    agentId: integer().references(() => agent.id, { onDelete: "set null" }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("Party_generalLedgerId_key").on(t.generalLedgerId),
    uniqueIndex("Party_companyId_panNo_key").on(t.companyId, t.panNo),
    index("Party_companyId_idx").on(t.companyId),
    index("Party_panNo_idx").on(t.panNo),
    index("Party_subAreaId_idx").on(t.subAreaId),
    index("Party_agentId_idx").on(t.agentId),
  ],
);

export const customerDetail = pgTable(
  "CustomerDetail",
  {
    id: serial().primaryKey(),
    partyId: integer()
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),

    creditLimit: money(),
    creditDays: integer(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("CustomerDetail_partyId_key").on(t.partyId)],
);

export const vendorDetail = pgTable(
  "VendorDetail",
  {
    id: serial().primaryKey(),
    partyId: integer()
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),

    paymentTermDays: integer(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("VendorDetail_partyId_key").on(t.partyId)],
);
