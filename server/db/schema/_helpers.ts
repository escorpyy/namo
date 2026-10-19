import { numeric, timestamp } from "drizzle-orm/pg-core";

// Prisma `DateTime @default(now())` -> timestamp(3) NOT NULL DEFAULT now()
export const createdAt = () =>
  timestamp({ precision: 3 }).notNull().defaultNow();

// Prisma `@updatedAt` has no DB default; the client sets it on write.
// $onUpdate does the same in Drizzle (also fires on insert when no default).
export const updatedAt = () =>
  timestamp({ precision: 3 })
    .notNull()
    .$onUpdate(() => new Date());

// Prisma `Decimal @db.Decimal(18, 6)` -> numeric(18, 6).
// NOTE: Drizzle returns numeric as a string (not a Decimal object) to avoid
// precision loss. Use a decimal library (decimal.js / big.js) for arithmetic.
export const money = () => numeric({ precision: 18, scale: 6 });
