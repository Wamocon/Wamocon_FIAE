-- Security hardening 2 of 3: close the open policies on the HAI tables.
--
-- Measured read-only on production on 2026-10-23:
--   hai_embeddings    two SELECT policies for the role public with USING (true).
--                     The chunks (including trainer solutions, see
--                     ingestUseCase.ts) are readable with the public key.
--   hai_reindex_jobs  a policy named "Service role full access" that applies to
--                     the role public with USING (true) for ALL commands, so any
--                     anonymous visitor may read and change reindex jobs.
--
-- The app reads and writes these tables through Drizzle as the role postgres,
-- which bypasses row level security. The remaining policies stay:
--   hai_embeddings_service_role, he_manage_platform_owner, hrj_manage_platform_owner.
--
-- Undo (only if something breaks):
--   create policy hai_embeddings_read_all on public.hai_embeddings for select to public using (true);
--   create policy he_select_all on public.hai_embeddings for select to public using (true);
--   create policy hrj_select_all on public.hai_reindex_jobs for select to public using (true);
--   create policy "Service role full access on hai_reindex_jobs" on public.hai_reindex_jobs for all to public using (true);

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.hai_embeddings') is not null then
    alter table public.hai_embeddings enable row level security;
    drop policy if exists hai_embeddings_read_all on public.hai_embeddings;
    drop policy if exists he_select_all on public.hai_embeddings;
  end if;

  if to_regclass('public.hai_reindex_jobs') is not null then
    alter table public.hai_reindex_jobs enable row level security;
    drop policy if exists "Service role full access on hai_reindex_jobs" on public.hai_reindex_jobs;
    drop policy if exists hrj_select_all on public.hai_reindex_jobs;
  end if;
end $$;
