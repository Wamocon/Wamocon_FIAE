-- Structural fingerprint of the Preview schemas, one line per fact, sorted.
-- No row data, no timestamps, no oids: two databases (or two runs) with the same
-- structure, definitions and rights give the same lines. Used by the repeat
-- rebuild test (tests/scripts/db/preview-rebuild-db.test.mjs) and by hand:
--   psql -At -f tests/scripts/db/fixtures/schema-fingerprint.sql
select line from (
  -- relations (tables, views, materialized views, sequences, foreign tables, composite types)
  select 'REL ' || n.nspname || '.' || c.relname || ' kind=' || c.relkind::text
    || ' owner=' || c.relowner::regrole::text
    || ' rls=' || c.relrowsecurity || '/' || c.relforcerowsecurity
    || ' acl=' || coalesce(c.relacl::text, '')
    || ' options=' || coalesce(c.reloptions::text, '')
    || ' partkey=' || coalesce(pg_get_partkeydef(c.oid), '')
    || ' bound=' || coalesce(pg_get_expr(c.relpartbound, c.oid), '')
    || case when c.relkind in ('v', 'm') then ' def=' || md5(pg_get_viewdef(c.oid)) else '' end as line
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  union all
  -- columns with type, nullability, default and column rights
  select 'COL ' || n.nspname || '.' || c.relname || '.' || a.attname
    || ' type=' || format_type(a.atttypid, a.atttypmod)
    || ' notnull=' || a.attnotnull
    || ' identity=' || a.attidentity::text || ' generated=' || a.attgenerated::text
    || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    || ' acl=' || coalesce(a.attacl::text, '')
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'c') and a.attnum > 0 and not a.attisdropped
  union all
  -- sequence parameters
  select 'SEQ ' || n.nspname || '.' || c.relname || ' type=' || s.seqtypid::regtype::text
    || ' start=' || s.seqstart || ' inc=' || s.seqincrement || ' min=' || s.seqmin
    || ' max=' || s.seqmax || ' cache=' || s.seqcache || ' cycle=' || s.seqcycle
  from pg_sequence s
  join pg_class c on c.oid = s.seqrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
  union all
  -- indexes
  select 'IDX ' || schemaname || '.' || tablename || '.' || indexname || ' ' || indexdef
  from pg_indexes where schemaname in ('public_preview', 'preview_meta', 'preview_support')
  union all
  -- constraints
  select 'CON ' || n.nspname || '.' || c.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
  union all
  -- check constraints of domains
  select 'DOMCON ' || n.nspname || '.' || t.typname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
  from pg_constraint k
  join pg_type t on t.oid = k.contypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
  union all
  -- triggers
  select 'TRG ' || n.nspname || '.' || c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public_preview', 'preview_meta', 'preview_support')
  union all
  -- policies (also the Preview policies on the shared table storage.objects)
  select 'POL ' || n.nspname || '.' || c.relname || '.' || p.polname
    || ' cmd=' || p.polcmd::text
    || ' roles=' || coalesce((select string_agg(coalesce(r.rolname, 'public'), ',' order by coalesce(r.rolname, 'public'))
                              from unnest(p.polroles) u(oid) left join pg_roles r on r.oid = u.oid), '')
    || ' using=' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
    || ' check=' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
     or (n.nspname = 'storage' and c.relname = 'objects' and p.polname like '%\_preview')
  union all
  -- functions and procedures with owner, settings, rights and a hash of the full definition
  select 'FN ' || p.oid::regprocedure::text
    || ' kind=' || p.prokind::text || ' owner=' || p.proowner::regrole::text
    || ' secdef=' || p.prosecdef
    || ' config=' || coalesce(p.proconfig::text, '')
    || ' acl=' || coalesce(p.proacl::text, '')
    || ' def=' || md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support') and p.prokind in ('f', 'p')
  union all
  -- standalone types: enums with their labels, domains, ranges, composite types
  select 'TYP ' || n.nspname || '.' || t.typname || ' kind=' || t.typtype::text
    || ' owner=' || t.typowner::regrole::text
    || ' labels=' || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), '')
    || ' basetype=' || case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) else '' end
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
    and t.typtype in ('e', 'd', 'r', 'm', 'c') and t.typcategory <> 'A'
    and not exists (select 1 from pg_class c where c.reltype = t.oid and c.relkind <> 'c')
  union all
  -- schemas: owner and rights
  select 'NSP ' || n.nspname || ' owner=' || n.nspowner::regrole::text || ' acl=' || coalesce(n.nspacl::text, '')
  from pg_namespace n where n.nspname in ('public_preview', 'preview_meta', 'preview_support')
  union all
  -- default privileges
  select 'DEF ' || d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '-')
    || ' ' || d.defaclobjtype::text || ' ' || coalesce(d.defaclacl::text, '')
  from pg_default_acl d
  where d.defaclrole in (select oid from pg_roles where rolname in ('app_preview_migrator', 'app_preview'))
  union all
  -- realtime membership of the Preview tables
  select 'PUB ' || pubname || ' ' || schemaname || '.' || tablename
  from pg_publication_tables where schemaname in ('public_preview', 'preview_meta')
  union all
  -- migration history (version, name, checksum; not the time)
  select 'LEDGER ' || version || ' ' || name || ' ' || coalesce(checksum, '-')
  from preview_meta.schema_migrations
) f
order by line
