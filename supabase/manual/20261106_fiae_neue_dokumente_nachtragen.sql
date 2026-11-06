-- =============================================================================
-- FIAE: 26 Dokumente neuer Enabler und Use Cases in Production wieder anlegen
-- =============================================================================
-- Ausführen: Supabase Dashboard, SQL Editor, Projekt FIAE-Production, ganzen Inhalt einfügen, Run.
-- EIN DO-Block (eine Anweisung): atomar, auch wenn der Editor Anweisungen einzeln ausführt.
-- Ein zweiter Lauf legt nichts an (die Dokumente existieren dann schon).
--
-- Warum: Der Inhaltsabgleich vom 06.11.2026 hat 1 Kurs, 3 Enabler und 3 Use Cases der neuen FIAE-Lieferung mit
-- NEUEN Ids in Production angelegt (die Preview hat dafür andere Ids). Das Bereinigungsskript
-- 20261106_fiae_dubletten_dokumente_entfernen.sql hat danach alle Dokumente ohne Preview-Id entfernt und dabei
-- auch die 26 Dokumente dieser neuen Elemente. Sie waren keine Dubletten. Siehe docs/release-lessons-2026-11.md.
--
-- Was es tut: Es legt die 26 Preview-Dokumente (mit ihrer Preview-Id) an den Production-Zwillingen der Eltern an
-- (Zuordnung über Kurstitel und Titel des Enablers beziehungsweise Use Cases). Benutzer und Organisation bleiben
-- leer, wie beim Inhaltsabgleich. Bricht ab, wenn die Zuordnung nicht eindeutig ist oder nicht genau 26 Zeilen
-- entstehen.
-- =============================================================================
do $fiae$
declare
  n_fe int; n_fu int; n_ins int; n_after int;
begin
  drop table if exists fiae_fe; drop table if exists fiae_fu; drop table if exists fiae_pe; drop table if exists fiae_pu;

  create temp table fiae_fe as
  select e.id pid, e.title, c.title ctitle from public_preview.enablers e
  join public_preview.courses c on c.id = e.course_id join public_preview.training_catalogs t on t.id = c.training_catalog_id
  where upper(t.code) = 'FIAE' and e.id not in (select id from public.enablers);

  create temp table fiae_fu as
  select u.id pid, u.title, c.title ctitle from public_preview.use_cases u
  join public_preview.courses c on c.id = u.course_id join public_preview.training_catalogs t on t.id = c.training_catalog_id
  where upper(t.code) = 'FIAE' and u.id not in (select id from public.use_cases);

  create temp table fiae_pe as
  select e.id, e.title, c.title ctitle from public.enablers e
  join public.courses c on c.id = e.course_id join public.training_catalogs t on t.id = c.training_catalog_id
  where upper(t.code) = 'FIAE' and e.id not in (select id from public_preview.enablers);

  create temp table fiae_pu as
  select u.id, u.title, c.title ctitle from public.use_cases u
  join public.courses c on c.id = u.course_id join public.training_catalogs t on t.id = c.training_catalog_id
  where upper(t.code) = 'FIAE' and u.id not in (select id from public_preview.use_cases);

  select count(*) into n_fe from fiae_fe f join fiae_pe p on p.title = f.title and p.ctitle = f.ctitle;
  select count(*) into n_fu from fiae_fu f join fiae_pu p on p.title = f.title and p.ctitle = f.ctitle;
  raise notice 'Enabler-Zwillinge: % von % (Production %), Use-Case-Zwillinge: % von % (Production %)',
    n_fe, (select count(*) from fiae_fe), (select count(*) from fiae_pe), n_fu, (select count(*) from fiae_fu), (select count(*) from fiae_pu);
  if n_fe <> (select count(*) from fiae_fe) or n_fe <> (select count(*) from fiae_pe)
     or n_fu <> (select count(*) from fiae_fu) or n_fu <> (select count(*) from fiae_pu) then
    raise exception 'Abbruch: die Eltern lassen sich nicht eindeutig zuordnen, nichts geändert';
  end if;

  insert into public.content_documents
    (id, enabler_id, use_case_id, course_id, title, description, document_type, file_name, file_size, mime_type,
     storage_url, storage_path, order_index, uploaded_by_id, created_at, updated_at, visibility, page_count,
     is_indexed_by_hai, organization_id, content_sha256)
  select p.id, pe.id, pu.id, null, p.title, p.description,
         p.document_type::text::public.content_document_type, p.file_name, p.file_size, p.mime_type,
         p.storage_url, p.storage_path, p.order_index, null, p.created_at, p.updated_at,
         p.visibility::text::public.document_visibility, p.page_count, false, null, p.content_sha256
  from public_preview.content_documents p
  left join fiae_fe fe on fe.pid = p.enabler_id
  left join fiae_pe pe on pe.title = fe.title and pe.ctitle = fe.ctitle
  left join fiae_fu fu on fu.pid = p.use_case_id
  left join fiae_pu pu on pu.title = fu.title and pu.ctitle = fu.ctitle
  where (p.enabler_id in (select pid from fiae_fe) or p.use_case_id in (select pid from fiae_fu))
    and not exists (select 1 from public.content_documents d where d.id = p.id);
  get diagnostics n_ins = row_count;
  raise notice 'angelegt: % Dokumente', n_ins;

  select count(*) into n_after from public.content_documents d
  where d.enabler_id in (select id from fiae_pe) or d.use_case_id in (select id from fiae_pu);
  if n_ins <> 26 or n_after <> 26 then
    raise exception 'Abbruch: erwartet 26 Dokumente, angelegt % (an den Zwillingen jetzt %), alles zurückgerollt', n_ins, n_after;
  end if;

  drop table fiae_fe; drop table fiae_fu; drop table fiae_pe; drop table fiae_pu;
end
$fiae$;
