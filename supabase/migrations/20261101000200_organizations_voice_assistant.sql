-- Voice assistant (day companion, WMCNL-2907): switch per organization.
--
-- Why: the voice path of the HAI (speech in the browser, answer read aloud) must be
-- switchable per organization (acceptance criterion of WMCNL-2907). A new organization and
-- every existing one start with the voice assistant OFF; an administrator of the platform
-- turns it on for an organization after the data protection notice was handled.
--
-- What: one column, default false, not null. No row is rewritten in a way that changes
-- behavior (the default applies to the existing rows). The column carries the table rights
-- of organizations, no policy changes. The chat route (src/app/api/hai/chat/route.ts)
-- refuses a spoken question of an organization where the column is false.
--
-- Rollback:
--   alter table public.organizations drop column if exists voice_assistant_enabled;

alter table public.organizations
  add column if not exists voice_assistant_enabled boolean not null default false;
