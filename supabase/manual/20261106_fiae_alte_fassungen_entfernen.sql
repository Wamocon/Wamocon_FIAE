-- =============================================================================
-- FIAE: alte Fassungen von Optionen und Fragen in Production entfernen
-- =============================================================================
-- Ausführen: Supabase Dashboard, SQL Editor, Projekt FIAE-Production, ganzen Inhalt einfügen, Run.
-- Das Skript ist EIN DO-Block (eine Anweisung): Es läuft atomar, auch wenn der Editor die Anweisungen
-- einzeln ausführt. Ein Fehler rollt alles zurück. Ein zweiter Lauf bricht ab (Zahlen stimmen nicht mehr).
--
-- Warum: Der Inhaltsabgleich vom 06.11.2026 hat überarbeitete FIAE-Optionen als neue Zeilen angelegt
-- (Schlüssel question_id, option_text, is_correct), die alten blieben daneben. Folge: 462 Fragen mit im
-- Schnitt 7,8 statt 4,0 Optionen und 161 alte Fragen. Maßstab ist public_preview. Siehe
-- docs/release-lessons-2026-11.md, Fehler 12.
--
-- Schutz des Fortschritts der Azubis: Das Skript bricht ab, ohne etwas zu ändern, wenn eine Antwort
-- (quiz_submission_answers) auf eine zu löschende Option oder Frage verweist. Gemessen am 06.11.2026: 0 von 78.
--
-- Erwartung: 2194 Optionen und 161 Fragen werden entfernt, danach hat Production genauso viele FIAE-Optionen
-- wie die Preview (18281). Sicherung der Zeilen vorher: Abfragen am Ende der Datei (als Kommentar).
-- =============================================================================
do $fiae$
declare
  n_o int; n_q int; a_o int; a_q int; c_o int; c_v int; c_q int;
begin
  drop table if exists fiae_po; drop table if exists fiae_vo; drop table if exists fiae_vq;
  drop table if exists fiae_old_q; drop table if exists fiae_old_o;

  create temp table fiae_po as
  select o.id oid, o.question_id qid, o.option_text ot, o.is_correct ic, x.order_index oi, q.title qt, q.quiz_type::text qty
  from public.options o join public.questions x on x.id = o.question_id join public.quizzes q on q.id = x.quiz_id
  join public.training_catalogs t on t.id = q.training_catalog_id where upper(t.code) = 'FIAE';

  create temp table fiae_vo as
  select o.option_text ot, o.is_correct ic, x.order_index oi, q.title qt, q.quiz_type::text qty
  from public_preview.options o join public_preview.questions x on x.id = o.question_id join public_preview.quizzes q on q.id = x.quiz_id
  join public_preview.training_catalogs t on t.id = q.training_catalog_id where upper(t.code) = 'FIAE';

  create temp table fiae_vq as
  select x.order_index oi, q.title qt, q.quiz_type::text qty
  from public_preview.questions x join public_preview.quizzes q on q.id = x.quiz_id
  join public_preview.training_catalogs t on t.id = q.training_catalog_id where upper(t.code) = 'FIAE';

  create temp table fiae_old_q as
  select x.id qid
  from public.questions x join public.quizzes q on q.id = x.quiz_id join public.training_catalogs t on t.id = q.training_catalog_id
  where upper(t.code) = 'FIAE'
    and not exists (select 1 from fiae_vq v where v.qt = q.title and v.qty = q.quiz_type::text and v.oi is not distinct from x.order_index);

  create temp table fiae_old_o as
  select p.oid from fiae_po p
  where not exists (select 1 from fiae_vo v where v.qt = p.qt and v.qty = p.qty and v.oi is not distinct from p.oi and v.ot = p.ot and v.ic = p.ic);

  select count(*) into n_o from fiae_old_o;
  select count(*) into n_q from fiae_old_q;
  select count(*) into a_o from public.quiz_submission_answers a where a.selected_option_id in (select oid from fiae_old_o);
  select count(*) into a_q from public.quiz_submission_answers a where a.question_id in (select qid from fiae_old_q);
  raise notice 'alte Optionen: %, alte Fragen: %, Antworten darauf: % und %', n_o, n_q, a_o, a_q;
  if a_o > 0 or a_q > 0 then raise exception 'Abbruch: Azubi-Antworten verweisen auf alte Fassungen, nichts geändert'; end if;
  if n_o <> 2194 or n_q <> 161 then raise exception 'Abbruch: erwartet 2194 Optionen und 161 Fragen, gefunden % und %, nichts geändert', n_o, n_q; end if;

  delete from public.options where id in (select oid from fiae_old_o);
  delete from public.questions where id in (select qid from fiae_old_q);

  select count(*) into c_o from public.options o join public.questions x on x.id = o.question_id join public.quizzes q on q.id = x.quiz_id
    join public.training_catalogs t on t.id = q.training_catalog_id where upper(t.code) = 'FIAE';
  select count(*) into c_q from public.questions x join public.quizzes q on q.id = x.quiz_id
    join public.training_catalogs t on t.id = q.training_catalog_id where upper(t.code) = 'FIAE';
  select count(*) into c_v from fiae_vo;
  raise notice 'danach: FIAE-Optionen % (Preview %), Fragen %', c_o, c_v, c_q;
  if c_o <> c_v then raise exception 'Abbruch: % Optionen statt % wie in der Preview, alles zurückgerollt', c_o, c_v; end if;

  drop table fiae_po; drop table fiae_vo; drop table fiae_vq; drop table fiae_old_q; drop table fiae_old_o;
end
$fiae$;

-- Sicherung (vorher mit psql ausgeführt, Ergebnis liegt als CSV im lokalen Backup-Ordner):
--   \copy (select o.* from public.options o where o.id in (<alte Optionen>)) to 'alte-optionen.csv' csv header
--   \copy (select x.* from public.questions x where x.id in (<alte Fragen>)) to 'alte-fragen.csv' csv header
