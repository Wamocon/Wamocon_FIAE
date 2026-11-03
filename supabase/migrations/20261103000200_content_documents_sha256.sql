-- Checksum of the stored file of a content document (content_documents.content_sha256).
--
-- Why: the content check (Inhaltsprüfung, page Inhaltsstatistik) can only say "same size and
-- same page count" about two documents in different enablers (rule document.copy.suspected).
-- That is a hint, not a proof. With the SHA-256 of the file the check can name byte-identical
-- documents (rule document.copy.identical). The script scripts/content/hash-documents.ts
-- fills the column from the stored files and, while it reads them, lists the documents whose
-- file is missing in the storage.
--
-- What it does, in this order:
--   1. stops with a clear message if the table or a column it relies on is missing. Nothing
--      is changed in that case
--   2. adds content_documents.content_sha256 (text, nullable, no default). A document
--      without a value simply has no checksum yet, nothing reads the column as required
--   3. checks the result: the column exists, is text, is nullable and has no default
--
-- What it does not do: no value is written (the script does that, in blocks, from the stored
-- files), no index (the check reads the documents of one catalog in one statement and groups
-- them in memory, no lookup by checksum exists), no constraint on the format (the script
-- writes 64 lower case hex characters only), no other table is touched, no row is changed or
-- deleted.
--
-- Locks: ADD COLUMN without a default is a catalog change that takes a short exclusive lock
-- on content_documents and rewrites no row. The lock timeout below stops the file instead of
-- waiting behind a long transaction.
--
-- Safe to run twice (add column if not exists, the same check of the result).
-- Sorting: behind 20261103000100 and behind GATED_TO (20261030000300), so it needs no extra
-- approval of the rollout gate. Until then the gate (scripts/db/rollout-gate.mjs, gated from
-- 20261024000100) holds it back together with the series. Production is not migrated by this
-- change.
--
-- Undo (the documents keep every other column, the checks fall back to the hint on size and
-- page count):
--   alter table public.content_documents drop column if exists content_sha256;
--   The app of this change reads the column, so first deploy the previous app version.

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. Pre check ---------------------------------------------------------------------

do $$
begin
  if to_regclass('public.content_documents') is null then
    raise exception
      'content documents sha256: public.content_documents is missing. Nothing was changed.';
  end if;
  if not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.content_documents'::regclass
       and a.attname = 'storage_url'
       and not a.attisdropped
  ) then
    raise exception
      'content documents sha256: public.content_documents.storage_url is missing. Nothing was changed.';
  end if;
end $$;

-- 2. The column ---------------------------------------------------------------------

alter table public.content_documents
  add column if not exists content_sha256 text;

-- 3. Check of the result ------------------------------------------------------------

do $$
declare
  col record;
begin
  select a.atttypid::regtype::text as type_name,
         a.attnotnull,
         a.atthasdef
    into col
    from pg_attribute a
   where a.attrelid = 'public.content_documents'::regclass
     and a.attname = 'content_sha256'
     and not a.attisdropped;

  if not found then
    raise exception
      'content documents sha256: the column content_sha256 was not created.';
  end if;
  if col.type_name <> 'text' then
    raise exception
      'content documents sha256: content_sha256 has the type %, expected text.', col.type_name;
  end if;
  if col.attnotnull or col.atthasdef then
    raise exception
      'content documents sha256: content_sha256 must be nullable without a default.';
  end if;
end $$;
