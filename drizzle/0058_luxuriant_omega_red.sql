ALTER TABLE "NumberSeries" ALTER COLUMN "mode" SET DEFAULT 'MANUAL';
UPDATE "NumberSeries" SET "mode" = 'MANUAL' WHERE "mode" <> 'MANUAL';
