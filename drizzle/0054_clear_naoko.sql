-- Snapshot-only migration: brings the drizzle snapshot chain up to date with the hand-written migrations 0046, 0048-0050, 0052 and 0053.
-- Every schema change it would describe has already been applied by those files, so this one changes nothing.
SELECT 1;
