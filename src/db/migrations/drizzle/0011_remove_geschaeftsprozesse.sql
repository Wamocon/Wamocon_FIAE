-- Remove geschaeftsprozesse related tables (gesetzesprozesse feature deprecated)
DROP TABLE IF EXISTS "trainee_geschaeftsprozesse_overrides" CASCADE;
DROP TABLE IF EXISTS "geschaeftsprozesse_submission_links" CASCADE;
DROP TABLE IF EXISTS "geschaeftsprozesse_submissions" CASCADE;
DROP TABLE IF EXISTS "geschaeftsprozesse" CASCADE;
