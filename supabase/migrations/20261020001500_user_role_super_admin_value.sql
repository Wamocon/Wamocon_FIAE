-- Package 2.5 (part 7): new user role SUPER_ADMIN (E2), enum value only.
--
-- The value is added in its own file because a new enum value cannot be used
-- in the transaction that adds it. Nothing in this file uses it; the backfill
-- of the platform owner admins is the next file (20261020001600).
--
-- Adding the value is harmless for the running app: no profile has the role
-- yet. ADMIN in customer organizations and TEMP_ADMIN stay as they are.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter type public.user_role add value if not exists 'SUPER_ADMIN';
