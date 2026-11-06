-- =============================================================================
-- FIAE: 980 Dubletten-Dokumente in Production entfernen
-- =============================================================================
-- Ausführen: Supabase Dashboard, SQL Editor, Projekt FIAE-Production, ganzen Inhalt einfügen, Run.
-- Das Skript ist EIN DO-Block (eine Anweisung): Es läuft atomar, auch wenn der Editor die Anweisungen
-- einzeln ausführt. Ein Fehler rollt alles zurück. Ein zweiter Lauf bricht ab (Zahlen stimmen nicht mehr).
--
-- Warum: Der Inhaltsabgleich vom 06.11.2026 hat überarbeitete FIAE-Dokumente als neue Zeilen angelegt, weil
-- sich Titel oder Dateiname geändert haben. Die Originale tragen dieselbe Id wie in public_preview und werden
-- danach von scripts/db/fiae-content-promote.mjs an Ort und Stelle aktualisiert. Die Dubletten haben keine
-- Preview-Id. Siehe docs/release-lessons-2026-11.md, Fehler 12.
--
-- Erwartung: 980 Dubletten (FIAE-Dokumente ohne Id in der Preview) werden entfernt, danach hat Production
-- 983 FIAE-Dokumente. Das Skript bricht ab, wenn die Zahl nicht 980 ist oder HAI-Einträge auf eine Dublette
-- verweisen. An Dokumenten hängt kein Fremdschlüssel und kein Fortschritt der Azubis.
-- =============================================================================
do $fiae$
declare
  n int; emb int; rest int;
begin
  drop table if exists fiae_y;

  create temp table fiae_y as
  select d.id
  from public.content_documents d
  left join public.enablers e on e.id = d.enabler_id
  left join public.use_cases u on u.id = d.use_case_id
  join public.courses c on c.id = coalesce(e.course_id, u.course_id, d.course_id)
  join public.training_catalogs t on t.id = c.training_catalog_id
  where upper(t.code) = 'FIAE'
    and not exists (select 1 from public_preview.content_documents p where p.id = d.id);

  select count(*) into n from fiae_y;
  select count(*) into emb from public.hai_embeddings h
    where h.source_type::text = 'document' and h.source_id::text in (select id::text from fiae_y);
  raise notice 'Dubletten: %, HAI-Einträge darauf: %', n, emb;
  if n <> 980 then raise exception 'Abbruch: erwartet 980 Dubletten, gefunden %, nichts geändert', n; end if;
  if emb <> 0 then raise exception 'Abbruch: % HAI-Einträge verweisen auf Dubletten, nichts geändert', emb; end if;

  delete from public.content_documents where id in (select id from fiae_y);

  select count(*) into rest from public.content_documents d
  left join public.enablers e on e.id = d.enabler_id
  left join public.use_cases u on u.id = d.use_case_id
  join public.courses c on c.id = coalesce(e.course_id, u.course_id, d.course_id)
  join public.training_catalogs t on t.id = c.training_catalog_id
  where upper(t.code) = 'FIAE';
  raise notice 'FIAE-Dokumente danach: %', rest;
  if rest <> 983 then raise exception 'Abbruch: erwartet 983 FIAE-Dokumente, gefunden %, alles zurückgerollt', rest; end if;

  drop table fiae_y;
end
$fiae$;
