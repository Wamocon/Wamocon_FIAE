# Production Schema Migration Runbook

Use this runbook for the Supabase production schema migration. The migration is
schema-only and must not seed, delete, truncate, or rewrite production data,
except for setting `profiles.ausbildung_duration_years` to `3` where the new
column needs a safe default.

## Files

- Migration SQL:
  `supabase/migrations/202606260001_schema_only_ausbildung_duration.sql`
- Read-only verification SQL:
  `docs/production-schema-migration-verification.sql`

## Required Flow

1. Connect Supabase MCP to production.
2. Confirm the project ID/name in the MCP output before any write.
3. Run the read-only checks in
   `docs/production-schema-migration-verification.sql`.
4. Save the pre-migration row counts.
5. Apply only
   `supabase/migrations/202606260001_schema_only_ausbildung_duration.sql`
   through the Supabase MCP migration tool.
6. Run the same read-only verification SQL again.
7. Compare row counts. They must match, except that the verification should now
   show `profiles.ausbildung_duration_years` exists with default `3`, `NOT NULL`,
   and the `2` or `3` check constraint.
8. Deploy the app only after verification passes.

## Explicitly Forbidden

- `drizzle-kit push`
- `supabase db reset`
- Seed scripts
- Applying the full `src/db/migrations/drizzle` folder
- Seed/data-fix files such as
  `0036_fix_automation_use_case_planned_hours.sql`
- Any unrelated `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`

## Expected App Behavior After Deploy

- Existing trainees default to a `3` year study plan.
- Trainers can change a trainee between `2` and `3` years in the app.
- Trainer and trainee Ausbildungnachweise views load from the same production
  schema without crashing on missing duration data.
