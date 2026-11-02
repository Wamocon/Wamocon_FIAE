-- hai_settings.updated_by becomes a plain id: the foreign key to profiles is dropped.
--
-- Why: updated_by is an audit note (the platform admin who saved a setting last). With the
-- foreign key every table that points at profiles has to be known to the merge of two profiles
-- (src/lib/profile-identity.ts, guarded by tests/unit/lib/profile-identity.test.ts). That would put
-- an UPDATE on hai_settings into the sign-in of a pre-created account, which fails everywhere
-- where this table does not exist yet (Production gets the migrations with the release). A note
-- of who saved last does not justify that, and it must not hold up the deletion of a profile
-- either. 20261102000100 stays as it was applied (the Preview runner refuses a changed file).
--
-- What: drops the constraint hai_settings_updated_by_fkey. The column and its values stay.
-- Nothing else changes. Safe to run twice (no error if the constraint is already gone).
--
-- Undo (only if the foreign key is wanted back, together with the entry in the merge):
--   alter table public.hai_settings
--     add constraint hai_settings_updated_by_fkey
--     foreign key (updated_by) references public.profiles (id) on delete set null;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.hai_settings
  drop constraint if exists hai_settings_updated_by_fkey;
