-- =============================================================================
-- Preview setup, step 6 (optional, after 05): copy the training content of
-- Production into the Preview
-- =============================================================================
-- WHO/WHEN: the project owner, BY HAND, in the Supabase SQL editor, signed in
--           as role postgres. Not run by any workflow. Run it
--             - once after the Preview was migrated up to the catalog series and
--               the demo bootstrap (05) created the platform administrator,
--             - again after every "Preview Reset" (a reset leaves public_preview
--               without content).
-- WHY:      public_preview has no rows after a reset, so there are no courses,
--           enablers, use cases or quizzes to try the app with.
-- EFFECT:   inside ONE transaction, WRITES ONLY in the schema public_preview and
--           only READS the schema public (Production is never changed):
--             courses, enablers, use_cases, content_documents (metadata only),
--             quizzes, enabler_quizzes, enabler_quiz_links, questions, options
--             and the 12 learning fields of the apprenticeship (as learning
--             fields of the catalog FIAE, with the rules of migration
--             20261024000500). Rows keep their ids, so all references hold.
--           The columns are those of the allowlist supabase/content-tables.json,
--           plus the id. The creator of a course or quiz is set to the platform
--           administrator named below, the organization and the uploader of a
--           document are left empty. Only documents without an organization or of
--           the platform owner are copied (documents of a customer organization
--           are left out and counted in the report, they would become visible to
--           everybody here). NO user data is copied: no profiles, no
--           organizations, no enrollments, submissions, progress, reports,
--           evaluations, certificates, notifications and no HAI chats or
--           embeddings. Files in the storage buckets are not copied (the
--           buckets are shared, the document rows point to the same files).
-- MODES:    v_dry_run = true (the default) performs everything and then rolls it
--           back with an error that shows the counts per table, nothing is
--           changed. Set it to false to really copy.
-- SNAPSHOT: the transaction runs with isolation level repeatable read, so all
--           reads of public see one state even if Production changes meanwhile.
-- IDEMPOTENT: a second run inserts nothing new (rows are matched by id or by their key). It is a
--           seed, not a synchronisation: a row that changed in Production later
--           is not updated here.
-- BOUNDARY: it only runs while Production does NOT have the catalog model yet
--           (no table public.training_catalogs). After the rollout use the
--           workflow "Content Sync" (direction production-to-preview), see
--           docs/release-prozess.md.
-- UNDO:     not needed (additive). To start from zero use the workflow
--           "Preview Reset" (it deletes ALL Preview data, Production stays
--           untouched).
-- =============================================================================

begin isolation level repeatable read;
set local lock_timeout = '10s';
set local statement_timeout = '180s';

-- Result of a real run, shown by the last statement (a NOTICE is not shown by
-- every client). Lives in the session only.
drop table if exists pg_temp.content_copy_report;
create temp table content_copy_report (
  sort_order integer not null,
  item text not null,
  source bigint,
  before_run bigint,
  inserted bigint,
  after_run bigint
);

do $copy$
declare
  -- 1. THE ONLY PART TO EDIT
  --    v_dry_run: true = rehearsal (nothing changes), false = really copy
  --    v_owner_email: e-mail address of the platform administrator in the Preview
  --    (the profile must exist there, replace the whole text between the quotes,
  --    including the angle brackets)
  v_dry_run boolean := true;
  v_owner_email text := '<E-MAIL-DES-SUPERADMIN-EINTRAGEN>';

  -- 2. Working variables
  v_table text;
  v_owner_id uuid;
  v_fiae_id uuid;
  v_report jsonb := '{}'::jsonb;
  v_src bigint;
  v_before bigint;
  v_ins bigint;
  v_after bigint;
  v_left_out bigint;
  v_i integer := 0;
  v_item record;
begin
  -- A. Preconditions. Nothing is written before all of them hold.
  if not exists (select 1 from pg_namespace n where n.nspname = 'public_preview') then
    raise exception 'Das Schema public_preview existiert nicht. Dieses Skript läuft nur gegen die Preview. Es wurde nichts geändert.';
  end if;

  if to_regclass('public.training_catalogs') is not null then
    raise exception 'Production hat das Katalogmodell schon (Tabelle public.training_catalogs). Dieses Skript ist nur die Übergangslösung bis zum Rollout. Danach den Workflow "Content Sync" mit der Richtung production-to-preview benutzen. Es wurde nichts geändert.';
  end if;

  foreach v_table in array array[
    'courses', 'enablers', 'use_cases', 'content_documents', 'quizzes',
    'enabler_quizzes', 'enabler_quiz_links', 'questions', 'options'
  ] loop
    if to_regclass('public.' || v_table) is null or to_regclass('public_preview.' || v_table) is null then
      raise exception 'Die Tabelle % fehlt in public oder in public_preview. Die Preview ist nicht bis zur Katalog-Reihe migriert oder die Struktur weicht ab. Es wurde nichts geändert.', v_table;
    end if;
  end loop;

  foreach v_table in array array['lernfelder', 'lernfeld_mappings'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'Die Tabelle public.% fehlt. Es wurde nichts geändert.', v_table;
    end if;
  end loop;
  if to_regclass('public_preview.training_catalog_learning_fields') is null
     or to_regprocedure('public_preview.lernfeld_label_training_year(text)') is null then
    raise exception 'Die Lernfeld-Struktur fehlt in public_preview (Migration 20261024000500 ist dort nicht angewendet). Es wurde nichts geändert.';
  end if;

  -- B. The platform administrator of the Preview (creator of courses and quizzes)
  if v_owner_email is null or lower(btrim(v_owner_email)) !~ '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$' then
    raise exception 'Platzhalter nicht ersetzt: v_owner_email enthält keine gültige E-Mail-Adresse (Wert: "%"). Die Adresse oben im Skript eintragen und alles erneut ausführen. Es wurde nichts geändert.', v_owner_email;
  end if;
  select p.id into v_owner_id
    from public_preview.profiles p
   where lower(p.email) = lower(btrim(v_owner_email))
   order by p.created_at, p.id
   limit 1;
  if v_owner_id is null then
    raise exception 'In public_preview gibt es kein Profil für %. Erst einmal in der Preview anmelden und das Demo-Bootstrap (05) ausführen, dann dieses Skript erneut starten. Es wurde nichts geändert.', v_owner_email;
  end if;

  select c.id into v_fiae_id from public_preview.training_catalogs c where c.code = 'FIAE';
  if v_fiae_id is null then
    raise exception 'Der Katalog FIAE fehlt in public_preview.training_catalogs. Die Katalog-Migration ist unvollständig angewendet. Es wurde nichts geändert.';
  end if;

  -- C. Learning fields: the guards of migration 20261024000500 (extra columns must
  --    be empty, is_common must be true), valid labels, no duplicates. to_jsonb
  --    keeps the check working whether or not the extra columns exist.
  if exists (
    select 1 from public.lernfelder l
     where to_jsonb(l) ->> 'code' is not null
        or to_jsonb(l) ->> 'training_year' is not null
        or to_jsonb(l) ->> 'hours_budget' is not null
        or to_jsonb(l) ->> 'order_index' is not null
        or to_jsonb(l) ->> 'is_common' = 'false'
  ) then
    raise exception 'public.lernfelder trägt Werte in code, training_year, hours_budget oder order_index oder hat is_common = false. Die Regeln der Migration 20261024000500 würden sie verwerfen. Bitte prüfen. Es wurde nichts geändert.';
  end if;
  if exists (select 1 from public.lernfelder l where btrim(l.label) = '')
     or exists (select 1 from public.lernfelder l group by btrim(l.label) having count(*) > 1) then
    raise exception 'public.lernfelder hat leere oder doppelte Bezeichnungen. Die Regeln der Migration 20261024000500 (Zusatz # 2) sind hier nicht nachgebaut. Es wurde nichts geändert.';
  end if;

  -- D. The content, parents first
  -- courses
  select count(*) into v_src from public.courses;
  select count(*) into v_before from public_preview.courses;
  insert into public_preview.courses (id, title, description, year, chapter, exam_part, lernfelder, created_by_id, is_active, is_published, created_at, updated_at)
  select s.id, s.title, s.description, s.year, s.chapter, s.exam_part, s.lernfelder, v_owner_id, s.is_active, s.is_published, s.created_at, s.updated_at
    from public.courses s
  on conflict (id) do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.courses;
  v_report := v_report || jsonb_build_object('courses', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- enablers
  select count(*) into v_src from public.enablers;
  select count(*) into v_before from public_preview.enablers;
  insert into public_preview.enablers (id, course_id, title, order_index, description_text, ppt_url, video_url, scenario_pdf_url, duration_value, duration_unit, is_active, activated_at, created_at, updated_at)
  select s.id, s.course_id, s.title, s.order_index, s.description_text, s.ppt_url, s.video_url, s.scenario_pdf_url, s.duration_value, s.duration_unit::text::public_preview.duration_unit, s.is_active, s.activated_at, s.created_at, s.updated_at
    from public.enablers s
  on conflict (id) do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.enablers;
  v_report := v_report || jsonb_build_object('enablers', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- use_cases
  select count(*) into v_src from public.use_cases;
  select count(*) into v_before from public_preview.use_cases;
  insert into public_preview.use_cases (id, course_id, title, description_text, order_index, duration_value, duration_unit, is_active, activated_at, year, training_stage, lernfelder, created_at, updated_at)
  select s.id, s.course_id, s.title, s.description_text, s.order_index, s.duration_value, s.duration_unit::text::public_preview.duration_unit, s.is_active, s.activated_at, s.year, s.training_stage, s.lernfelder, s.created_at, s.updated_at
    from public.use_cases s
  on conflict (id) do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.use_cases;
  v_report := v_report || jsonb_build_object('use_cases', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- content_documents
  select count(*) into v_src from public.content_documents;
  select count(*) into v_before from public_preview.content_documents;
  insert into public_preview.content_documents (id, enabler_id, use_case_id, course_id, organization_id, title, description, document_type, visibility, file_name, file_size, mime_type, storage_url, storage_path, page_count, order_index, uploaded_by_id, created_at, updated_at)
  select s.id, s.enabler_id, s.use_case_id, s.course_id, null, s.title, s.description, s.document_type::text::public_preview.content_document_type, s.visibility::text::public_preview.document_visibility, s.file_name, s.file_size, s.mime_type, s.storage_url, s.storage_path, s.page_count, s.order_index, null, s.created_at, s.updated_at
    from public.content_documents s
   where s.organization_id is null
      or exists (
        select 1 from public.organizations o
         where o.id = s.organization_id and o.is_platform_owner
      )
  on conflict (id) do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.content_documents;
  select count(*) into v_left_out
    from public.content_documents s
   where s.organization_id is not null
     and not exists (
       select 1 from public.organizations o
        where o.id = s.organization_id and o.is_platform_owner
     );
  if v_left_out > 0 then
    raise notice 'Hinweis: % Dokumentzeile(n) einer Kundenorganisation wurden nicht kopiert.', v_left_out;
  end if;
  v_report := v_report || jsonb_build_object('content_documents', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after, 'nicht kopiert (Kundenorganisation)', v_left_out));

  -- quizzes
  select count(*) into v_src from public.quizzes;
  select count(*) into v_before from public_preview.quizzes;
  insert into public_preview.quizzes (id, title, quiz_type, created_by_id, is_active, created_at, updated_at)
  select s.id, s.title, s.quiz_type::text::public_preview.quiz_type, v_owner_id, s.is_active, s.created_at, s.updated_at
    from public.quizzes s
  on conflict (id) do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.quizzes;
  v_report := v_report || jsonb_build_object('quizzes', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- enabler_quizzes
  select count(*) into v_src from public.enabler_quizzes;
  select count(*) into v_before from public_preview.enabler_quizzes;
  insert into public_preview.enabler_quizzes (enabler_id, quiz_id)
  select s.enabler_id, s.quiz_id
    from public.enabler_quizzes s
  on conflict do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.enabler_quizzes;
  v_report := v_report || jsonb_build_object('enabler_quizzes', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- enabler_quiz_links
  select count(*) into v_src from public.enabler_quiz_links;
  select count(*) into v_before from public_preview.enabler_quiz_links;
  insert into public_preview.enabler_quiz_links (id, enabler_id, quiz_id, difficulty)
  select s.id, s.enabler_id, s.quiz_id, s.difficulty::text::public_preview.quiz_difficulty
    from public.enabler_quiz_links s
  on conflict do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.enabler_quiz_links;
  v_report := v_report || jsonb_build_object('enabler_quiz_links', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- questions
  select count(*) into v_src from public.questions;
  select count(*) into v_before from public_preview.questions;
  insert into public_preview.questions (id, quiz_id, question_text, question_type, expected_answer, order_index)
  select s.id, s.quiz_id, s.question_text, s.question_type::text::public_preview.question_type, s.expected_answer, s.order_index
    from public.questions s
  on conflict (id) do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.questions;
  v_report := v_report || jsonb_build_object('questions', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- options
  select count(*) into v_src from public.options;
  select count(*) into v_before from public_preview.options;
  insert into public_preview.options (id, question_id, option_text, is_correct, explanation)
  select s.id, s.question_id, s.option_text, s.is_correct, s.explanation
    from public.options s
  on conflict (id) do nothing;
  get diagnostics v_ins = row_count;
  select count(*) into v_after from public_preview.options;
  v_report := v_report || jsonb_build_object('options', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- E. Learning fields (the legacy table of Production becomes the catalog model:
  --    code = label, year from the number, position by number, ids kept)
  select count(*) into v_src from public.lernfelder;
  select count(*) into v_before
    from public_preview.training_catalog_learning_fields f
   where f.training_catalog_id = v_fiae_id;
  if v_before = 0 then
    insert into public_preview.training_catalog_learning_fields (
      id, training_catalog_id, code, title, description, training_year,
      hours_budget, order_index, created_at, updated_at
    )
    select l.id, v_fiae_id, btrim(l.label), l.title, l.description,
           public_preview.lernfeld_label_training_year(btrim(l.label)), null,
           row_number() over (
             order by nullif(substring(l.label from '(?i)^\s*LF[\s._-]*([0-9]{1,3})'), '')::integer nulls last,
                      btrim(l.label), l.created_at, l.id
           ),
           l.created_at, l.updated_at
      from public.lernfelder l
    on conflict do nothing;
    get diagnostics v_ins = row_count;
  else
    v_ins := 0;
    raise notice 'Hinweis: Der Katalog FIAE hat in public_preview schon % Lernfeld(er), sie wurden nicht erneut kopiert (ein neues Lernfeld wird hier nicht nachgezogen).', v_before;
  end if;
  select count(*) into v_after
    from public_preview.training_catalog_learning_fields f
   where f.training_catalog_id = v_fiae_id;
  v_report := v_report || jsonb_build_object('lernfelder (als Lernfelder des Katalogs FIAE)', jsonb_build_object('Quelle', v_src, 'Ziel vorher', v_before, 'eingefügt', v_ins, 'Ziel nachher', v_after));

  -- F. Result
  if v_dry_run then
    raise exception E'PROBELAUF, es wurde nichts geändert (alles zurückgerollt). Das wäre das Ergebnis:\n%\nZum echten Kopieren oben v_dry_run auf false setzen.', jsonb_pretty(v_report);
  end if;

  for v_item in select key, value from jsonb_each(v_report) loop
    v_i := v_i + 1;
    insert into content_copy_report (sort_order, item, source, before_run, inserted, after_run)
    values (
      v_i, v_item.key,
      (v_item.value ->> 'Quelle')::bigint, (v_item.value ->> 'Ziel vorher')::bigint,
      (v_item.value ->> 'eingefügt')::bigint, (v_item.value ->> 'Ziel nachher')::bigint
    );
  end loop;
  raise notice 'Fertig: der Inhalt von public wurde nach public_preview kopiert (Ergebnistabelle unten).';
end
$copy$;

commit;

select item as "Tabelle", source as "Quelle (public)", before_run as "Ziel vorher",
       inserted as "eingefügt", after_run as "Ziel nachher"
  from pg_temp.content_copy_report
 order by sort_order;
