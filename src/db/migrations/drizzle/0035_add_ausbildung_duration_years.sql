ALTER TABLE "profiles"
  ADD COLUMN IF NOT EXISTS "ausbildung_duration_years" integer NOT NULL DEFAULT 3;
--> statement-breakpoint
UPDATE "profiles"
SET "ausbildung_duration_years" = 3
WHERE "ausbildung_duration_years" NOT IN (2, 3)
   OR "ausbildung_duration_years" IS NULL;
--> statement-breakpoint
ALTER TABLE "profiles"
  DROP CONSTRAINT IF EXISTS "profiles_ausbildung_duration_years_check";
--> statement-breakpoint
ALTER TABLE "profiles"
  ADD CONSTRAINT "profiles_ausbildung_duration_years_check"
  CHECK ("ausbildung_duration_years" IN (2, 3));
