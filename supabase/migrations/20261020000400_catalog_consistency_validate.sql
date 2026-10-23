-- Package 2.2 (part 2): validate the composite catalog foreign keys.
--
-- The keys were created NOT VALID in 20261020000300_catalog_consistency_keys.sql.
-- VALIDATE CONSTRAINT scans the existing rows with a weaker lock
-- (SHARE UPDATE EXCLUSIVE) that does not block reads or writes. Validating in
-- its own file keeps the exclusive locks of the previous file short.
-- If a row violates a key this file fails and nothing is changed; the keys
-- stay enforced for new rows either way.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.enablers
  validate constraint enablers_course_catalog_fk;

alter table public.use_cases
  validate constraint use_cases_course_catalog_fk;

alter table public.training_catalog_content_mappings
  validate constraint training_catalog_content_mappings_learning_field_catalog_fk;

alter table public.training_catalog_content_mappings
  validate constraint training_catalog_content_mappings_enabler_catalog_fk;

alter table public.training_catalog_content_mappings
  validate constraint training_catalog_content_mappings_use_case_catalog_fk;
