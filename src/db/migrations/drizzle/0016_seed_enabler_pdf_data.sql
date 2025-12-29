-- Migration: Seed Enabler/PDF Data
-- Generated from pdf_mapping_enriched.json

DO $$
DECLARE
  trainer_id UUID;
  course_id UUID;
  enabler_id UUID;
BEGIN
  -- Get first trainer
  SELECT id INTO trainer_id FROM profiles WHERE role = 'TRAINER' LIMIT 1;
  IF trainer_id IS NULL THEN
    RAISE EXCEPTION 'No trainer found';
  END IF;

  -- Course: Aufbau und Organisation des Ausbildungsbetriebes (
  SELECT id INTO course_id FROM courses WHERE title = 'Aufbau und Organisation des Ausbildungsbetriebes (§ 4 Abs. 7 Nr. 2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Aufbau und Organisation des Ausbildungsbetriebes (§ 4 Abs. 7 Nr. 2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Der Betrieb
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Der Betrieb' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Der Betrieb', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/01_Der_Betrieb/01_Der_Betrieb.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Branchenzugehörigkeit   • Gesamtwirtschaft, z. B. primärer, sekundärer, terti­ärer Sektor, erwerbswirtschaftliche Betriebe   • ­Produktpalette und Märkte', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Rechtsformen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Rechtsformen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Rechtsformen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/02_Rechtsformen/02_Rechtsformen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Gesellschaft burgerlichen Rechts   • Personengesellschaften, z. *B.* Einzelunternehmung, *KG,* OHG, GmbH & Co. *KG* • Kapitalgesellschaften, z. B. GmbH, AG                               • Gemeinnützige Organisationen', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Unternehmensstruktur und Organisation
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Unternehmensstruktur und Organisationsform' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Unternehmensstruktur und Organisationsform', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/03_Unternehmensstruktur_und_Organisationsform/03_Unternehmensstruktur_und_Organisationsform.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Einlinien- bzw. Mehrlinien-, Stabliniensystem • Spartenorganisation  • Matrixorganisation  • Arbeitsabläufe  • Aufgabenteilung', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Wirtschaftliche Verflechtungen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Wirtschaftliche Verflechtungen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Wirtschaftliche Verflechtungen', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/04_Wirtschaftliche_Verflechtungen/04_Wirtschaftliche_Verflechtungen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Konzern • Kartell  • Fusion', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Ziele von Betrieben und Unternehmen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Ziele von Betrieben und Unternehmen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Ziele von Betrieben und Unternehmen', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/05_Ziele_von_Betrieben_und_Unternehmen/05_Ziele_von_Betrieben_und_Unternehmen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Produktivität  • Wirtschaftlichkeit  • Rentabilität  • Zielkonflikte Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Betriebliche und gesamtwirtschaftlich
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Betriebliche und gesamtwirtschaftliche Arbeitsteilung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Betriebliche und gesamtwirtschaftliche Arbeitsteilung', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/06_Betriebliche_und_gesamtwirtschaftliche_Arbeitsteilung/06_Betriebliche_und_gesamtwirtschaftliche_Arbeitsteilung.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Globalisierung • Möiglichkeiten und Grenzen der Sozialen Marktwirt­schaft', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Ziele und Aufgaben von Arbeitgeber un
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Ziele und Aufgaben von Arbeitgeber und Arbeitnehmerverbänden' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Ziele und Aufgaben von Arbeitgeber und Arbeitnehmerverbänden', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/07_Ziele_und_Aufgaben_von_Arbeitgeber_und_Arbeitnehmerverbaenden/07_Ziele_und_Aufgaben_von_Arbeitgeber_und_Arbeitnehmerverbaenden.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Branchenspezifische Gewerkschaften und Arbeitge­berverbände  • Wirtschaftsorganisationen • Berufsständische Vertretungen und Organisationen  • EhrenamtlicheMitwirkung, z. B. Prüfungsausschuss', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Ziele und Aufgaben von Behörden und V
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Ziele und Aufgaben von Behörden und Verwaltungen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Ziele und Aufgaben von Behörden und Verwaltungen', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/08_Ziele_und_Aufgaben_von_Behoerden_und_Verwaltungen/08_Ziele_und_Aufgaben_von_Behoerden_und_Verwaltungen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Ziele und Aufgaben von Behörden und Verwaltungen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 09_Grundsatz der vertrauensvollen Zusamm
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '09_Grundsatz der vertrauensvollen Zusammenarbeit zwischen Arbeitgeber und Arbeitnehmervertretern' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '09_Grundsatz der vertrauensvollen Zusammenarbeit zwischen Arbeitgeber und Arbeitnehmervertretern', 9, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Aufbau_und_Organisation_des_Ausbildungsbetriebes_par_4_Abs._7_Nr._2/09_Grundsatz_der_vertrauensvollen_Zusammenarbeit_zwischen_Arbeitgeber_und_Arbeitnehmervertretern/09_Grundsatz_der_vertrauensvollen_Zusammenarbeit_zwischen_Arbei.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Grundsatz der vertrauensvollen Zusammenarbeit zwischen Arbeitgeber und Arbeitnehmervertretern".', true, NOW(), NOW());
  END IF;
  
  -- Course: Berufsbildung, Arbeits- und Tarifrecht (§ 4 Abs. 7
  SELECT id INTO course_id FROM courses WHERE title = 'Berufsbildung, Arbeits- und Tarifrecht (§ 4 Abs. 7 Nr. 1)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Berufsbildung, Arbeits- und Tarifrecht (§ 4 Abs. 7 Nr. 1)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Rechte und Pflichten des Auszubildend
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Rechte und Pflichten des Auszubildenden und des Ausbildenden' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Rechte und Pflichten des Auszubildenden und des Ausbildenden', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/01_Rechte_und_Pflichten_des_Auszubildenden_und_des_Ausbildenden/FR-732_sortiert.pdf', 'In diesem Modul "Rechte und Pflichten des Auszubildenden und des Ausbildenden" werden folgende Inhalte behandelt:  lnhaltedes Ausbildungsvertrages (§ 10 f. BBiG) • Vertragspartner • Beginn und Dauer der Ausbildung • sachliche und zeitlicheGliederung der Berufsaus- bildung, Dauer der taglichen Arbeitszeit • Probezeit • Vergutungs- und Urlaubsregelungen • Kundigungsbedingungen • Folgenbei Nichteinhaltung der Rechte und Pflichten • Geltungsbereich • Beendigung • Prufungen, Abschluss Link zum Dokume', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Vorteile der Ausbildung im dualen Sys
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Vorteile der Ausbildung im dualen System der Berufsausbildung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Vorteile der Ausbildung im dualen System der Berufsausbildung', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/02_Vorteile_der_Ausbildung_im_dualen_System_der_Berufsausbildung/02_Vorteile_der_Ausbildung_im_dualen_System_der_Berufsausbildung.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Vorteile der Ausbildung im dualen System der Berufsausbildung".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Aufgaben von Ausbildungsbetrieb, Beru
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Aufgaben von Ausbildungsbetrieb, Berufsschule und Kammern im Rahmen der Berufsausbildung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Aufgaben von Ausbildungsbetrieb, Berufsschule und Kammern im Rahmen der Berufsausbildung', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/03_Aufgaben_von_Ausbildungsbetrieb_Berufsschule_und_Kammern_im_Rahmen_der_Berufsausbildung/03_Aufgaben_von_Ausbildungsbetrieb_Berufsschule_und_Kammern_im_Rahmen_der_Ber.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Regelungstatbestände in Ausbildungsordnung • Ausbildungsvertrag • Berufsbildungsgesetz • Berufsschulpflicht  • Berufsschulzeiten  • Freistellung zur Prüfung • Bereitstellung von Arbeitsmaterialien ENABLER:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Ausbildungsrahmenplan, sachliche und 
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Ausbildungsrahmenplan, sachliche und zeitliche Gliederung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Ausbildungsrahmenplan, sachliche und zeitliche Gliederung', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/04_Ausbildungsrahmenplan_sachliche_und_zeitliche_Gliederung/04_Ausbildungsrahmenplan_sachliche_und_zeitliche_Gliederung.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Rahmenlehrplan • Betrieblicher Ausbildungsplan • Zuordnung der Lernziele des Ausbildungsrahmen­plans zu den lnhalten des betrieblichen Ausbildungsplans, unter Berücksichtigung betrieblicher Besonderheiten • Einsatz- und Versetzungsplan im Betrieb  • Rahmenplan für die berufsschulische Ausbildung ENABLER:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Grundsätze des Individual - und Kolle
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Grundsätze des Individual - und Kollektivarbeitsrechtes' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Grundsätze des Individual - und Kollektivarbeitsrechtes', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/05_Grundsaetze_des_Individual_-_und_Kollektivarbeitsrechtes/05_Grundsaetze_des_Individual_-_und_Kollektivarbeitsrechtes.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Grundsätze des Individual - und Kollektivarbeitsrechtes".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Arbeitgeberorganisationen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Arbeitgeberorganisationen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Arbeitgeberorganisationen', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/06_Arbeitgeberorganisationen/06_Arbeitgeberorganisationen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Arbeitgeberverbände • lndustrie und Handelskammern • Wirtschaftsverbande ENABLER ERSTELLT:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Arbeitnehmerorganisationen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Arbeitnehmerorganisationen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Arbeitnehmerorganisationen', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/07_Arbeitnehmerorganisationen/07_Arbeitnehmerorganisationen.pdf', 'In diesem Modul "Arbeitnehmerorganisationen" werden folgende Inhalte behandelt:  # Gewerkschaften  # Betriebsräte • Wahl und Zusammensetzung • Mitbestimmungs und Mitwirkungsrechte • Betriebsversammlung • Einigungsstelle • Jugend und Auszubildendenvertretung ENABLER ERSTELLT:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Tarifrecht
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Tarifrecht' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Tarifrecht', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/08_Tarifrecht/08_Tarifrecht.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Tarifverträge  • Tarifautonomie • Tarifverhandlung • Tarifkonflikt (Arbeitskampf) • Schlichtung • Tarifautonomie • Tarifbindung • Geltungsbereich • Laufzeit Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 09_Lohn- und Gehaltsformen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '09_Lohn- und Gehaltsformen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '09_Lohn- und Gehaltsformen', 9, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/09_Lohn-_und_Gehaltsformen/09_Lohn-_und_Gehaltsformen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Brutto/Netto * Lohnsteuer,Kirchensteuer * Sozialabgaben * Vermogenswirksame *  Leistungen  Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 10_Lebensbegleitendes lernen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '10_Lebensbegleitendes lernen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '10_Lebensbegleitendes lernen', 10, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/10_Lebensbegleitendes_lernen/10_Lebensbegleitendes_lernen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Regelungen und Miiglichkeiten fur interne und externe Weiterbildung in Betrieb und Branche, evtl. tarifvertragliche Regelungen • Berufliche Fortbildung und Umschulung  • lnnerbetriebliche Fortbildung • Staatliche Födermaßnahmen', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 11_Lerntechniken
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '11_Lerntechniken' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '11_Lerntechniken', 11, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/11_Lerntechniken/11_Lerntechniken.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Visuelles Lemen, z. B. Lernposter mit Mindmaps, Schaubilder, Grafiken erstellen, Videos ansehen, eigene Zusammenfassungen und Lernkarteien schreiben * Auditives Lemen, z. B. Lerngruppen bilden, Vorträge anhören, Lerninhalte aufnehmen und abspielen  * Kommunikatives Lemen, z. B. Dialoge, Diskussionen, Lerngruppen, Frage-Antwort-Spiele * Motorisches Lemen, z. B “Learning by Doing", * Rollenspiele, Gruppenaktivitäten   Link zu dem Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 12_Arbeitstechniken
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '12_Arbeitstechniken' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '12_Arbeitstechniken', 12, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/12_Arbeitstechniken/12_Arbeitstechniken.pdf', 'In diesem Modul "Arbeitstechniken" werden folgende Inhalte behandelt:  # Zeitmanagementtechniken # Moderations- und Prasentationstechniken  # Arbeitsplanung- und Projektplanungstechniken  # Verschiedene Arbeitstechniken erlernen  # Gestaltung eines lernfiirderlichen und das Lemen integrierenden Arbeitsplatzes # Beschaffung, Auswahl und Auswertung von Fachin­formationen # Digitale Lernmedien nutzen und individuell bewerten, z. B. • Internet • Apps • Plattformen (Kommunikation, Information,Videos,', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 13_Berufliche Fortbildung und Umschulung
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '13_Berufliche Fortbildung und Umschulung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '13_Berufliche Fortbildung und Umschulung', 13, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/13_Berufliche_Fortbildung_und_Umschulung/13_Berufliche_Fortbildung_und_Umschulung.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Staatliche Fördermaßnahmen  • Erhaltungsfortbildung  • Anpassungsfortbildung  • Aufstiegsfortbildung • lnnerbetriebliche Fartbildung Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 14_Lebensplanung
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '14_Lebensplanung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '14_Lebensplanung', 14, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Berufsbildung_Arbeits-_und_Tarifrecht_par_4_Abs._7_Nr._1/14_Lebensplanung/14_Lebensplanung.pdf', 'In diesem Modul "Lebensplanung" werden folgende Inhalte behandelt:  # Regelungen und Moglichkeiten !Ur interne und externe Weiterbildung in Betrieb und Branche, evtl. tarifvertragliche Regelungen # Bildungseinrichtungen # Auslandsaufenthalte, z. B. mithilfe van EU-Förder­pragrammen # Persönliche Weiterbildung • Studium van Fachliteratur • Selbstlernmaterialien • Fachmessen Entwicklung bezüglich • Eigenstandigkeit • Verantwartung • Reflexivität • Lernkampetenz • Team- und Fuhrungsfähigkeit • Mitg', true, NOW(), NOW());
  END IF;
  
  -- Course: Betreiben von IT-Systemen (Vertiefung) (§ 4 Abs. 2
  SELECT id INTO course_id FROM courses WHERE title = 'Betreiben von IT-Systemen (Vertiefung) (§ 4 Abs. 2 Nr. 8  J2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Betreiben von IT-Systemen (Vertiefung) (§ 4 Abs. 2 Nr. 8  J2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Schichtenmodelle, z. B. OSI, TCP_IP b
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Schichtenmodelle, z. B. OSI, TCP_IP benennen und zuordnen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Schichtenmodelle, z. B. OSI, TCP_IP benennen und zuordnen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/01_Schichtenmodelle_z._B._OSI_TCP_IP_benennen_und_zuordnen_koennen/01_Schichtenmodelle_z._B._OSI_TCP_IP_benennen_und_zuordnen_koennen.pdf', 'In diesem Modul "Schichtenmodelle, z. B. OSI, TCP_IP benennen und zuordnen können" werden folgende Inhalte behandelt:  1Pv4/1Pv6  MAC Routing  Switching  ARP  TCP/UDP Enabler created:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Netzwerkkomponenten vergleichen und b
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Netzwerkkomponenten vergleichen und beschreiben können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Netzwerkkomponenten vergleichen und beschreiben können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/02_Netzwerkkomponenten_vergleichen_und_beschreiben_koennen/02_Netzwerkkomponenten_vergleichen_und_beschreiben_koennen.pdf', 'In diesem Modul "Netzwerkkomponenten vergleichen und beschreiben können" werden folgende Inhalte behandelt:  Switch  Bridge  Router  Firewall Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Netzwerkkonzepte (-topologien, -infra
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Netzwerkkonzepte (-topologien, -infrastrukturen) benennen und charakterisieren' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Netzwerkkonzepte (-topologien, -infrastrukturen) benennen und charakterisieren', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/03_Netzwerkkonzepte_-topologien_-infrastrukturen_benennen_und_charakterisieren/03_Netzwerkkonzepte_-topologien_-infrastrukturen_benennen_und_charakterisieren.pdf', 'In diesem Modul "Netzwerkkonzepte (-topologien, -infrastrukturen) benennen und charakterisieren" werden folgende Inhalte behandelt:  Ausdehnung: LANI/WAN/MAN/GAN Datenubertragungsrate Zugriffskontrolle im Netzwerk (RADIUS, Kerberos ... ) Verschlusselung auf Netzwerkebene, VPN Strukturierte Verkabelung VLAN Drahtlos: PAN/WLAN/Mesh Sicherheit in Drahtlosnetzen Bluetooth Sicherheitskonzepte und -risiken Netzwerktopologie (FI DV/FI SI) Netzwerkplan Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Situationsgerechte Auswahl einer pass
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Situationsgerechte Auswahl einer passenden Programmiersprache begriinden konnen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Situationsgerechte Auswahl einer passenden Programmiersprache begriinden konnen', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begriinden_konnen/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begriinden_konnen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Performance, Speicherverbrauch *  Portabilität  * Framework/Bibliotheken * Einsatz von integrierten Entwicklungsumgebungen  * Know-how/Fachkenntniss   Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Übertragungsprotokolle und ihre Eigen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Übertragungsprotokolle und ihre Eigenschaften erlautern und zielgerichtet einsetzen konnen  z. B' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Übertragungsprotokolle und ihre Eigenschaften erlautern und zielgerichtet einsetzen konnen  z. B', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/05_uebertragungsprotokolle_und_ihre_Eigenschaften_erlautern_und_zielgerichtet_einsetzen_konnen_z._B/05_uebertragungsprotokolle_und_ihre_Eigenschaften_erlautern_und_zielgerichtet_einsetze.pdf', 'In diesem Modul "Übertragungsprotokolle und ihre Eigenschaften erlautern und zielgerichtet einsetzen konnen  z. B" werden folgende Inhalte behandelt:  Switch  Bridge  Router  Firewall Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Standortübergreifende und -unabhängig
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Standortübergreifende und -unabhängige Kommunikation situationsgerecht' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Standortübergreifende und -unabhängige Kommunikation situationsgerecht', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/06_Standortuebergreifende_und_-unabhaengige_Kommunikation_situationsgerecht/06_Standortuebergreifende_und_-unabhaengige_Kommunikation_situationsgerecht.pdf', 'In diesem Modul "Standortübergreifende und -unabhängige Kommunikation situationsgerecht" werden folgende Inhalte behandelt:  VPN-Modelle  Tunneling  IPsecn ….', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Netzwerkrelevante Dienste beschreiben
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Netzwerkrelevante Dienste beschreiben können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Netzwerkrelevante Dienste beschreiben können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/07_Netzwerkrelevante_Dienste_beschreiben_koennen/07_Netzwerkrelevante_Dienste_beschreiben_koennen.pdf', 'In diesem Modul "Netzwerkrelevante Dienste beschreiben können" werden folgende Inhalte behandelt:  DNS  DHCP Proxy Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Anforderungen an Verfügbarkeit von An
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Anforderungen an Verfügbarkeit von Anwen- dungsdiensten beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Anforderungen an Verfügbarkeit von Anwen- dungsdiensten beurteilen können', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/08_Anforderungen_an_Verfuegbarkeit_von_Anwen-_dungsdiensten_beurteilen_koennen/08_Anforderungen_an_Verfuegbarkeit_von_Anwen-_dungsdiensten_beurteilen_koennen.pdf', 'In diesem Modul "Anforderungen an Verfügbarkeit von Anwen- dungsdiensten beurteilen können" werden folgende Inhalte behandelt:  Echtzeitkommunikation  Mailserver Webserver  Groupware  Datenbank Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 09_Risiken identifizieren, MaBnahmen pla
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '09_Risiken identifizieren, MaBnahmen planen und Ausfallwahrscheinlichkeiten berücksichtigen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '09_Risiken identifizieren, MaBnahmen planen und Ausfallwahrscheinlichkeiten berücksichtigen', 9, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/09_Risiken_identifizieren_MaBnahmen_planen_und_Ausfallwahrscheinlichkeiten_beruecksichtigen/09_Risiken_identifizieren_MaBnahmen_planen_und_Ausfallwahrscheinlichkeiten_beruecksichtigen.pdf', 'In diesem Modul "Risiken identifizieren, MaBnahmen planen und Ausfallwahrscheinlichkeiten berücksichtigen" werden folgende Inhalte behandelt:  PDCA-Zyklus  MTBF/AFR7 Notfallkonzept (Disaster Recover) Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 10_Maßnahmen zur Sicherstellung des Betr
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '10_Maßnahmen zur Sicherstellung des Betriebes beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '10_Maßnahmen zur Sicherstellung des Betriebes beurteilen können', 10, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/10_Massnahmen_zur_Sicherstellung_des_Betriebes_beurteilen_koennen/10_Massnahmen_zur_Sicherstellung_des_Betriebes_beurteilen_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Elektrotechnisch (USV)  • Hardwaretechnisch (Redundanzen), RAID  • Softwaretechnisch (Backups ... )', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 11_Monitoringsysteme anwenden und Ergebn
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '11_Monitoringsysteme anwenden und Ergebnisse interpretieren können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '11_Monitoringsysteme anwenden und Ergebnisse interpretieren können', 11, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/11_Monitoringsysteme_anwenden_und_Ergebnisse_interpretieren_koennen/11_Monitoringsysteme_anwenden_und_Ergebnisse_interpretieren_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Festlegen der Monitoringdaten  • SNMP, S.M.A.R.T. u. Ä. • Systemlastanalyse • Predictive Maintenance • Ressourcenengpasse • Festlegen von Schwellwerten Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 12_Monitoringergebnisse analysieren und 
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '12_Monitoringergebnisse analysieren und korrektive Maßnahmen bestimmen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '12_Monitoringergebnisse analysieren und korrektive Maßnahmen bestimmen können', 12, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/12_Monitoringergebnisse_analysieren_und_korrektive_Massnahmen_bestimmen_koennen/12_Monitoringergebnisse_analysieren_und_korrektive_Massnahmen_bestimmen_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Standard Operation Procedures (SOP) • Service Level Agreement (SLA),  • Service Level 1-3 Incident Management (Ticketsystem)  • Eskalationsstufen Link zu der Datei:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 13_Berufliche Fortbildung und Umschulung
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '13_Berufliche Fortbildung und Umschulung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '13_Berufliche Fortbildung und Umschulung', 13, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_Vertiefung_par_4_Abs._2_Nr._8_J2/13_Berufliche_Fortbildung_und_Umschulung/13_Berufliche_Fortbildung_und_Umschulung.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Staatliche Fördermaßnahmen  • Erhaltungsfortbildung  • Anpassungsfortbildung  • Aufstiegsfortbildung • lnnerbetriebliche Fartbildung Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Course: Betreiben von IT-Systemen (§4 Abs. 2 Nr.8)
  SELECT id INTO course_id FROM courses WHERE title = 'Betreiben von IT-Systemen (§4 Abs. 2 Nr.8)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Betreiben von IT-Systemen (§4 Abs. 2 Nr.8)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Schichtenmodelle, z. B. OSI, TCP_IP b
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Schichtenmodelle, z. B. OSI, TCP_IP benennen und zuordnen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Schichtenmodelle, z. B. OSI, TCP_IP benennen und zuordnen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/01_Schichtenmodelle_z._B._OSI_TCP_IP_benennen_und_zuordnen_koennen/01_Schichtenmodelle_z._B._OSI_TCP_IP_benennen_und_zuordnen_koennen.pdf', 'In diesem Modul "Schichtenmodelle, z. B. OSI, TCP_IP benennen und zuordnen können" werden folgende Inhalte behandelt:  1Pv4/1Pv6  MAC Routing  Switching  ARP  TCP/UDP Enabler created:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Netzwerkkomponenten vergleichen und b
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Netzwerkkomponenten vergleichen und beschreiben können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Netzwerkkomponenten vergleichen und beschreiben können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/02_Netzwerkkomponenten_vergleichen_und_beschreiben_koennen/02_Netzwerkkomponenten_vergleichen_und_beschreiben_koennen.pdf', 'In diesem Modul "Netzwerkkomponenten vergleichen und beschreiben können" werden folgende Inhalte behandelt:  Switch  Bridge  Router  Firewall Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Netzwerkkonzepte (-topologien, -infra
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Netzwerkkonzepte (-topologien, -infrastrukturen) benennen und charakterisieren' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Netzwerkkonzepte (-topologien, -infrastrukturen) benennen und charakterisieren', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/03_Netzwerkkonzepte_-topologien_-infrastrukturen_benennen_und_charakterisieren/03_Netzwerkkonzepte_-topologien_-infrastrukturen_benennen_und_charakterisieren.pdf', 'In diesem Modul "Netzwerkkonzepte (-topologien, -infrastrukturen) benennen und charakterisieren" werden folgende Inhalte behandelt:  Ausdehnung: LANI/WAN/MAN/GAN Datenubertragungsrate Zugriffskontrolle im Netzwerk (RADIUS, Kerberos ... ) Verschlusselung auf Netzwerkebene, VPN Strukturierte Verkabelung VLAN Drahtlos: PAN/WLAN/Mesh Sicherheit in Drahtlosnetzen Bluetooth Sicherheitskonzepte und -risiken Netzwerktopologie (FI DV/FI SI) Netzwerkplan Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Situationsgerechte Auswahl einer pass
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Situationsgerechte Auswahl einer passenden Programmiersprache begriinden konnen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Situationsgerechte Auswahl einer passenden Programmiersprache begriinden konnen', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begriinden_konnen/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begriinden_konnen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Performance, Speicherverbrauch *  Portabilität  * Framework/Bibliotheken * Einsatz von integrierten Entwicklungsumgebungen  * Know-how/Fachkenntniss   Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Übertragungsprotokolle und ihre Eigen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Übertragungsprotokolle und ihre Eigenschaften erlautern und zielgerichtet einsetzen konnen  z. B' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Übertragungsprotokolle und ihre Eigenschaften erlautern und zielgerichtet einsetzen konnen  z. B', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/05_uebertragungsprotokolle_und_ihre_Eigenschaften_erlautern_und_zielgerichtet_einsetzen_konnen_z._B/05_uebertragungsprotokolle_und_ihre_Eigenschaften_erlautern_und_zielgerichtet_einsetze.pdf', 'In diesem Modul "Übertragungsprotokolle und ihre Eigenschaften erlautern und zielgerichtet einsetzen konnen  z. B" werden folgende Inhalte behandelt:  Switch  Bridge  Router  Firewall Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Standortübergreifende und -unabhängig
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Standortübergreifende und -unabhängige Kommunikation situationsgerecht' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Standortübergreifende und -unabhängige Kommunikation situationsgerecht', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/06_Standortuebergreifende_und_-unabhaengige_Kommunikation_situationsgerecht/06_Standortuebergreifende_und_-unabhaengige_Kommunikation_situationsgerecht.pdf', 'In diesem Modul "Standortübergreifende und -unabhängige Kommunikation situationsgerecht" werden folgende Inhalte behandelt:  VPN-Modelle  Tunneling  IPsecn ….', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Netzwerkrelevante Dienste beschreiben
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Netzwerkrelevante Dienste beschreiben können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Netzwerkrelevante Dienste beschreiben können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/07_Netzwerkrelevante_Dienste_beschreiben_koennen/07_Netzwerkrelevante_Dienste_beschreiben_koennen.pdf', 'In diesem Modul "Netzwerkrelevante Dienste beschreiben können" werden folgende Inhalte behandelt:  DNS  DHCP Proxy Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Anforderungen an Verfügbarkeit von An
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Anforderungen an Verfügbarkeit von Anwen- dungsdiensten beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Anforderungen an Verfügbarkeit von Anwen- dungsdiensten beurteilen können', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/08_Anforderungen_an_Verfuegbarkeit_von_Anwen-_dungsdiensten_beurteilen_koennen/08_Anforderungen_an_Verfuegbarkeit_von_Anwen-_dungsdiensten_beurteilen_koennen.pdf', 'In diesem Modul "Anforderungen an Verfügbarkeit von Anwen- dungsdiensten beurteilen können" werden folgende Inhalte behandelt:  Echtzeitkommunikation  Mailserver Webserver  Groupware  Datenbank Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 09_Risiken identifizieren, MaBnahmen pla
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '09_Risiken identifizieren, MaBnahmen planen und Ausfallwahrscheinlichkeiten berücksichtigen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '09_Risiken identifizieren, MaBnahmen planen und Ausfallwahrscheinlichkeiten berücksichtigen', 9, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/09_Risiken_identifizieren_MaBnahmen_planen_und_Ausfallwahrscheinlichkeiten_beruecksichtigen/09_Risiken_identifizieren_MaBnahmen_planen_und_Ausfallwahrscheinlichkeiten_beruecksichtigen.pdf', 'In diesem Modul "Risiken identifizieren, MaBnahmen planen und Ausfallwahrscheinlichkeiten berücksichtigen" werden folgende Inhalte behandelt:  PDCA-Zyklus  MTBF/AFR7 Notfallkonzept (Disaster Recover) Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 10_Maßnahmen zur Sicherstellung des Betr
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '10_Maßnahmen zur Sicherstellung des Betriebes beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '10_Maßnahmen zur Sicherstellung des Betriebes beurteilen können', 10, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/10_Massnahmen_zur_Sicherstellung_des_Betriebes_beurteilen_koennen/10_Massnahmen_zur_Sicherstellung_des_Betriebes_beurteilen_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Elektrotechnisch (USV)  • Hardwaretechnisch (Redundanzen), RAID  • Softwaretechnisch (Backups ... )', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 11_Monitoringsysteme anwenden und Ergebn
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '11_Monitoringsysteme anwenden und Ergebnisse interpretieren können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '11_Monitoringsysteme anwenden und Ergebnisse interpretieren können', 11, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/11_Monitoringsysteme_anwenden_und_Ergebnisse_interpretieren_koennen/11_Monitoringsysteme_anwenden_und_Ergebnisse_interpretieren_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Festlegen der Monitoringdaten  • SNMP, S.M.A.R.T. u. Ä. • Systemlastanalyse • Predictive Maintenance • Ressourcenengpasse • Festlegen von Schwellwerten Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 12_Monitoringergebnisse analysieren und 
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '12_Monitoringergebnisse analysieren und korrektive Maßnahmen bestimmen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '12_Monitoringergebnisse analysieren und korrektive Maßnahmen bestimmen können', 12, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/12_Monitoringergebnisse_analysieren_und_korrektive_Massnahmen_bestimmen_koennen/12_Monitoringergebnisse_analysieren_und_korrektive_Massnahmen_bestimmen_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Standard Operation Procedures (SOP) • Service Level Agreement (SLA),  • Service Level 1-3 Incident Management (Ticketsystem)  • Eskalationsstufen Link zu der Datei:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 13_Berufliche Fortbildung und Umschulung
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '13_Berufliche Fortbildung und Umschulung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '13_Berufliche Fortbildung und Umschulung', 13, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Betreiben_von_IT-Systemen_par4_Abs._2_Nr.8/13_Berufliche_Fortbildung_und_Umschulung/13_Berufliche_Fortbildung_und_Umschulung.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Staatliche Fördermaßnahmen  • Erhaltungsfortbildung  • Anpassungsfortbildung  • Aufstiegsfortbildung • lnnerbetriebliche Fartbildung Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Course: Beurteilen marktgängiger IT-Systeme (Vertiefung) (
  SELECT id INTO course_id FROM courses WHERE title = 'Beurteilen marktgängiger IT-Systeme (Vertiefung) (§ 4 Abs. 2 Nr. 3  J2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Beurteilen marktgängiger IT-Systeme (Vertiefung) (§ 4 Abs. 2 Nr. 3  J2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Marktgängige IT-Syteme kennen, unters
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Marktgängige IT-Syteme kennen, unterscheiden und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Marktgängige IT-Syteme kennen, unterscheiden und beurteilen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_Vertiefung_par_4_Abs._2_Nr._3_J2/01_Marktgaengige_IT-Syteme_kennen_unterscheiden_und_beurteilen_koennen/01_Marktgaengige_IT-Syteme_kennen_unterscheiden_und_beurteilen_koennen.pdf', 'In diesem Modul "Marktgängige IT-Syteme kennen, unterscheiden und beurteilen können" werden folgende Inhalte behandelt:  Situationsgerechte Kundenkommunikation Kommunikationsmodelle, z. B. • 4-Ohren-Modell, • Sender-Empfanger-Modell Kundenbedarf ermitteln und Angebote unterbreiten Interpretation englischsprachiger Texte', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Typische IT-Systeme und deren Einsatz
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Typische IT-Systeme und deren Einsatzbereiche identifizieren und zuordnen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Typische IT-Systeme und deren Einsatzbereiche identifizieren und zuordnen können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_Vertiefung_par_4_Abs._2_Nr._3_J2/02_Typische_IT-Systeme_und_deren_Einsatzbereiche_identifizieren_und_zuordnen_koennen/02_Typische_IT-Systeme_und_deren_Einsatzbereiche_identifizieren_und_zuordnen_koennen.pdf', 'In diesem Modul "Typische IT-Systeme und deren Einsatzbereiche identifizieren und zuordnen können" werden folgende Inhalte behandelt:  Kommunikationssysteme, z. B. Videokonferenzsys­ teme, Social-Media-Systeme Client-Server-Systeme Einbindung in einer Domain Mobile Geräte, z. B. Smartphone, Tablet Netzwerkprotokolle (z. B. Ethernet, IP, DNS) und OSI-Modell', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Leistungsfähigkeit und Energieeffizie
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Leistungsfähigkeit und Energieeffizienz von IT-Systemen bestimmen, analysieren und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Leistungsfähigkeit und Energieeffizienz von IT-Systemen bestimmen, analysieren und beurteilen können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_Vertiefung_par_4_Abs._2_Nr._3_J2/03_Leistungsfaehigkeit_und_Energieeffizienz_von_IT-Systemen_bestimmen_analysieren_und_beurteilen_koennen/03_Leistungsfaehigkeit_und_Energieeffizienz_von_IT-Systemen_bestimmen.pdf', 'In diesem Modul "Leistungsfähigkeit und Energieeffizienz von IT-Systemen bestimmen, analysieren und beurteilen können" werden folgende Inhalte behandelt:  Kenngrößen, Leistungsdaten, Funktionsumfang, z. B. Einstellungsmöglichkeiten im BIOS, UEFI, CPU, RAM, Datenspeicher (SSD/HDD), Filesysteme (z. B. fat32, NTFS, APFS, ext4), Grafikkarte, Netzwerkkarte, Gateway/Router, Switch, LWL, Ethernet Standards, WLAN-Standards Barrierefreier Zugriff auf IT-Systeme am Arbeitsplatz, z. B. Einstellungsmöglichk', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Wirtschaftlichkeit von IT-Systemen be
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Wirtschaftlichkeit von IT-Systemen bestimmen und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Wirtschaftlichkeit von IT-Systemen bestimmen und beurteilen können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_Vertiefung_par_4_Abs._2_Nr._3_J2/04_Wirtschaftlichkeit_von_IT-Systemen_bestimmen_und_beurteilen_koennen/04_Wirtschaftlichkeit_von_IT-Systemen_bestimmen_und_beurteilen_koennen.pdf', 'In diesem Modul "Wirtschaftlichkeit von IT-Systemen bestimmen und beurteilen können" werden folgende Inhalte behandelt:  Anschaffungskosten Betriebskosten Variable und fixe Kosten Lizenzkosten Finanzierungskosten Einfacher Kostenvergleich (Leasing, Kaul, Finanzie­rung, Pay-per-Use) Preis-Leistungs-Verhältnis Qualitativer und quantitativer Angebotsvergleich Nutzwertanalyse Wertschöpfung Ablage Link:', true, NOW(), NOW());
  END IF;
  
  -- Course: Beurteilen marktgängiger IT-Systeme (§ 4 Abs. 2 Nr
  SELECT id INTO course_id FROM courses WHERE title = 'Beurteilen marktgängiger IT-Systeme (§ 4 Abs. 2 Nr. 3)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Beurteilen marktgängiger IT-Systeme (§ 4 Abs. 2 Nr. 3)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Marktgängige IT-Syteme kennen, unters
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Marktgängige IT-Syteme kennen, unterscheiden und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Marktgängige IT-Syteme kennen, unterscheiden und beurteilen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_par_4_Abs._2_Nr._3/01_Marktgaengige_IT-Syteme_kennen_unterscheiden_und_beurteilen_koennen/01_Marktgaengige_IT-Syteme_kennen_unterscheiden_und_beurteilen_koennen.pdf', 'In diesem Modul "Marktgängige IT-Syteme kennen, unterscheiden und beurteilen können" werden folgende Inhalte behandelt:  Situationsgerechte Kundenkommunikation Kommunikationsmodelle, z. B. • 4-Ohren-Modell, • Sender-Empfanger-Modell Kundenbedarf ermitteln und Angebote unterbreiten Interpretation englischsprachiger Texte', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Typische IT-Systeme und deren Einsatz
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Typische IT-Systeme und deren Einsatzbereiche identifizieren und zuordnen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Typische IT-Systeme und deren Einsatzbereiche identifizieren und zuordnen können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_par_4_Abs._2_Nr._3/02_Typische_IT-Systeme_und_deren_Einsatzbereiche_identifizieren_und_zuordnen_koennen/02_Typische_IT-Systeme_und_deren_Einsatzbereiche_identifizieren_und_zuordnen_koennen.pdf', 'In diesem Modul "Typische IT-Systeme und deren Einsatzbereiche identifizieren und zuordnen können" werden folgende Inhalte behandelt:  Kommunikationssysteme, z. B. Videokonferenzsys­ teme, Social-Media-Systeme Client-Server-Systeme Einbindung in einer Domain Mobile Geräte, z. B. Smartphone, Tablet Netzwerkprotokolle (z. B. Ethernet, IP, DNS) und OSI-Modell', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Leistungsfähigkeit und Energieeffizie
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Leistungsfähigkeit und Energieeffizienz von IT-Systemen bestimmen, analysieren und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Leistungsfähigkeit und Energieeffizienz von IT-Systemen bestimmen, analysieren und beurteilen können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_par_4_Abs._2_Nr._3/03_Leistungsfaehigkeit_und_Energieeffizienz_von_IT-Systemen_bestimmen_analysieren_und_beurteilen_koennen/03_Leistungsfaehigkeit_und_Energieeffizienz_von_IT-Systemen_bestimmen.pdf', 'In diesem Modul "Leistungsfähigkeit und Energieeffizienz von IT-Systemen bestimmen, analysieren und beurteilen können" werden folgende Inhalte behandelt:  Kenngrößen, Leistungsdaten, Funktionsumfang, z. B. Einstellungsmöglichkeiten im BIOS, UEFI, CPU, RAM, Datenspeicher (SSD/HDD), Filesysteme (z. B. fat32, NTFS, APFS, ext4), Grafikkarte, Netzwerkkarte, Gateway/Router, Switch, LWL, Ethernet Standards, WLAN-Standards Barrierefreier Zugriff auf IT-Systeme am Arbeitsplatz, z. B. Einstellungsmöglichk', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Wirtschaftlichkeit von IT-Systemen be
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Wirtschaftlichkeit von IT-Systemen bestimmen und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Wirtschaftlichkeit von IT-Systemen bestimmen und beurteilen können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Beurteilen_marktgaengiger_IT-Systeme_par_4_Abs._2_Nr._3/04_Wirtschaftlichkeit_von_IT-Systemen_bestimmen_und_beurteilen_koennen/04_Wirtschaftlichkeit_von_IT-Systemen_bestimmen_und_beurteilen_koennen.pdf', 'In diesem Modul "Wirtschaftlichkeit von IT-Systemen bestimmen und beurteilen können" werden folgende Inhalte behandelt:  Anschaffungskosten Betriebskosten Variable und fixe Kosten Lizenzkosten Finanzierungskosten Einfacher Kostenvergleich (Leasing, Kaul, Finanzie­rung, Pay-per-Use) Preis-Leistungs-Verhältnis Qualitativer und quantitativer Angebotsvergleich Nutzwertanalyse Wertschöpfung Ablage Link:', true, NOW(), NOW());
  END IF;
  
  -- Course: Durchführen von QS-Maßnahmen (Vertiefung) (§ 4 Abs
  SELECT id INTO course_id FROM courses WHERE title = 'Durchführen von QS-Maßnahmen (Vertiefung) (§ 4 Abs. 2 Nr. 5  J2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Durchführen von QS-Maßnahmen (Vertiefung) (§ 4 Abs. 2 Nr. 5  J2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Methoden der Qualitätslenkung anwende
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Methoden der Qualitätslenkung anwenden' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Methoden der Qualitätslenkung anwenden', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Durchfuehren_von_QS-Massnahmen_Vertiefung_par_4_Abs._2_Nr._5_J2/01_Methoden_der_Qualitaetslenkung_anwenden/01_Methoden_der_Qualitaetslenkung_anwenden.pdf', 'In diesem Modul "Methoden der Qualitätslenkung anwenden" werden folgende Inhalte behandelt:  Verschiedene Prüfverfahren, z. B. Paritat, Redundanz Software-Test, dynamische und statische Testverfah­ren (z. B. Black Box, White Box, Review, Extremwer­te test, Testdaten, Last- und Performancetest) Debugging, Ablaufverfolgung  Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Methoden zur Messung der Zielerreichu
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Methoden zur Messung der Zielerreichung im QM-Prozess kennen und anwenden' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Methoden zur Messung der Zielerreichung im QM-Prozess kennen und anwenden', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Durchfuehren_von_QS-Massnahmen_Vertiefung_par_4_Abs._2_Nr._5_J2/02_Methoden_zur_Messung_der_Zielerreichung_im_QM-Prozess_kennen_und_anwenden/02_Methoden_zur_Messung_der_Zielerreichung_im_QM-Prozess_kennen_und_anwenden.pdf', 'In diesem Modul "Methoden zur Messung der Zielerreichung im QM-Prozess kennen und anwenden" werden folgende Inhalte behandelt:  Verbesserungsprozess, PDCA-Zyklus, KVP, Kenn­ zahlen  Soll-lst-Vergleich,   Abweichungen erkennen und berechnen  Testdatengeneratoren Testprotokolle Abnahmeprotokol   Link zum Ordner:', true, NOW(), NOW());
  END IF;
  
  -- Course: Durchführen von qualitätssichernden Maßnahmen (§ 4
  SELECT id INTO course_id FROM courses WHERE title = 'Durchführen von qualitätssichernden Maßnahmen (§ 4 Abs. 2 Nr. 5)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Durchführen von qualitätssichernden Maßnahmen (§ 4 Abs. 2 Nr. 5)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Grundverständnis zu folgenden Fachbeg
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Grundverständnis zu folgenden Fachbegriffen nachweisen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Grundverständnis zu folgenden Fachbegriffen nachweisen', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Durchfuehren_von_qualitaetssichernden_Massnahmen_par_4_Abs._2_Nr._5/01_Grundverstaendnis_zu_folgenden_Fachbegriffen_nachweisen/01_Grundverstaendnis_zu_folgenden_Fachbegriffen_nachweisen.pdf', 'In diesem Modul "Grundverständnis zu folgenden Fachbegriffen nachweisen" werden folgende Inhalte behandelt:  Betriebliche QM-Systeme QS-Normen Zertifizierung', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Maßnahmen des Qualitätsmanagements fü
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Maßnahmen des Qualitätsmanagements für den eigenen Arbeitsbereich kennen, planen und anwenden' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Maßnahmen des Qualitätsmanagements für den eigenen Arbeitsbereich kennen, planen und anwenden', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Durchfuehren_von_qualitaetssichernden_Massnahmen_par_4_Abs._2_Nr._5/02_Massnahmen_des_Qualitaetsmanagements_fuer_den_eigenen_Arbeitsbereich_kennen_planen_und_anwenden/02_Massnahmen_des_Qualitaetsmanagements_fuer_den_eigenen_Arbeitsberei.pdf', 'In diesem Modul "Maßnahmen des Qualitätsmanagements für den eigenen Arbeitsbereich kennen, planen und anwenden" werden folgende Inhalte behandelt:  Qualitatsplanung, Qualitatsziele (lst-Zustand ermit­ teln und Ziel-Zustand festlegen) Qualitatslenkung (Umsetzung der Planphase) PDCA - Plan, Do, Check, Act als Qualitatsmanage­ mentzyklus Testprotokoll fur das Einrichten eines Arbeitsplatzes', true, NOW(), NOW());
  END IF;
  
  -- Course: Entwickeln von IT-Lösungen (Vertiefung) (§ 4 Abs. 
  SELECT id INTO course_id FROM courses WHERE title = 'Entwickeln von IT-Lösungen (Vertiefung) (§ 4 Abs. 2 Nr. 4  J2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Entwickeln von IT-Lösungen (Vertiefung) (§ 4 Abs. 2 Nr. 4  J2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Fehler erkennen, analysieren und behe
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Fehler erkennen, analysieren und beheben' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Fehler erkennen, analysieren und beheben', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_von_IT-Loesungen_Vertiefung_par_4_Abs._2_Nr._4_J2/01_Fehler_erkennen_analysieren_und_beheben/01_Fehler_erkennen_analysieren_und_beheben.pdf', 'In diesem Modul "Fehler erkennen, analysieren und beheben" werden folgende Inhalte behandelt:  Debugging, Breakpoint Software-Test, dynamische und statische Testverfah­ren, z. B. Black Box, White Box, Review, Extremwerte test Testdaten Komponententest, lntegrationstest, Systemtest Versionsmanagement des Quellcodes Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Algorithmen formulieren und Programme
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Algorithmen formulieren und Programme entwickeln' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Algorithmen formulieren und Programme entwickeln', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_von_IT-Loesungen_Vertiefung_par_4_Abs._2_Nr._4_J2/02_Algorithmen_formulieren_und_Programme_entwickeln/02_Algorithmen_formulieren_und_Programme_entwickeln.pdf', 'In diesem Modul "Algorithmen formulieren und Programme entwickeln" werden folgende Inhalte behandelt:  Abbildung der Kontrollstrukturen mittels Aktivi­ tatsdiagramm oder Pseudocode als didaktisches Hilfsmittel  UML (siehe Anhang des Prufungskatalogs: Use Case bzw. Anwendungsfalldiagramme, Klassendiagramm, Aktivitatsdiagramm)  Entwurf der Bildschirmausgabemasken (Software­ ergonomie, Barrierefreiheit)  Link zu der Datei:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Datenbanken modellieren und erstellen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Datenbanken modellieren und erstellen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Datenbanken modellieren und erstellen', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_von_IT-Loesungen_Vertiefung_par_4_Abs._2_Nr._4_J2/03_Datenbanken_modellieren_und_erstellen/03_Datenbanken_modellieren_und_erstellen.pdf', 'In diesem Modul "Datenbanken modellieren und erstellen" werden folgende Inhalte behandelt:  Relationale und nicht-relationale Datenbanken, NoSQL Datenbanken  Datentypen: Boolesche Werte, Ganzzahl, Gleitkom­ mawerte, Wahrung, Datumswerte, Texte fester und variabler Lange, BLOB, Geokoordinaten Anomalien/Redundanzen erkennen  Normalisieren, 1. bis 3. Normalform  ER-Model!, Attribute, Beziehungen, Kardinalitaten, referenzielle lntegritat, Aktualisierungsweitergabe, Liischweitergabe, Primarschlussel,', true, NOW(), NOW());
  END IF;
  
  -- Course: Entwickeln, Erstellen und Betreuen von IT-Lösungen
  SELECT id INTO course_id FROM courses WHERE title = 'Entwickeln, Erstellen und Betreuen von IT-Lösungen (§ 4 Abs. 2 Nr. 4)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Entwickeln, Erstellen und Betreuen von IT-Lösungen (§ 4 Abs. 2 Nr. 4)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_IT-Systeme unter Berücksichtigung des
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_IT-Systeme unter Berücksichtigung des IT- Umfeldes konzeptionieren, konfigurieren, testen und dokumentieren können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_IT-Systeme unter Berücksichtigung des IT- Umfeldes konzeptionieren, konfigurieren, testen und dokumentieren können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/01_IT-Systeme_unter_Beruecksichtigung_des_IT-_Umfeldes_konzeptionieren_konfigurieren_testen_und_dokumentieren_koennen/01_IT-Systeme_unter_Beruecksichtigung_des.pdf', 'In diesem Modul "IT-Systeme unter Berücksichtigung des IT- Umfeldes konzeptionieren, konfigurieren, testen und dokumentieren können" werden folgende Inhalte behandelt:  Bedarfsanalyse Lasten- und Pflichtenheft (Zweck, Urheber, lnhalt) Installation und Einrichtung von Systemen, z. B. Betriebssysteme, BIOS, UEFI, Partitionierungen/ Formatierungen, Netzwerkanbindungen, IP(v4/v6)­ Konfiguration, Remote-Desktop, Kl-Software Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Bedarfsgerechte Auswahl von Hardware 
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Bedarfsgerechte Auswahl von Hardware vor- nehmen und begründen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Bedarfsgerechte Auswahl von Hardware vor- nehmen und begründen können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/02_Bedarfsgerechte_Auswahl_von_Hardware_vor-_nehmen_und_begruenden_koennen/02_Bedarfsgerechte_Auswahl_von_Hardware_vor-_nehmen_und_begruenden_koennen.pdf', 'In diesem Modul "Bedarfsgerechte Auswahl von Hardware vor- nehmen und begründen können" werden folgende Inhalte behandelt:  Geräteklassen, z. B. Desktops, Notebooks, All-in-One, Thin Clients, Tablets, Smartphones Mobile und stationare Arbeitsplatzsysteme wie PC, Terminals, LAN, WLAN Barrierefreiheit, Unterstützung durch zusätzliche Hardware, z. B. groBerer Monitor, breitere Tastatur, Lautsprecher/Mikrofon zur Verfügung stellen Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Bedarfsgerechte Auswahl von Software 
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Bedarfsgerechte Auswahl von Software vorneh- men und begründen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Bedarfsgerechte Auswahl von Software vorneh- men und begründen können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/03_Bedarfsgerechte_Auswahl_von_Software_vorneh-_men_und_begruenden_koennen/03_Bedarfsgerechte_Auswahl_von_Software_vorneh-_men_und_begruenden_koennen.pdf', 'In diesem Modul "Bedarfsgerechte Auswahl von Software vorneh- men und begründen können" werden folgende Inhalte behandelt:  Geräteklassen, z. B. Desktops, Notebooks, All-in-One, Thin Clients, Tablets, Smartphones Mobile und stationare Arbeitsplatzsysteme wie PC, Terminals, LAN, WLAN Barrierefreiheit, Unterstützung durch zusätzliche Hardware, z. B. groBerer Monitor, breitere Tastatur, Lautsprecher/Mikrofon zur Verfügung stellen Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Urheberrechtsgesetz kennen und Lizenz
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Urheberrechtsgesetz kennen und Lizenzmodelle unterscheiden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Urheberrechtsgesetz kennen und Lizenzmodelle unterscheiden können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/04_Urheberrechtsgesetz_kennen_und_Lizenzmodelle_unterscheiden_koennen/04_Urheberrechtsgesetz_kennen_und_Lizenzmodelle_unterscheiden_koennen.pdf', 'In diesem Modul "Urheberrechtsgesetz kennen und Lizenzmodelle unterscheiden können" werden folgende Inhalte behandelt:  Grundlagen des Schutzes der Urheber Lizenzarten, z. B. EULA, OEM, GNU Pay-per-Use', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Aktivitäten bei Installationen und Ko
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Aktivitäten bei Installationen und Konfigurati- onen kennen und beurteilen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Aktivitäten bei Installationen und Konfigurati- onen kennen und beurteilen', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/05_Aktivitaeten_bei_Installationen_und_Konfigurati-_onen_kennen_und_beurteilen/05_Aktivitaeten_bei_Installationen_und_Konfigurati-_onen_kennen_und_beurteilen.pdf', 'In diesem Modul "Aktivitäten bei Installationen und Konfigurati- onen kennen und beurteilen" werden folgende Inhalte behandelt:  Installation und Konfiguration der Hardware Installation und Konfiguration des Betriebssystems Arbeiten mit der Kommandozeile, Befehlssyntax, Parameter Anpassung von Software Konfiguration, Test, Troubleshooting und Dokumen­ tation von Netzwerkverbindungen, z. B. IP-Adressen, DHCP, WLAN-Zugang, Pre shared key/Enterprise, VPN Konsolenbefehle fur Dateioperationen und Net', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_ Programmiersprachen mit folgenden Me
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_ Programmiersprachen mit folgenden Merkmalen kennen, einordnen und unterscheiden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_ Programmiersprachen mit folgenden Merkmalen kennen, einordnen und unterscheiden können', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/06__Programmiersprachen_mit_folgenden_Merkmalen_kennen_einordnen_und_unterscheiden_koennen/06__Programmiersprachen_mit_folgenden_Merkmalen_kennen_einordnen_u.pdf', 'In diesem Modul "Programmiersprachen mit folgenden Merkmalen kennen, einordnen und unterscheiden können" werden folgende Inhalte behandelt:  Compiler, Linker, Interpreter Prozedurale und objektorientierte Herangehensweise Variablen, Datentypen und -strukturen Kontrollstrukturen, z. B. Verzweigung, Schleife Prozeduren, Funktionen Klassen, Attribute, Objekte, Methoden, Sichtbarkeit Bibliotheken, Frameworks Skriptsprachen, z. B. Shell-Skript Debugging, formale und inhaltliche Fehler', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Programmierwerkzeuge kennen und anwen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Programmierwerkzeuge kennen und anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Programmierwerkzeuge kennen und anwenden können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/07_Programmierwerkzeuge_kennen_und_anwenden_koennen/07_Programmierwerkzeuge_kennen_und_anwenden_koennen.pdf', 'In diesem Modul "Programmierwerkzeuge kennen und anwenden können" werden folgende Inhalte behandelt:  Abbildung der Kontrollstrukturen, z. B. Verzwei­ gungen, Schleife, mittels Pseudocode UML (Use Case bzw. Anwendungsfalldiagramm, Klassendiagramm, Aktivitatsdiagramm) Entwurf der Bildschirmausgabemasken (Software­ ergonomie, Corporate Identity, Barrierefreiheit) Fehler in einem gegebenen Quellcode finden Schreibtischtest mit einem gegebenen Quellcode durchfuhren', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Grundlagen von relationalen Datenbank
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Grundlagen von relationalen Datenbanken kennen und anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Grundlagen von relationalen Datenbanken kennen und anwenden können', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Entwickeln_Erstellen_und_Betreuen_von_IT-Loesungen_par_4_Abs._2_Nr._4/08_Grundlagen_von_relationalen_Datenbanken_kennen_und_anwenden_koennen/08_Grundlagen_von_relationalen_Datenbanken_kennen_und_anwenden_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Einfache ER-Modelle Enabler created and stored in one drive file structure:', true, NOW(), NOW());
  END IF;
  
  -- Course: Erbringen der Leistungen und Auftragsabschluss (§ 
  SELECT id INTO course_id FROM courses WHERE title = 'Erbringen der Leistungen und Auftragsabschluss (§ 4 Abs. 2 Nr. 7)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Erbringen der Leistungen und Auftragsabschluss (§ 4 Abs. 2 Nr. 7)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Vertragsarten, Vertragsbestandteile u
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Vertragsarten, Vertragsbestandteile und Vertragsstörungen kennen und unterscheiden' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Vertragsarten, Vertragsbestandteile und Vertragsstörungen kennen und unterscheiden', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Erbringen_der_Leistungen_und_Auftragsabschluss_par_4_Abs._2_Nr._7/01_Vertragsarten_Vertragsbestandteile_und_Vertragsstoerungen_kennen_und_unterscheiden/01_Vertragsarten_Vertragsbestandteile_und_Vertragsstoerungen_kennen_und_unte.pdf', 'In diesem Modul "Vertragsarten, Vertragsbestandteile und Vertragsstörungen kennen und unterscheiden" werden folgende Inhalte behandelt:  Kaufvertrag, Mietvertrag, Leasing Lizenzvertrag Servicevertrag, Service Level Agreement (SLA) Werkvertrag, Dienstvertrag Vertragsbestandteile, z. B. Leistungsbeschreibung, Termine, Entgelte, Sanktionen/Konventionalstrafen Vertragsstürungen', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Zielsetzungen des Unternehmens dem Le
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Zielsetzungen des Unternehmens dem Leitbild entnehmen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Zielsetzungen des Unternehmens dem Leitbild entnehmen können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Erbringen_der_Leistungen_und_Auftragsabschluss_par_4_Abs._2_Nr._7/02_Zielsetzungen_des_Unternehmens_dem_Leitbild_entnehmen_koennen/02_Zielsetzungen_des_Unternehmens_dem_Leitbild_entnehmen_koennen.pdf', 'In diesem Modul "Zielsetzungen des Unternehmens dem Leitbild entnehmen können" werden folgende Inhalte behandelt:  bkonomisch, z. B. Umsatz und Gewinn bkologisch, z. B. Ressourcenschonung, Nachhaltig­ keit Sozial, z. B. Arbeitsbedi', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Umsetzungsvarianten der Leistungserbr
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Umsetzungsvarianten der Leistungserbringung kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Umsetzungsvarianten der Leistungserbringung kennen', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Erbringen_der_Leistungen_und_Auftragsabschluss_par_4_Abs._2_Nr._7/03_Umsetzungsvarianten_der_Leistungserbringung_kennen/03_Umsetzungsvarianten_der_Leistungserbringung_kennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Umsetzungsvarianten der Leistungserbringung kennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Leistungserbringung gemäß der Aufbauo
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Leistungserbringung gemäß der Aufbauorganisation des eigenen Unternehmens abstimmen,' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Leistungserbringung gemäß der Aufbauorganisation des eigenen Unternehmens abstimmen,', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Erbringen_der_Leistungen_und_Auftragsabschluss_par_4_Abs._2_Nr._7/04_Leistungserbringung_gemaess_der_Aufbauorganisation_des_eigenen_Unternehmens_abstimmen/04_Leistungserbringung_gemaess_der_Aufbauorganisation_des_eigenen_Unternehme.pdf', 'In diesem Modul "Leistungserbringung gemäß der Aufbauorganisation des eigenen Unternehmens abstimmen," werden folgende Inhalte behandelt:  Mehrliniensystem, Einliniensystem, Matrixorganisation Handlungs· und Entscheidungsspielraume/Vollmachten', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Veränderungsprozesse begleiten und un
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Veränderungsprozesse begleiten und unterstützen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Veränderungsprozesse begleiten und unterstützen', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Erbringen_der_Leistungen_und_Auftragsabschluss_par_4_Abs._2_Nr._7/05_Veraenderungsprozesse_begleiten_und_unterstuetzen/05_Veraenderungsprozesse_begleiten_und_unterstuetzen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Veränderungsprozesse begleiten und unterstützen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Leistungsübergabe und Einweisungen pl
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Leistungsübergabe und Einweisungen planen und dokumentieren' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Leistungsübergabe und Einweisungen planen und dokumentieren', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Erbringen_der_Leistungen_und_Auftragsabschluss_par_4_Abs._2_Nr._7/06_Leistungsuebergabe_und_Einweisungen_planen_und_dokumentieren/06_Leistungsuebergabe_und_Einweisungen_planen_und_dokumentieren.pdf', 'In diesem Modul "Leistungsübergabe und Einweisungen planen und dokumentieren" werden folgende Inhalte behandelt:  lnhalt des Abnahmeprotokolls Mangel und Mangelarten • Schlechtleistung • Falschlieferung • Minderlieferun', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Leistungserbringung bewerten und doku
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Leistungserbringung bewerten und dokumentieren können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Leistungserbringung bewerten und dokumentieren können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Erbringen_der_Leistungen_und_Auftragsabschluss_par_4_Abs._2_Nr._7/07_Leistungserbringung_bewerten_und_dokumentieren_koennen/07_Leistungserbringung_bewerten_und_dokumentieren_koennen.pdf', 'In diesem Modul "Leistungserbringung bewerten und dokumentieren können" werden folgende Inhalte behandelt:  Bedarfsanalyse Lasten- und Pflichtenheft (Zweck, Urheber, lnhalt) Installation und Einrichtung von Systemen, z. B. Betriebssysteme, BIOS, UEFI, Partitionierungen/ Formatierungen, Netzwerkanbindungen, IP(v4/v6)­ Konfiguration, Remote-Desktop, Kl-Software Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Course: Inbetriebnehmen von Speicherlösungen (§ 4 Abs. 2 N
  SELECT id INTO course_id FROM courses WHERE title = 'Inbetriebnehmen von Speicherlösungen (§ 4 Abs. 2 Nr. 9)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Inbetriebnehmen von Speicherlösungen (§ 4 Abs. 2 Nr. 9)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Technische und organisatorische Maßna
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Technische und organisatorische Maßnahmen (TOM)' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Technische und organisatorische Maßnahmen (TOM)', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Inbetriebnehmen_von_Speicherloesungen_par_4_Abs._2_Nr._9/01_Technische_und_organisatorische_Massnahmen_TOM/01_Technische_und_organisatorische_Massnahmen_TOM.pdf', 'In diesem Modul "Technische und organisatorische Maßnahmen (TOM)" werden folgende Inhalte behandelt:  Berechtigungskonzepte, Organisationsstrukturen (Zugang, Zutritt, Zugriff)', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Möglichkeiten der physischen und hard
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Möglichkeiten der physischen und hardwaretechnischen Absicherungen bennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Möglichkeiten der physischen und hardwaretechnischen Absicherungen bennen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Inbetriebnehmen_von_Speicherloesungen_par_4_Abs._2_Nr._9/02_Moeglichkeiten_der_physischen_und_hardwaretechnischen_Absicherungen_bennen/02_Moeglichkeiten_der_physischen_und_hardwaretechnischen_Absicherungen_bennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Möglichkeiten der physischen und hardwaretechnischen Absicherungen bennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Möglichkeiten der softwaretechnischen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Möglichkeiten der softwaretechnischen Absicherung implementieren können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Möglichkeiten der softwaretechnischen Absicherung implementieren können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Inbetriebnehmen_von_Speicherloesungen_par_4_Abs._2_Nr._9/03_Moeglichkeiten_der_softwaretechnischen_Absicherung_implementieren_koennen/03_Moeglichkeiten_der_softwaretechnischen_Absicherung_implementieren_koennen.pdf', 'In diesem Modul "Möglichkeiten der softwaretechnischen Absicherung implementieren können" werden folgende Inhalte behandelt:  User- und Zugriffsmanagement Firewall/Webfilter Portsecurity Verschl0sselung, z. B. Bitlocker', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Verschiedene Service- und Liefermodel
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Verschiedene Service- und Liefermodelle benennen und bedarfsorientiert auswählen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Verschiedene Service- und Liefermodelle benennen und bedarfsorientiert auswählen können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Inbetriebnehmen_von_Speicherloesungen_par_4_Abs._2_Nr._9/04_Verschiedene_Service-_und_Liefermodelle_benennen_und_bedarfsorientiert_auswaehlen_koennen/04_Verschiedene_Service-_und_Liefermodelle_benennen_und_bedarfsorientiert_auswaehl.pdf', 'In diesem Modul "Verschiedene Service- und Liefermodelle benennen und bedarfsorientiert auswählen können" werden folgende Inhalte behandelt:  On Premises, Cloud . • Saas, laaS, PaaS ...', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Daten heterogener Quellen zusammenfüh
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Daten heterogener Quellen zusammenführen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Daten heterogener Quellen zusammenführen können', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Inbetriebnehmen_von_Speicherloesungen_par_4_Abs._2_Nr._9/05_Daten_heterogener_Quellen_zusammenfuehren_koennen/05_Daten_heterogener_Quellen_zusammenfuehren_koennen.pdf', 'In diesem Modul "Daten heterogener Quellen zusammenführen können" werden folgende Inhalte behandelt:  Datenaustauschformate: XML, JSON, CSV u. a. • Bildung eines Data Lake o. a. Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Netzwerkkomponenten und -protokolle b
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Netzwerkkomponenten und -protokolle beschreiben können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Netzwerkkomponenten und -protokolle beschreiben können', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Inbetriebnehmen_von_Speicherloesungen_par_4_Abs._2_Nr._9/06_Netzwerkkomponenten_und_-protokolle_beschreiben_koennen/06_Netzwerkkomponenten_und_-protokolle_beschreiben_koennen.pdf', 'In diesem Modul "Netzwerkkomponenten und -protokolle beschreiben können" werden folgende Inhalte behandelt:  NAS  SAN  iSCSI  SMB  NFS Ethernet, FibreChannel', true, NOW(), NOW());
  END IF;
  
  -- Course: Informieren und Beraten von Kunden (§ 4 Abs. 2 Nr.
  SELECT id INTO course_id FROM courses WHERE title = 'Informieren und Beraten von Kunden (§ 4 Abs. 2 Nr. 2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Informieren und Beraten von Kunden (§ 4 Abs. 2 Nr. 2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Marktsituationen bewerten können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Marktsituationen bewerten können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Marktsituationen bewerten können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Informieren_und_Beraten_von_Kunden_par_4_Abs._2_Nr._2/01_Marktsituationen_bewerten_koennen/01_Marktsituationen_bewerten_koennen.pdf', 'In diesem Modul "Marktsituationen bewerten können" werden folgende Inhalte behandelt:  Marktformen, z. B. Monopol, Oligopol, Polypol, Kaufer-/Verkaufermarkt  Zielgruppendefinition- und Abgrenzung Quantitative und qualitative Angebotsbe  Link to Enabler-File:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Zielgruppengerechte Bedarfsanalyse du
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Zielgruppengerechte Bedarfsanalyse durch- führen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Zielgruppengerechte Bedarfsanalyse durch- führen können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Informieren_und_Beraten_von_Kunden_par_4_Abs._2_Nr._2/02_Zielgruppengerechte_Bedarfsanalyse_durch-_fuehren_koennen/02_Zielgruppengerechte_Bedarfsanalyse_durch-_fuehren_koennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Zielgruppengerechte Bedarfsanalyse durch- führen können".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_ZielgerichteteMethoden zur Kundenbera
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_ZielgerichteteMethoden zur Kundenberatung kennen und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_ZielgerichteteMethoden zur Kundenberatung kennen und beurteilen können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Informieren_und_Beraten_von_Kunden_par_4_Abs._2_Nr._2/03_ZielgerichteteMethoden_zur_Kundenberatung_kennen_und_beurteilen_koennen/03_ZielgerichteteMethoden_zur_Kundenberatung_kennen_und_beurteilen_koennen.pdf', 'In diesem Modul "ZielgerichteteMethoden zur Kundenberatung kennen und beurteilen können" werden folgende Inhalte behandelt:  Situationsgerechte Kundenkommunikation Kommunikationsmodelle, z. B. • 4-Ohren-Modell, • Sender-Empfanger-Modell Kundenbedarf ermitteln und Angebote unterbreiten Interpretation englischsprachiger Texte', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Informationen aufbereiten und präsent
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Informationen aufbereiten und präsentieren sowie Quellen auswerten können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Informationen aufbereiten und präsentieren sowie Quellen auswerten können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Informieren_und_Beraten_von_Kunden_par_4_Abs._2_Nr._2/04_Informationen_aufbereiten_und_praesentieren_sowie_Quellen_auswerten_koennen/04_Informationen_aufbereiten_und_praesentieren_sowie_Quellen_auswerten_koennen.pdf', 'In diesem Modul "Informationen aufbereiten und präsentieren sowie Quellen auswerten können" werden folgende Inhalte behandelt:  Technische und kaufmannische Texte in deutscher und englischer Sprache Prasentation und Medienkompetenz', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Marketingaktivitäten unterstützen kön
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Marketingaktivitäten unterstützen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Marketingaktivitäten unterstützen können', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Informieren_und_Beraten_von_Kunden_par_4_Abs._2_Nr._2/05_Marketingaktivitaeten_unterstuetzen_koennen/05_Marketingaktivitaeten_unterstuetzen_koennen.pdf', 'In diesem Modul "Marketingaktivitäten unterstützen können" werden folgende Inhalte behandelt:  Nutzwertanalyse Vertriebsformen (direkter Vertrieb, indirekter Ver­trieb)', true, NOW(), NOW());
  END IF;
  
  -- Course: IT-Sicherheit & Datenschutz (Vertiefung) (§ 4 Abs.
  SELECT id INTO course_id FROM courses WHERE title = 'IT-Sicherheit & Datenschutz (Vertiefung) (§ 4 Abs. 2 Nr. 6  J2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'IT-Sicherheit & Datenschutz (Vertiefung) (§ 4 Abs. 2 Nr. 6  J2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Schadenspotenziale von IT-Sicherheits
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Schadenspotenziale von IT-Sicherheitsvorfällen einschätzen und Schäden verhindern können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Schadenspotenziale von IT-Sicherheitsvorfällen einschätzen und Schäden verhindern können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/IT-Sicherheit_Datenschutz_Vertiefung_par_4_Abs._2_Nr._6_J2/01_Schadenspotenziale_von_IT-Sicherheitsvorfaellen_einschaetzen_und_Schaeden_verhindern_koennen/01_Schadenspotenziale_von_IT-Sicherheitsvorfaellen_einschaetzen_und_Schaede.pdf', 'In diesem Modul "Schadenspotenziale von IT-Sicherheitsvorfällen einschätzen und Schäden verhindern können" werden folgende Inhalte behandelt:  lmageschaden   Wirtschaftlicher Schaden   Datenverlust   Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Präventive IT-Sicherheitsmaßnahmen fü
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Präventive IT-Sicherheitsmaßnahmen für verschiedene Bedrohungsszenarien planen und umsetzen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Präventive IT-Sicherheitsmaßnahmen für verschiedene Bedrohungsszenarien planen und umsetzen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/IT-Sicherheit_Datenschutz_Vertiefung_par_4_Abs._2_Nr._6_J2/02_Praeventive_IT-Sicherheitsmassnahmen_fuer_verschiedene_Bedrohungsszenarien_planen_und_umsetzen/02_Praeventive_IT-Sicherheitsmassnahmen_fuer_verschiedene_Bedrohungsszen.pdf', 'In diesem Modul "Präventive IT-Sicherheitsmaßnahmen für verschiedene Bedrohungsszenarien planen und umsetzen" werden folgende Inhalte behandelt:  Datendiebstahl Digitale Erpressung (Ransomware) ldentitatsdiebstahl (Phishing)  [02: Praventive IT-Sicherheitsmaßnahmen für verschiedene Bedrohungsszenarien planen und umsetzen, z. B. Maßnahmen gegen', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Ziele zur Entwicklung von IT-Sicherhe
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Ziele zur Entwicklung von IT-Sicherheitskriterien definieren' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Ziele zur Entwicklung von IT-Sicherheitskriterien definieren', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/IT-Sicherheit_Datenschutz_Vertiefung_par_4_Abs._2_Nr._6_J2/03_Ziele_zur_Entwicklung_von_IT-Sicherheitskriterien_definieren/03_Ziele_zur_Entwicklung_von_IT-Sicherheitskriterien_definieren.pdf', 'In diesem Modul "Ziele zur Entwicklung von IT-Sicherheitskriterien definieren" werden folgende Inhalte behandelt:  Richtschnur fur Entwickler Objektive Bewertung der Systeme (IT-Grundschutz­ modellierung) Unterstutzung von Anwendern/Benutzern bei der Auswahl eines geeigneten IT-Sicherheitsprodukts (Security by Design) Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Kunden zur IT-Sicherheit beraten
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Kunden zur IT-Sicherheit beraten' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Kunden zur IT-Sicherheit beraten', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/IT-Sicherheit_Datenschutz_Vertiefung_par_4_Abs._2_Nr._6_J2/04_Kunden_zur_IT-Sicherheit_beraten/04_Kunden_zur_IT-Sicherheit_beraten.pdf', 'In diesem Modul "Kunden zur IT-Sicherheit beraten" werden folgende Inhalte behandelt:  Private Haushalte Unternehmen (intern, extern) Offentliche Hand Funktionale Anforderungen Qualitätsanforderungen Technisch Organisatorische Maßnahmen (TOM) Rahmenbedingungen   • Technologisch   • Organisatorisch   • Rechtlich   • Ethisch   Risikoanalyse Bedrohungsszenarien, z. B. Man-in-the-Middle, SOL-Injection, DDoS-Attack  Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Verschiedene Tools zur Überprüfung vo
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Verschiedene Tools zur Überprüfung von IT- Sicherheitsmaßnahmen erläutern' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Verschiedene Tools zur Überprüfung von IT- Sicherheitsmaßnahmen erläutern', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/IT-Sicherheit_Datenschutz_Vertiefung_par_4_Abs._2_Nr._6_J2/05_Verschiedene_Tools_zur_ueberpruefung_von_IT-_Sicherheitsmassnahmen_erlaeutern/05_Verschiedene_Tools_zur_ueberpruefung_von_IT-_Sicherheitsmassnahmen_erlaeutern.pdf', 'In diesem Modul "Verschiedene Tools zur Überprüfung von IT- Sicherheitsmaßnahmen erläutern" werden folgende Inhalte behandelt:  Penetrations-Test Device Security Check Identity & Access Management Schwachstellenanalyse    [04_05_Verschiedene Tools zur Überprüfung von IT- Sicherheitsmaßnahmen erläutern', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Wirksamkeit und Effizienz der umgeset
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Wirksamkeit und Effizienz der umgesetzten Technisch Organisatorischen Maßnahmen (TOM) zur IT-Sicherheit und zum Datenschutz prüfen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Wirksamkeit und Effizienz der umgesetzten Technisch Organisatorischen Maßnahmen (TOM) zur IT-Sicherheit und zum Datenschutz prüfen', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/IT-Sicherheit_Datenschutz_Vertiefung_par_4_Abs._2_Nr._6_J2/06_Wirksamkeit_und_Effizienz_der_umgesetzten_Technisch_Organisatorischen_Massnahmen_TOM_zur_IT-Sicherheit_und_zum_Datenschutz_pruefen/06_Wirksamkeit_und_Effizienz_d.pdf', 'In diesem Modul "Wirksamkeit und Effizienz der umgesetzten Technisch Organisatorischen Maßnahmen (TOM) zur IT-Sicherheit und zum Datenschutz prüfen" werden folgende Inhalte behandelt:  Zutrittskontrolle, z. B.  * Alarmanlage  * Videouberwachung  * Besucherausweise   Zugangskontrolle, z. B.   * Bildschirmschoner mit Passwortschutz  * Biometrische Verfahren  * Magnet- oder Chipkarte   Zugriffskontrolle, z. B.   * Verschlusselung von Datentragern  * Loschung von Datentragern  * User/Rollenkonzept  ', true, NOW(), NOW());
  END IF;
  
  -- Course: Konzipieren und Umsetzen von Softwareanwendungen (
  SELECT id INTO course_id FROM courses WHERE title = 'Konzipieren und Umsetzen von Softwareanwendungen (§ 4 Abs. 3 Nr. 1)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Konzipieren und Umsetzen von Softwareanwendungen (§ 4 Abs. 3 Nr. 1)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Lasten-Pflichtenheft erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Lasten-Pflichtenheft erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Lasten-Pflichtenheft erstellen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/01_Lasten-Pflichtenheft_erstellen_koennen/01_Lasten-Pflichtenheft_erstellen_koennen.pdf', 'In diesem Modul "Lasten-Pflichtenheft erstellen können" werden folgende Inhalte behandelt:  Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Vorgehensmodelle unterscheiden können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Vorgehensmodelle unterscheiden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Vorgehensmodelle unterscheiden können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/02_Vorgehensmodelle_unterscheiden_koennen/02_Vorgehensmodelle_unterscheiden_koennen.pdf', 'In diesem Modul "Vorgehensmodelle unterscheiden können" werden folgende Inhalte behandelt:  Klassische Modelle, z. B. • Wasserfallmodell • Spiralmodell • V-Modell AgileModelle, z. B. • Scrum', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Strukturierte Analyse- und Designverf
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Strukturierte Analyse- und Designverfahren anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Strukturierte Analyse- und Designverfahren anwenden können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/03_Strukturierte_Analyse-_und_Designverfahren_anwenden_koennen/03_Strukturierte_Analyse-_und_Designverfahren_anwenden_koennen.pdf', 'In diesem Modul "Strukturierte Analyse- und Designverfahren anwenden können" werden folgende Inhalte behandelt:  Top-down-Entwurf Bottom-up-Entwurf  Modularisierung ENabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Objektorientierte Analyse- und Design
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Objektorientierte Analyse- und Designverfahren anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Objektorientierte Analyse- und Designverfahren anwenden können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/04_Objektorientierte_Analyse-_und_Designverfahren_anwenden_koennen/04_Objektorientierte_Analyse-_und_Designverfahren_anwenden_koennen.pdf', 'In diesem Modul "Objektorientierte Analyse- und Designverfahren anwenden können" werden folgende Inhalte behandelt:  Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Programmspezifikationen_festlegen,_Da
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Programmspezifikationen_festlegen,_Datenmodelle' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Programmspezifikationen_festlegen,_Datenmodelle', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/05_Programmspezifikationen_festlegen_Datenmodelle/05_Programmspezifikationen_festlegen_Datenmodelle.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Programmspezifikationen_festlegen,_Datenmodelle".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Konzepte von Programmiersprachen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Konzepte von Programmiersprachen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Konzepte von Programmiersprachen', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/06_Konzepte_von_Programmiersprachen/06_Konzepte_von_Programmiersprachen.pdf', 'In diesem Modul "Konzepte von Programmiersprachen" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Software-Entwicklungswerkzeuge aufgab
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Software-Entwicklungswerkzeuge aufgabenbezogen auswählen und anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Software-Entwicklungswerkzeuge aufgabenbezogen auswählen und anwenden können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/07_Software-Entwicklungswerkzeuge_aufgabenbezogen_auswaehlen_und_anwenden_koennen/07_Software-Entwicklungswerkzeuge_aufgabenbezogen_auswaehlen_und_anwenden_koennen.pdf', 'In diesem Modul "Software-Entwicklungswerkzeuge aufgabenbezogen auswählen und anwenden können" werden folgende Inhalte behandelt:  Abbildung der Kontrollstrukturen, z. B. Verzwei­ gungen, Schleife, mittels Pseudocode UML (Use Case bzw. Anwendungsfalldiagramm, Klassendiagramm, Aktivitatsdiagramm) Entwurf der Bildschirmausgabemasken (Software­ ergonomie, Corporate Identity, Barrierefreiheit) Fehler in einem gegebenen Quellcode finden Schreibtischtest mit einem gegebenen Quellcode durchfuhren', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Einsatzmöglichkeiten von Programmiers
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Einsatzmöglichkeiten von Programmiersprachen kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Einsatzmöglichkeiten von Programmiersprachen kennen', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/08_Einsatzmoeglichkeiten_von_Programmiersprachen_kennen/08_Einsatzmoeglichkeiten_von_Programmiersprachen_kennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Einsatzmöglichkeiten von Programmiersprachen kennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 09_UML-Diagramme erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '09_UML-Diagramme erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '09_UML-Diagramme erstellen können', 9, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/09_UML-Diagramme_erstellen_koennen/09_UML-Diagramme_erstellen_koennen.pdf', 'In diesem Modul "UML-Diagramme erstellen können" werden folgende Inhalte behandelt:  Klassendiagramm  Anwendungsfalldiagramm  Zustandsdiagramm  Aktivitatsdiagramm  Sequenzdiagramm', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 10_Datenmodelle erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '10_Datenmodelle erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '10_Datenmodelle erstellen können', 10, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/10_Datenmodelle_erstellen_koennen/10_Datenmodelle_erstellen_koennen.pdf', 'In diesem Modul "Datenmodelle erstellen können" werden folgende Inhalte behandelt:  ER-Model! • Relationales Model! Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 11_Normalisierung anwenden können (1. bi
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '11_Normalisierung anwenden können (1. bis 3. Normalform)' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '11_Normalisierung anwenden können (1. bis 3. Normalform)', 11, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/11_Normalisierung_anwenden_koennen_1._bis_3._Normalform/11_Normalisierung_anwenden_koennen_1._bis_3._Normalform.pdf', 'In diesem Modul "Normalisierung anwenden können (1. bis 3. Normalform)" werden folgende Inhalte behandelt:  Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 12_Architektur und Design Pattern anwend
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '12_Architektur und Design Pattern anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '12_Architektur und Design Pattern anwenden können', 12, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/12_Architektur_und_Design_Pattern_anwenden_koennen/12_Architektur_und_Design_Pattern_anwenden_koennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Architektur und Design Pattern anwenden können".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 13_Anforderungen an die Softwareergonomi
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '13_Anforderungen an die Softwareergonomie benennen und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '13_Anforderungen an die Softwareergonomie benennen und beurteilen können', 13, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/13_Anforderungen_an_die_Softwareergonomie_benennen_und_beurteilen_koennen/13_Anforderungen_an_die_Softwareergonomie_benennen_und_beurteilen_koennen.pdf', 'In diesem Modul "Anforderungen an die Softwareergonomie benennen und beurteilen können" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 14_Benutzeroberfläche gestalten können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '14_Benutzeroberfläche gestalten können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '14_Benutzeroberfläche gestalten können', 14, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/14_Benutzeroberflaeche_gestalten_koennen/14_Benutzeroberflaeche_gestalten_koennen.pdf', 'In diesem Modul "Benutzeroberfläche gestalten können" werden folgende Inhalte behandelt:  Usability  - User-Experience', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 15_Prototypen (Mockups) erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '15_Prototypen (Mockups) erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '15_Prototypen (Mockups) erstellen können', 15, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/15_Prototypen_Mockups_erstellen_koennen/15_Prototypen_Mockups_erstellen_koennen.pdf', 'In diesem Modul "Prototypen (Mockups) erstellen können" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 16_Algorithmen erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '16_Algorithmen erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '16_Algorithmen erstellen können', 16, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/16_Algorithmen_erstellen_koennen/16_Algorithmen_erstellen_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Pseudocode', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 17_Objektorientierte Programmiermethoden
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '17_Objektorientierte Programmiermethodenkonzepte anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '17_Objektorientierte Programmiermethodenkonzepte anwenden können', 17, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/17_Objektorientierte_Programmiermethodenkonzepte_anwenden_koennen/17_Objektorientierte_Programmiermethodenkonzepte_anwenden_koennen.pdf', 'In diesem Modul "Objektorientierte Programmiermethodenkonzepte anwenden können" werden folgende Inhalte behandelt:  Kapselung  Vererbung  Polymorphie  Interfaces  Allgemeine Fehlerbehandlung in Programmen Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 18_Einfache Such- und Sortier-Algorithme
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '18_Einfache Such- und Sortier-Algorithmen kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '18_Einfache Such- und Sortier-Algorithmen kennen', 18, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/18_Einfache_Such-_und_Sortier-Algorithmen_kennen/18_Einfache_Such-_und_Sortier-Algorithmen_kennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Einfache Such- und Sortier-Algorithmen kennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 19_Bestehende Funktionen, Klassen erweit
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '19_Bestehende Funktionen, Klassen erweitern' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '19_Bestehende Funktionen, Klassen erweitern', 19, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/19_Bestehende_Funktionen_Klassen_erweitern/19_Bestehende_Funktionen_Klassen_erweitern.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Bestehende Funktionen, Klassen erweitern".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 20_Dateiformate zum Datenaustausch anwen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '20_Dateiformate zum Datenaustausch anwenden können und deren Einsatzbereiche kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '20_Dateiformate zum Datenaustausch anwenden können und deren Einsatzbereiche kennen', 20, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/20_Dateiformate_zum_Datenaustausch_anwenden_koennen_und_deren_Einsatzbereiche_kennen/20_Dateiformate_zum_Datenaustausch_anwenden_koennen_und_deren_Einsatzbereiche.pdf', 'In diesem Modul "Dateiformate zum Datenaustausch anwenden können und deren Einsatzbereiche kennen" werden folgende Inhalte behandelt:  csv  XML  JSON Enabler Onedrive link:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 21_Möglichkeiten zur Nutzung von Service
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '21_Möglichkeiten zur Nutzung von Services und Ressourcen eines Servers kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '21_Möglichkeiten zur Nutzung von Services und Ressourcen eines Servers kennen', 21, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/21_Moeglichkeiten_zur_Nutzung_von_Services_und_Ressourcen_eines_Servers_kennen/21_Moeglichkeiten_zur_Nutzung_von_Services_und_Ressourcen_eines_Servers_kennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Möglichkeiten zur Nutzung von Services und Ressourcen eines Servers kennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 22_Datenbankabfrage, Datenpflege mit SQL
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '22_Datenbankabfrage, Datenpflege mit SQL erstel- len können Verweis auf Belegsatz' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '22_Datenbankabfrage, Datenpflege mit SQL erstel- len können Verweis auf Belegsatz', 22, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_und_Umsetzen_von_Softwareanwendungen_par_4_Abs._3_Nr._1/22_Datenbankabfrage_Datenpflege_mit_SQL_erstel-_len_koennen_Verweis_auf_Belegsatz/22_Datenbankabfrage_Datenpflege_mit_SQL_erstel-_len_koennen_Verweis_auf_Belegs.pdf', 'In diesem Modul "Datenbankabfrage, Datenpflege mit SQL erstel- len können Verweis auf Belegsatz" werden folgende Inhalte behandelt:  Tabellenstruktur (CREATE TABLE,ALTERTABLE)   Index (CREATEINDEX)   Manipulation (INSERT,UPDATE,DELETE)   Projektion(SELECTFROM)   Selektion (SELECT FROM... WHERE) und (SELECT... (SELECT...))     Sortieren (ORDER BY)   Gruppieren (GROUP BY, HAVING)   Abfrage uber mehrere Tabellen Ausdrucke und Bedingungen Aggregatfunktionen   Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Course: Konzipieren von Softwareanwendungen (Vertiefung) (
  SELECT id INTO course_id FROM courses WHERE title = 'Konzipieren von Softwareanwendungen (Vertiefung) (§ 4 Abs. 3 Nr. 1  J2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Konzipieren von Softwareanwendungen (Vertiefung) (§ 4 Abs. 3 Nr. 1  J2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Lasten-Pflichtenheft erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Lasten-Pflichtenheft erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Lasten-Pflichtenheft erstellen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/01_Lasten-Pflichtenheft_erstellen_koennen/01_Lasten-Pflichtenheft_erstellen_koennen.pdf', 'In diesem Modul "Lasten-Pflichtenheft erstellen können" werden folgende Inhalte behandelt:  Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Vorgehensmodelle unterscheiden können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Vorgehensmodelle unterscheiden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Vorgehensmodelle unterscheiden können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/02_Vorgehensmodelle_unterscheiden_koennen/02_Vorgehensmodelle_unterscheiden_koennen.pdf', 'In diesem Modul "Vorgehensmodelle unterscheiden können" werden folgende Inhalte behandelt:  Klassische Modelle, z. B. • Wasserfallmodell • Spiralmodell • V-Modell AgileModelle, z. B. • Scrum', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Strukturierte Analyse- und Designverf
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Strukturierte Analyse- und Designverfahren anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Strukturierte Analyse- und Designverfahren anwenden können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/03_Strukturierte_Analyse-_und_Designverfahren_anwenden_koennen/03_Strukturierte_Analyse-_und_Designverfahren_anwenden_koennen.pdf', 'In diesem Modul "Strukturierte Analyse- und Designverfahren anwenden können" werden folgende Inhalte behandelt:  Top-down-Entwurf Bottom-up-Entwurf  Modularisierung ENabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Objektorientierte Analyse- und Design
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Objektorientierte Analyse- und Designverfahren anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Objektorientierte Analyse- und Designverfahren anwenden können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/04_Objektorientierte_Analyse-_und_Designverfahren_anwenden_koennen/04_Objektorientierte_Analyse-_und_Designverfahren_anwenden_koennen.pdf', 'In diesem Modul "Objektorientierte Analyse- und Designverfahren anwenden können" werden folgende Inhalte behandelt:  Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Programmspezifikationen_festlegen,_Da
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Programmspezifikationen_festlegen,_Datenmodelle' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Programmspezifikationen_festlegen,_Datenmodelle', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/05_Programmspezifikationen_festlegen_Datenmodelle/05_Programmspezifikationen_festlegen_Datenmodelle.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Programmspezifikationen_festlegen,_Datenmodelle".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Konzepte von Programmiersprachen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Konzepte von Programmiersprachen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Konzepte von Programmiersprachen', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/06_Konzepte_von_Programmiersprachen/06_Konzepte_von_Programmiersprachen.pdf', 'In diesem Modul "Konzepte von Programmiersprachen" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Software-Entwicklungswerkzeuge aufgab
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Software-Entwicklungswerkzeuge aufgabenbezogen auswählen und anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Software-Entwicklungswerkzeuge aufgabenbezogen auswählen und anwenden können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/07_Software-Entwicklungswerkzeuge_aufgabenbezogen_auswaehlen_und_anwenden_koennen/07_Software-Entwicklungswerkzeuge_aufgabenbezogen_auswaehlen_und_anwenden_koennen.pdf', 'In diesem Modul "Software-Entwicklungswerkzeuge aufgabenbezogen auswählen und anwenden können" werden folgende Inhalte behandelt:  Abbildung der Kontrollstrukturen, z. B. Verzwei­ gungen, Schleife, mittels Pseudocode UML (Use Case bzw. Anwendungsfalldiagramm, Klassendiagramm, Aktivitatsdiagramm) Entwurf der Bildschirmausgabemasken (Software­ ergonomie, Corporate Identity, Barrierefreiheit) Fehler in einem gegebenen Quellcode finden Schreibtischtest mit einem gegebenen Quellcode durchfuhren', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Einsatzmöglichkeiten von Programmiers
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Einsatzmöglichkeiten von Programmiersprachen kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Einsatzmöglichkeiten von Programmiersprachen kennen', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/08_Einsatzmoeglichkeiten_von_Programmiersprachen_kennen/08_Einsatzmoeglichkeiten_von_Programmiersprachen_kennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Einsatzmöglichkeiten von Programmiersprachen kennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 09_UML-Diagramme erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '09_UML-Diagramme erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '09_UML-Diagramme erstellen können', 9, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/09_UML-Diagramme_erstellen_koennen/09_UML-Diagramme_erstellen_koennen.pdf', 'In diesem Modul "UML-Diagramme erstellen können" werden folgende Inhalte behandelt:  Klassendiagramm  Anwendungsfalldiagramm  Zustandsdiagramm  Aktivitatsdiagramm  Sequenzdiagramm', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 10_Datenmodelle erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '10_Datenmodelle erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '10_Datenmodelle erstellen können', 10, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/10_Datenmodelle_erstellen_koennen/10_Datenmodelle_erstellen_koennen.pdf', 'In diesem Modul "Datenmodelle erstellen können" werden folgende Inhalte behandelt:  ER-Model! • Relationales Model! Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 11_Normalisierung anwenden können (1. bi
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '11_Normalisierung anwenden können (1. bis 3. Normalform)' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '11_Normalisierung anwenden können (1. bis 3. Normalform)', 11, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/11_Normalisierung_anwenden_koennen_1._bis_3._Normalform/11_Normalisierung_anwenden_koennen_1._bis_3._Normalform.pdf', 'In diesem Modul "Normalisierung anwenden können (1. bis 3. Normalform)" werden folgende Inhalte behandelt:  Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 12_Architektur und Design Pattern anwend
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '12_Architektur und Design Pattern anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '12_Architektur und Design Pattern anwenden können', 12, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/12_Architektur_und_Design_Pattern_anwenden_koennen/12_Architektur_und_Design_Pattern_anwenden_koennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Architektur und Design Pattern anwenden können".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 13_Anforderungen an die Softwareergonomi
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '13_Anforderungen an die Softwareergonomie benennen und beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '13_Anforderungen an die Softwareergonomie benennen und beurteilen können', 13, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/13_Anforderungen_an_die_Softwareergonomie_benennen_und_beurteilen_koennen/13_Anforderungen_an_die_Softwareergonomie_benennen_und_beurteilen_koennen.pdf', 'In diesem Modul "Anforderungen an die Softwareergonomie benennen und beurteilen können" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 14_Benutzeroberfläche gestalten können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '14_Benutzeroberfläche gestalten können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '14_Benutzeroberfläche gestalten können', 14, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/14_Benutzeroberflaeche_gestalten_koennen/14_Benutzeroberflaeche_gestalten_koennen.pdf', 'In diesem Modul "Benutzeroberfläche gestalten können" werden folgende Inhalte behandelt:  Usability  - User-Experience', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 15_Prototypen (Mockups) erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '15_Prototypen (Mockups) erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '15_Prototypen (Mockups) erstellen können', 15, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/15_Prototypen_Mockups_erstellen_koennen/15_Prototypen_Mockups_erstellen_koennen.pdf', 'In diesem Modul "Prototypen (Mockups) erstellen können" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 16_Algorithmen erstellen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '16_Algorithmen erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '16_Algorithmen erstellen können', 16, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/16_Algorithmen_erstellen_koennen/16_Algorithmen_erstellen_koennen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Pseudocode', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 17_Objektorientierte Programmiermethoden
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '17_Objektorientierte Programmiermethodenkonzepte anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '17_Objektorientierte Programmiermethodenkonzepte anwenden können', 17, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/17_Objektorientierte_Programmiermethodenkonzepte_anwenden_koennen/17_Objektorientierte_Programmiermethodenkonzepte_anwenden_koennen.pdf', 'In diesem Modul "Objektorientierte Programmiermethodenkonzepte anwenden können" werden folgende Inhalte behandelt:  Kapselung  Vererbung  Polymorphie  Interfaces  Allgemeine Fehlerbehandlung in Programmen Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 18_Einfache Such- und Sortier-Algorithme
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '18_Einfache Such- und Sortier-Algorithmen kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '18_Einfache Such- und Sortier-Algorithmen kennen', 18, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/18_Einfache_Such-_und_Sortier-Algorithmen_kennen/18_Einfache_Such-_und_Sortier-Algorithmen_kennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Einfache Such- und Sortier-Algorithmen kennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 19_Bestehende Funktionen, Klassen erweit
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '19_Bestehende Funktionen, Klassen erweitern' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '19_Bestehende Funktionen, Klassen erweitern', 19, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/19_Bestehende_Funktionen_Klassen_erweitern/19_Bestehende_Funktionen_Klassen_erweitern.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Bestehende Funktionen, Klassen erweitern".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 20_Dateiformate zum Datenaustausch anwen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '20_Dateiformate zum Datenaustausch anwenden können und deren Einsatzbereiche kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '20_Dateiformate zum Datenaustausch anwenden können und deren Einsatzbereiche kennen', 20, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/20_Dateiformate_zum_Datenaustausch_anwenden_koennen_und_deren_Einsatzbereiche_kennen/20_Dateiformate_zum_Datenaustausch_anwenden_koennen_und_deren_Einsatzbereiche.pdf', 'In diesem Modul "Dateiformate zum Datenaustausch anwenden können und deren Einsatzbereiche kennen" werden folgende Inhalte behandelt:  csv  XML  JSON Enabler Onedrive link:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 21_Möglichkeiten zur Nutzung von Service
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '21_Möglichkeiten zur Nutzung von Services und Ressourcen eines Servers kennen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '21_Möglichkeiten zur Nutzung von Services und Ressourcen eines Servers kennen', 21, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/21_Moeglichkeiten_zur_Nutzung_von_Services_und_Ressourcen_eines_Servers_kennen/21_Moeglichkeiten_zur_Nutzung_von_Services_und_Ressourcen_eines_Servers_kennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Möglichkeiten zur Nutzung von Services und Ressourcen eines Servers kennen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 22_Datenbankabfrage, Datenpflege mit SQL
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '22_Datenbankabfrage, Datenpflege mit SQL erstel- len können Verweis auf Belegsatz' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '22_Datenbankabfrage, Datenpflege mit SQL erstel- len können Verweis auf Belegsatz', 22, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Konzipieren_von_Softwareanwendungen_Vertiefung_par_4_Abs._3_Nr._1_J2/22_Datenbankabfrage_Datenpflege_mit_SQL_erstel-_len_koennen_Verweis_auf_Belegsatz/22_Datenbankabfrage_Datenpflege_mit_SQL_erstel-_len_koennen_Verweis_auf_Belegs.pdf', 'In diesem Modul "Datenbankabfrage, Datenpflege mit SQL erstel- len können Verweis auf Belegsatz" werden folgende Inhalte behandelt:  Tabellenstruktur (CREATE TABLE,ALTERTABLE)   Index (CREATEINDEX)   Manipulation (INSERT,UPDATE,DELETE)   Projektion(SELECTFROM)   Selektion (SELECT FROM... WHERE) und (SELECT... (SELECT...))     Sortieren (ORDER BY)   Gruppieren (GROUP BY, HAVING)   Abfrage uber mehrere Tabellen Ausdrucke und Bedingungen Aggregatfunktionen   Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Course: Maßnahmen zur IT-Sicherheit und zum Datenschutz (§
  SELECT id INTO course_id FROM courses WHERE title = 'Maßnahmen zur IT-Sicherheit und zum Datenschutz (§ 4 Abs. 2 Nr. 6)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Maßnahmen zur IT-Sicherheit und zum Datenschutz (§ 4 Abs. 2 Nr. 6)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Regelungen zur IT-Sicherheit auf Grun
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Regelungen zur IT-Sicherheit auf Grundschutz' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Regelungen zur IT-Sicherheit auf Grundschutz', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Massnahmen_zur_IT-Sicherheit_und_zum_Datenschutz_par_4_Abs._2_Nr._6/01_Regelungen_zur_IT-Sicherheit_auf_Grundschutz/01_Regelungen_zur_IT-Sicherheit_auf_Grundschutz.pdf', 'In diesem Modul "Regelungen zur IT-Sicherheit auf Grundschutz" werden folgende Inhalte behandelt:  Gewahrleistung van Verfugbarkeit, Vertraulichkeit und lntegritat der Daten MaBnahmen zur lnformationssicherheit • Technisch organisatorische MaBnahmen (TOM) • Unterscheidung van IT-Sicherheitsbeauftragtem und Datenschutzbeauftragtem im Betrieb • Erlauterung van IT-Sicherheitsrichtlinien wie Passwort-Policy • Benennung van technischen MaBnahmen, z. B. Virenschutz, Personal Firewall,Verschlusselung (', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Schutzbedarfsanalyse im eigenen Arbei
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Schutzbedarfsanalyse im eigenen Arbeitsbereich aufgrund betrieblicher Vorgaben durchführen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Schutzbedarfsanalyse im eigenen Arbeitsbereich aufgrund betrieblicher Vorgaben durchführen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Massnahmen_zur_IT-Sicherheit_und_zum_Datenschutz_par_4_Abs._2_Nr._6/02_Schutzbedarfsanalyse_im_eigenen_Arbeitsbereich_aufgrund_betrieblicher_Vorgaben_durchfuehren/02_Schutzbedarfsanalyse_im_eigenen_Arbeitsbereich_aufgrund_betriebl.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Schutzbedarfsanalyse im eigenen Arbeitsbereich aufgrund betrieblicher Vorgaben durchführen".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Modellierung eines arbeitsplatzbezoge
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Modellierung eines arbeitsplatzbezogenen Sicherheitskonzept nach BSI IT Grundschutz' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Modellierung eines arbeitsplatzbezogenen Sicherheitskonzept nach BSI IT Grundschutz', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Massnahmen_zur_IT-Sicherheit_und_zum_Datenschutz_par_4_Abs._2_Nr._6/03_Modellierung_eines_arbeitsplatzbezogenen_Sicherheitskonzept_nach_BSI_IT_Grundschutz/03_Modellierung_eines_arbeitsplatzbezogenen_Sicherheitskonzept_nach_BSI_IT.pdf', 'In diesem Modul "Modellierung eines arbeitsplatzbezogenen Sicherheitskonzept nach BSI IT Grundschutz" werden folgende Inhalte behandelt:  Bausteine aus dem Grundschutzkatalog Schutzbedarfskategorien (normal, hoch, sehr hoch) ableiten und begrunden Risiko-Klassifikation, z. B. mit Matrix lnformations-Sicherheitsmanagementsystem (ISMS) kennen und unterstutzen', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Umsetzung des arbeitsplatzbezogenen S
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Umsetzung des arbeitsplatzbezogenen Sicherheitskonzeptes unterstützen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Umsetzung des arbeitsplatzbezogenen Sicherheitskonzeptes unterstützen können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Massnahmen_zur_IT-Sicherheit_und_zum_Datenschutz_par_4_Abs._2_Nr._6/04_Umsetzung_des_arbeitsplatzbezogenen_Sicherheitskonzeptes_unterstuetzen_koennen/04_Umsetzung_des_arbeitsplatzbezogenen_Sicherheitskonzeptes_unterstuetzen_koennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Umsetzung des arbeitsplatzbezogenen Sicherheitskonzeptes unterstützen können".', true, NOW(), NOW());
  END IF;
  
  -- Course: Planen, Vorbereiten und Durchführen von Arbeitsauf
  SELECT id INTO course_id FROM courses WHERE title = 'Planen, Vorbereiten und Durchführen von Arbeitsaufgaben (§ 4 Abs. 2 Nr. 1)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Planen, Vorbereiten und Durchführen von Arbeitsaufgaben (§ 4 Abs. 2 Nr. 1)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Merkmale und Methoden des Projektmana
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Merkmale und Methoden des Projektmanagements' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Merkmale und Methoden des Projektmanagements', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Planen_Vorbereiten_und_Durchfuehren_von_Arbeitsaufgaben_par_4_Abs._2_Nr._1/01_Merkmale_und_Methoden_des_Projektmanagements/01_Merkmale_und_Methoden_des_Projektmanagements.pdf', 'In diesem Modul "Merkmale und Methoden des Projektmanagements" werden folgende Inhalte behandelt:  Merkmale eines Projektes Projektplanung mithilfe van Strukturplan, Netzplan und Gantt-Diagramm • kritischer Weg • Pufferzeiten • fristgerechte Terminierung • Liisungsmiiglichkeiten bei Terminproblemen • SMART-Prinzip • Meilenstein Projektphasen am Beispiel des Wasserfallmodells bzw. SCRUM definieren kiinnen Phasen der Teambildung und -entwicklung kennen Reflektionsmethoden kennen, z. B. Feedback-Ku', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Machbarkeit und Wirtschaftlichkeit vo
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Machbarkeit und Wirtschaftlichkeit von Pro- jekten beurteilen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Machbarkeit und Wirtschaftlichkeit von Pro- jekten beurteilen können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Planen_Vorbereiten_und_Durchfuehren_von_Arbeitsaufgaben_par_4_Abs._2_Nr._1/02_Machbarkeit_und_Wirtschaftlichkeit_von_Pro-_jekten_beurteilen_koennen/02_Machbarkeit_und_Wirtschaftlichkeit_von_Pro-_jekten_beurteilen_koennen.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Machbarkeit und Wirtschaftlichkeit von Pro- jekten beurteilen können".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Arbeitsaufgaben im Rahmen von Geschäf
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Arbeitsaufgaben im Rahmen von Geschäfts- und Leistungsprozessen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Arbeitsaufgaben im Rahmen von Geschäfts- und Leistungsprozessen', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Planen_Vorbereiten_und_Durchfuehren_von_Arbeitsaufgaben_par_4_Abs._2_Nr._1/03_Arbeitsaufgaben_im_Rahmen_von_Geschaefts-_und_Leistungsprozessen/03_Arbeitsaufgaben_im_Rahmen_von_Geschaefts-_und_Leistungsprozessen.pdf', 'In diesem Modul "Arbeitsaufgaben im Rahmen von Geschäfts- und Leistungsprozessen" werden folgende Inhalte behandelt:  Kundenkommunikation Fehlermanagement Störungs-Management Bearbeitungsstatus, z. B. mittels Ticketsystem KI-Unterstützung Support- und Serviceanfragen (First-, Second- und Third- Levelsupport) Enabler erstellt (Link zum Enabler: )', true, NOW(), NOW());
  END IF;
  
  -- Course: Programmieren von Softwarelösungen (Vertiefung) (§
  SELECT id INTO course_id FROM courses WHERE title = 'Programmieren von Softwarelösungen (Vertiefung) (§ 4 Abs. 2 Nr. 10  J2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Programmieren von Softwarelösungen (Vertiefung) (§ 4 Abs. 2 Nr. 10  J2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Softwareanforderungen erfassen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Softwareanforderungen erfassen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Softwareanforderungen erfassen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/01_Softwareanforderungen_erfassen_koennen/01_Softwareanforderungen_erfassen_koennen.pdf', 'In diesem Modul "Softwareanforderungen erfassen können" werden folgende Inhalte behandelt:  Anderbarkeit/Erweiterbarkeit  Benutzbarkeit Effizienz  Funktionalitat  Obertragbarkeit  Zuverlassigkeit  Wartbarkeit  Normen anwenden', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Planen mit geeigneten Modellen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Planen mit geeigneten Modellen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Planen mit geeigneten Modellen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/02_Planen_mit_geeigneten_Modellen/02_Planen_mit_geeigneten_Modellen.pdf', 'In diesem Modul "Planen mit geeigneten Modellen" werden folgende Inhalte behandelt:  ERM Relationales Datenbankmodell  UML-Klassendiagramm Mock up UML-Aktivitatsdiagramm UML-Anwendungsfalldiagramm  UML-Sequenzdiagramm UML-Zustandsdiagramm (FI AE) Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Festlegen von Schnittstellen und vorh
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Festlegen von Schnittstellen und vorhandene Schnittstellen nutzen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Festlegen von Schnittstellen und vorhandene Schnittstellen nutzen', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/03_Festlegen_von_Schnittstellen_und_vorhandene_Schnittstellen_nutzen/03_Festlegen_von_Schnittstellen_und_vorhandene_Schnittstellen_nutzen.pdf', 'In diesem Modul "Festlegen von Schnittstellen und vorhandene Schnittstellen nutzen" werden folgende Inhalte behandelt:  Datenaustauschformate (XML, JSON ...)  SQL API, z. B. REST', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Situationsgerechte Auswahl einer pass
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Situationsgerechte Auswahl einer passenden Programmiersprache begründen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Situationsgerechte Auswahl einer passenden Programmiersprache begründen können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begruenden_koennen/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begruenden_koennen.pdf', 'In diesem Modul "Situationsgerechte Auswahl einer passenden Programmiersprache begründen können" werden folgende Inhalte behandelt:  Performance, Speicherverbrauch  Portabilitat  Framework/Bibliotheken', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Algorithmen in einer Programmiersprac
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Algorithmen in einer Programmiersprache darstellen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Algorithmen in einer Programmiersprache darstellen', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/05_Algorithmen_in_einer_Programmiersprache_darstellen/05_Algorithmen_in_einer_Programmiersprache_darstellen.pdf', 'In diesem Modul "Algorithmen in einer Programmiersprache darstellen" werden folgende Inhalte behandelt:  Die Darstellung soil in allgemein verstandlichem Programm- oder Pseudocode erfolgen. Im Prufungskontext muss der Code nicht 1:1 kompilier­ bar sein, Syntaxfehler werden toleriert. Kontrollstrukturen (z. B. durch Einrucken) mussen ersichtlich sein.', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Cyber-physische Systeme beschreiben u
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Cyber-physische Systeme beschreiben und erweitern können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Cyber-physische Systeme beschreiben und erweitern können', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/06_Cyber-physische_Systeme_beschreiben_und_erweitern_koennen/06_Cyber-physische_Systeme_beschreiben_und_erweitern_koennen.pdf', 'In diesem Modul "Cyber-physische Systeme beschreiben und erweitern können" werden folgende Inhalte behandelt:  CPS-Software Auswahl von geeigneten Sensoren/Aktoren  Nutzung von Bibliotheken  Abfragerhythmus planen Kenntnis des Zugriffs auf Sensoren und Aktoren', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Wiederkehrende Systemabläufe mithilfe
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Wiederkehrende Systemabläufe mithilfe von Skripten automatisieren und überwachen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Wiederkehrende Systemabläufe mithilfe von Skripten automatisieren und überwachen können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/07_Wiederkehrende_Systemablaeufe_mithilfe_von_Skripten_automatisieren_und_ueberwachen_koennen/07_Wiederkehrende_Systemablaeufe_mithilfe_von_Skripten_automatisieren_und_ueberwache.pdf', 'In diesem Modul "Wiederkehrende Systemabläufe mithilfe von Skripten automatisieren und überwachen können" werden folgende Inhalte behandelt:  Shellprogrammierung, z. B. PowerShell, Bash • Skriptprogrammierung, z. B. Python', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Qualitätssicherung und Tests
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Qualitätssicherung und Tests' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Qualitätssicherung und Tests', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_Vertiefung_par_4_Abs._2_Nr._10_J2/08_Qualitaetssicherung_und_Tests/08_Qualitaetssicherung_und_Tests.pdf', 'In diesem Modul "Qualitätssicherung und Tests" werden folgende Inhalte behandelt:  Black Box-/White Box-Tests Grundsatzliches Vorgehen beim Testen, z. B. print­ Debugging, TDD, Unit-Test, E2E Test', true, NOW(), NOW());
  END IF;
  
  -- Course: Programmieren von Softwarelösungen (§ 4 Abs. 2 Nr.
  SELECT id INTO course_id FROM courses WHERE title = 'Programmieren von Softwarelösungen (§ 4 Abs. 2 Nr. 10)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Programmieren von Softwarelösungen (§ 4 Abs. 2 Nr. 10)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Softwareanforderungen erfassen können
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Softwareanforderungen erfassen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Softwareanforderungen erfassen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/01_Softwareanforderungen_erfassen_koennen/01_Softwareanforderungen_erfassen_koennen.pdf', 'In diesem Modul "Softwareanforderungen erfassen können" werden folgende Inhalte behandelt:  Anderbarkeit/Erweiterbarkeit  Benutzbarkeit Effizienz  Funktionalitat  Obertragbarkeit  Zuverlassigkeit  Wartbarkeit  Normen anwenden', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Planen mit geeigneten Modellen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Planen mit geeigneten Modellen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Planen mit geeigneten Modellen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/02_Planen_mit_geeigneten_Modellen/02_Planen_mit_geeigneten_Modellen.pdf', 'In diesem Modul "Planen mit geeigneten Modellen" werden folgende Inhalte behandelt:  ERM Relationales Datenbankmodell  UML-Klassendiagramm Mock up UML-Aktivitatsdiagramm UML-Anwendungsfalldiagramm  UML-Sequenzdiagramm UML-Zustandsdiagramm (FI AE) Link zum Dokument:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Festlegen von Schnittstellen und vorh
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Festlegen von Schnittstellen und vorhandene Schnittstellen nutzen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Festlegen von Schnittstellen und vorhandene Schnittstellen nutzen', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/03_Festlegen_von_Schnittstellen_und_vorhandene_Schnittstellen_nutzen/03_Festlegen_von_Schnittstellen_und_vorhandene_Schnittstellen_nutzen.pdf', 'In diesem Modul "Festlegen von Schnittstellen und vorhandene Schnittstellen nutzen" werden folgende Inhalte behandelt:  Datenaustauschformate (XML, JSON ...)  SQL API, z. B. REST', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Situationsgerechte Auswahl einer pass
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Situationsgerechte Auswahl einer passenden Programmiersprache begründen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Situationsgerechte Auswahl einer passenden Programmiersprache begründen können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begruenden_koennen/04_Situationsgerechte_Auswahl_einer_passenden_Programmiersprache_begruenden_koennen.pdf', 'In diesem Modul "Situationsgerechte Auswahl einer passenden Programmiersprache begründen können" werden folgende Inhalte behandelt:  Performance, Speicherverbrauch  Portabilitat  Framework/Bibliotheken', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Algorithmen in einer Programmiersprac
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Algorithmen in einer Programmiersprache darstellen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Algorithmen in einer Programmiersprache darstellen', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/05_Algorithmen_in_einer_Programmiersprache_darstellen/05_Algorithmen_in_einer_Programmiersprache_darstellen.pdf', 'In diesem Modul "Algorithmen in einer Programmiersprache darstellen" werden folgende Inhalte behandelt:  Die Darstellung soil in allgemein verstandlichem Programm- oder Pseudocode erfolgen. Im Prufungskontext muss der Code nicht 1:1 kompilier­ bar sein, Syntaxfehler werden toleriert. Kontrollstrukturen (z. B. durch Einrucken) mussen ersichtlich sein.', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Cyber-physische Systeme beschreiben u
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Cyber-physische Systeme beschreiben und erweitern können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Cyber-physische Systeme beschreiben und erweitern können', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/06_Cyber-physische_Systeme_beschreiben_und_erweitern_koennen/06_Cyber-physische_Systeme_beschreiben_und_erweitern_koennen.pdf', 'In diesem Modul "Cyber-physische Systeme beschreiben und erweitern können" werden folgende Inhalte behandelt:  CPS-Software Auswahl von geeigneten Sensoren/Aktoren  Nutzung von Bibliotheken  Abfragerhythmus planen Kenntnis des Zugriffs auf Sensoren und Aktoren', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Wiederkehrende Systemabläufe mithilfe
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Wiederkehrende Systemabläufe mithilfe von Skripten automatisieren und überwachen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Wiederkehrende Systemabläufe mithilfe von Skripten automatisieren und überwachen können', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/07_Wiederkehrende_Systemablaeufe_mithilfe_von_Skripten_automatisieren_und_ueberwachen_koennen/07_Wiederkehrende_Systemablaeufe_mithilfe_von_Skripten_automatisieren_und_ueberwache.pdf', 'In diesem Modul "Wiederkehrende Systemabläufe mithilfe von Skripten automatisieren und überwachen können" werden folgende Inhalte behandelt:  Shellprogrammierung, z. B. PowerShell, Bash • Skriptprogrammierung, z. B. Python', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Qualitätssicherung und Tests
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Qualitätssicherung und Tests' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Qualitätssicherung und Tests', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Programmieren_von_Softwareloesungen_par_4_Abs._2_Nr._10/08_Qualitaetssicherung_und_Tests/08_Qualitaetssicherung_und_Tests.pdf', 'In diesem Modul "Qualitätssicherung und Tests" werden folgende Inhalte behandelt:  Black Box-/White Box-Tests Grundsatzliches Vorgehen beim Testen, z. B. print­ Debugging, TDD, Unit-Test, E2E Test', true, NOW(), NOW());
  END IF;
  
  -- Course: Sicherheit und Gesundheitsschutz bei der Arbeit (§
  SELECT id INTO course_id FROM courses WHERE title = 'Sicherheit und Gesundheitsschutz bei der Arbeit (§ 4 Abs. 7 Nr. 3)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Sicherheit und Gesundheitsschutz bei der Arbeit (§ 4 Abs. 7 Nr. 3)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Gesundheits- und Arbeitsschutzvorschr
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Gesundheits- und Arbeitsschutzvorschriften' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Gesundheits- und Arbeitsschutzvorschriften', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/01_Gesundheits-_und_Arbeitsschutzvorschriften/01_Gesundheits-_und_Arbeitsschutzvorschriften.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Arbeitsschutzgesetz • Arbeitssicherheitsgesetz  • Arbeitszeitgesetz • Betriebssicherheitsverordnung • Arbeitsstattenverordnung  • Unfallverhutungsvorschriften(UVV)  • Arbeitsplatzergonomie • Bildschirmarbeitsplatzverordnung • Aufsichtsbehbrde fur Arbeitsschutz (Gewerbeauf­ sicht) • Jugendarbeitsschutzgesetz Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Gefährdungen und Beanspruchungen wahr
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Gefährdungen und Beanspruchungen wahrnehmen und einschätzen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Gefährdungen und Beanspruchungen wahrnehmen und einschätzen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/02_Gefaehrdungen_und_Beanspruchungen_wahrnehmen_und_einschaetzen/02_Gefaehrdungen_und_Beanspruchungen_wahrnehmen_und_einschaetzen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Mechanisch, elektrisch, thermisch, chemisch • Ergonomisch, akustisch, psychisch • Gefahren beachten und ggf. melden  • Sicherheitshinweise, Vorschriften und Anweisungen beachten • Besondere Fürsorgepflicht des Arbeitgebers • Ersthelfer am Arbeitsplatz • Ergonomische Arbeitsplatzgestaltung Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Vorsorgeuntersuchungen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Vorsorgeuntersuchungen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Vorsorgeuntersuchungen', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/03_Vorsorgeuntersuchungen/03_Vorsorgeuntersuchungen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Augenuntersuchung fur Bildschirmarbeitsplatze • Psychische Gefahrdungsbeurteilung', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Aufgaben der Sicherheitsbeauftragten
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Aufgaben der Sicherheitsbeauftragten' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Aufgaben der Sicherheitsbeauftragten', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/04_Aufgaben_der_Sicherheitsbeauftragten/04_Aufgaben_der_Sicherheitsbeauftragten.pdf', 'In diesem Modul "Aufgaben der Sicherheitsbeauftragten" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Vorschriften im betrieblichen und per
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Vorschriften im betrieblichen und persönlichen Arbeitsablauf' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Vorschriften im betrieblichen und persönlichen Arbeitsablauf', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/05_Vorschriften_im_betrieblichen_und_persoenlichen_Arbeitsablauf/05_Vorschriften_im_betrieblichen_und_persoenlichen_Arbeitsablauf.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Sachgerechter Umgang mit Gefahrenpotenzialen  • Allgemeine und betriebliche Verhaltensregeln  • Wissen Ober Fluchtwege • Notausgange (Kennzeichnung)  • Im Gebaude/am Arbeitsplatz • Schutzarten elektrischer Betriebsmittel  • Schutzklassen • Prufzeichen, z. B. CE-Zeichen • Schriften, Farben und Zeichen des Arbeitsschutzes Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Verhaltensweisen bei Unfällen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Verhaltensweisen bei Unfällen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Verhaltensweisen bei Unfällen', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/06_Verhaltensweisen_bei_Unfaellen/06_Verhaltensweisen_bei_Unfaellen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Erste-Hilfe-MaBnahmen • Ersthelfer, Notruf- und Natfallnummern • Meldeketten • Fluchtwege und Sammelplatze  • Evakuierung und Dakumentatian • Meldepflicht von Un/alien', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Verhaltensweisen im Brandfall sowie v
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Verhaltensweisen im Brandfall sowie vorbeugender Brandschutz' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Verhaltensweisen im Brandfall sowie vorbeugender Brandschutz', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/07_Verhaltensweisen_im_Brandfall_sowie_vorbeugender_Brandschutz/07_Verhaltensweisen_im_Brandfall_sowie_vorbeugender_Brandschutz.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Brandursachen durch brennbare Stoffe und Hitzeent­ wicklung, z. B. ~nicht ausgeschaltete HeiBwasserkocher und Kaffeemaschinen~ • Brandschutzordnung  • Verhalten in Brandfällen, z. B. ~Verbot zur Fahrstuhlnutzung~ ~SchlieBenvan Türen und Fenstern im Gebäude/ am Arbeitsplatz~ • Brandschutzmittel ~Feuerlöscher (Standort, Bedienungsanleitung, Wirkungsweise),~ ~Löschdecken~ • Sammelplatze • Flucht- und Rettungswege  • Sicherheitszeichen  • Brandschutzkla', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 08_Grundlagen der IT-Sicherheit kennen u
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '08_Grundlagen der IT-Sicherheit kennen und umsetzen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '08_Grundlagen der IT-Sicherheit kennen und umsetzen', 8, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherheit_und_Gesundheitsschutz_bei_der_Arbeit_par_4_Abs._7_Nr._3/08_Grundlagen_der_IT-Sicherheit_kennen_und_umsetzen/08_Grundlagen_der_IT-Sicherheit_kennen_und_umsetzen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Die Ziele _von_ lnformationssicherheit und Daten­schutz kennen und unterscheiden. • Die Ziele der europäischen Datenschutz-Grundver­ ordnung (DSGVO) kennen • Die Verfügbarkeit, lntegrität, Vertraulichkeit und Authentizität _von_ Daten berücksichtigen • Die Aufgaben des Bundesamtes für Sicherheit in der lnformationstechnik (BSI) kennen • Die Empfehlungen und Standards des BSI beachten und einhalten • Das betriebliche IT-Sicherheitskonzept kennen und ', true, NOW(), NOW());
  END IF;
  
  -- Course: Sicherstellen der Qualität von Softwareanwendungen
  SELECT id INTO course_id FROM courses WHERE title = 'Sicherstellen der Qualität von Softwareanwendungen (§ 4 Abs. 3 Nr. 2)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Sicherstellen der Qualität von Softwareanwendungen (§ 4 Abs. 3 Nr. 2)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Anwendungen unter Berücksichtigung vo
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Anwendungen unter Berücksichtigung von Datenschutz und Datensicherheit erstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Anwendungen unter Berücksichtigung von Datenschutz und Datensicherheit erstellen können', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherstellen_der_Qualitaet_von_Softwareanwendungen_par_4_Abs._3_Nr._2/01_Anwendungen_unter_Beruecksichtigung_von_Datenschutz_und_Datensicherheit_erstellen_koennen/01_Anwendungen_unter_Beruecksichtigung_von_Datenschutz_und_Datensich.pdf', 'In diesem Modul "Anwendungen unter Berücksichtigung von Datenschutz und Datensicherheit erstellen können" werden folgende Inhalte behandelt:  Datenschutz (lntegritat und Authentizitat von Daten, Digitale Signatur, Verschlusselungsverfahren, Archivierung (Systeme, Fristen, Pflichten))   Datensicherheit (Authentifizierung, Autorisierung, Verschlusselung)', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Datenintegrität mithilfe von technisc
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Datenintegrität mithilfe von technischen Maßnahmen beurteilen und sicherstellen können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Datenintegrität mithilfe von technischen Maßnahmen beurteilen und sicherstellen können', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherstellen_der_Qualitaet_von_Softwareanwendungen_par_4_Abs._3_Nr._2/02_Datenintegritaet_mithilfe_von_technischen_Massnahmen_beurteilen_und_sicherstellen_koennen/02_Datenintegritaet_mithilfe_von_technischen_Massnahmen_beurteilen_und.pdf', 'In diesem Modul "Datenintegrität mithilfe von technischen Maßnahmen beurteilen und sicherstellen können" werden folgende Inhalte behandelt:  Constraints   Validierungen   Transaktionssicherheit   Szenario:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Softwaretests erstellen, durchführen 
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Softwaretests erstellen, durchführen und die Ergebnisse analysieren können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Softwaretests erstellen, durchführen und die Ergebnisse analysieren können', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherstellen_der_Qualitaet_von_Softwareanwendungen_par_4_Abs._3_Nr._2/03_Softwaretests_erstellen_durchfuehren_und_die_Ergebnisse_analysieren_koennen/03_Softwaretests_erstellen_durchfuehren_und_die_Ergebnisse_analysieren_koennen.pdf', 'In diesem Modul "Softwaretests erstellen, durchführen und die Ergebnisse analysieren können" werden folgende Inhalte behandelt:  Statische und dynamische Testverfahren, z. B. Blackbox-Test, Whitebox-Test, Schreibtischtest, Modultest, End to End-Tests, lntegrationstests, Belastungstests Testprozess • Auswahl des Testverfahrens • Kriterien fur Testergebnisse definieren • Testdaten generieren und auswahlen • Testprotokoll und Auswertung', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_Grundfunktionalitäten einer Versionsv
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_Grundfunktionalitäten einer Versionsverwaltung in ihrem Einsatz beschreiben und anwenden können' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_Grundfunktionalitäten einer Versionsverwaltung in ihrem Einsatz beschreiben und anwenden können', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Sicherstellen_der_Qualitaet_von_Softwareanwendungen_par_4_Abs._3_Nr._2/04_Grundfunktionalitaeten_einer_Versionsverwaltung_in_ihrem_Einsatz_beschreiben_und_anwenden_koennen/04_Grundfunktionalitaeten_einer_Versionsverwaltung_in_ihrem.pdf', 'In diesem Modul "Grundfunktionalitäten einer Versionsverwaltung in ihrem Einsatz beschreiben und anwenden können" werden folgende Inhalte behandelt:  Abbildung der Kontrollstrukturen, z. B. Verzwei­ gungen, Schleife, mittels Pseudocode UML (Use Case bzw. Anwendungsfalldiagramm, Klassendiagramm, Aktivitatsdiagramm) Entwurf der Bildschirmausgabemasken (Software­ ergonomie, Corporate Identity, Barrierefreiheit) Fehler in einem gegebenen Quellcode finden Schreibtischtest mit einem gegebenen Quellcod', true, NOW(), NOW());
  END IF;
  
  -- Course: Umweltschutz (§ 4 Abs. 7 Nr. 4)
  SELECT id INTO course_id FROM courses WHERE title = 'Umweltschutz (§ 4 Abs. 7 Nr. 4)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Umweltschutz (§ 4 Abs. 7 Nr. 4)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Umweltbelastungen wahrnehmen und verm
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Umweltbelastungen wahrnehmen und vermeiden helfen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Umweltbelastungen wahrnehmen und vermeiden helfen', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Umweltschutz_par_4_Abs._7_Nr._4/01_Umweltbelastungen_wahrnehmen_und_vermeiden_helfen/01_Umweltbelastungen_wahrnehmen_und_vermeiden_helfen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Spezifische Risiken der IT-Prozesse sowie von IT­ beteiligten Prozessen, z. B. USV-Anlagen  * Rationelle Energie- und Ressourcenverwendung,z. B. ~unnbtige Geratelaufzeiten vermeiden~      ~Umgang mit Speicher- und Printmedien Wiederverwertung (Recycling) Abfalltrennung und -vermeidung~  * Wiederverwertung (Recycling)  * Abfalltrennung und -vermeidung   Enabler erstellt:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Umgang mit Abfällen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Umgang mit Abfällen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Umgang mit Abfällen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Umweltschutz_par_4_Abs._7_Nr._4/02_Umgang_mit_Abfaellen/02_Umgang_mit_Abfaellen.pdf', 'In diesem Modul "Umgang mit Abfällen" werden folgende Inhalte behandelt:  Branchenspezifische Abfalle • Erfassung • Lagerung und Entsorgung von z. B. Datentragern oder Kabeln', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Öffentliche Systeme und Verordnungen,
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Öffentliche Systeme und Verordnungen, Gesetze' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Öffentliche Systeme und Verordnungen, Gesetze', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Umweltschutz_par_4_Abs._7_Nr._4/03_oeffentliche_Systeme_und_Verordnungen_Gesetze/03_oeffentliche_Systeme_und_Verordnungen_Gesetze.pdf', 'In diesem Modul lernen Sie die Grundlagen zu "Öffentliche Systeme und Verordnungen, Gesetze".', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 04_ Externe Auswirkungen
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '04_ Externe Auswirkungen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '04_ Externe Auswirkungen', 4, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Umweltschutz_par_4_Abs._7_Nr._4/04__Externe_Auswirkungen/04__Externe_Auswirkungen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Im Rahmen von Nachhaltigkeit sind auch Auswir­ kungen auf Umwelt, Pflanzen, Tiere, Lebensraume zu reflektieren. Link zum Dokumeent:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 05_Umweltschonende Ressourcennutzung
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '05_Umweltschonende Ressourcennutzung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '05_Umweltschonende Ressourcennutzung', 5, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Umweltschutz_par_4_Abs._7_Nr._4/05_Umweltschonende_Ressourcennutzung/05_Umweltschonende_Ressourcennutzung.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Berucksichtigen wirtschaftlicher Nachhaltigkeit bereits bei Einkauf und Lieferantenauswahl • Sparsamer und effektiver Umgang mit Roh-, Hilfs­ und Betriebsstoffen (ggf. erforderliche Kennzeich­ nung und getrennte Lagerung beachten) • Ressourcenverbrauch und Umweltschutz in Kombination denken, z. B. Nutzung von Strom aus regenerativen Quellen Link zur Datei:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 06_Abfallvermeidung und -reduzierung
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '06_Abfallvermeidung und -reduzierung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '06_Abfallvermeidung und -reduzierung', 6, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Umweltschutz_par_4_Abs._7_Nr._4/06_Abfallvermeidung_und_-reduzierung/06_Abfallvermeidung_und_-reduzierung.pdf', 'In diesem Modul "Abfallvermeidung und -reduzierung" werden folgende Inhalte behandelt:  ', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 07_Rechtsfolgen bei Nichteinhaltung
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '07_Rechtsfolgen bei Nichteinhaltung' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '07_Rechtsfolgen bei Nichteinhaltung', 7, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Umweltschutz_par_4_Abs._7_Nr._4/07_Rechtsfolgen_bei_Nichteinhaltung/07_Rechtsfolgen_bei_Nichteinhaltung.pdf', 'In diesem Modul "Rechtsfolgen bei Nichteinhaltung" werden folgende Inhalte behandelt:  Enabler:', true, NOW(), NOW());
  END IF;
  
  -- Course: Vernetztes Zusammenarbeiten (§ 4 Abs. 7 Nr. 5)
  SELECT id INTO course_id FROM courses WHERE title = 'Vernetztes Zusammenarbeiten (§ 4 Abs. 7 Nr. 5)' LIMIT 1;
  IF course_id IS NULL THEN
    INSERT INTO courses (id, title, is_active, is_published, created_by_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Vernetztes Zusammenarbeiten (§ 4 Abs. 7 Nr. 5)', true, true, trainer_id, NOW(), NOW())
    RETURNING id INTO course_id;
  END IF;
  
  -- Enabler: 01_Wertschätzende Zusammenarbeit
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '01_Wertschätzende Zusammenarbeit' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '01_Wertschätzende Zusammenarbeit', 1, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Vernetztes_Zusammenarbeiten_par_4_Abs._7_Nr._5/01_Wertschaetzende_Zusammenarbeit/01_Wertschaetzende_Zusammenarbeit.pdf', 'In diesem Modul lernen Sie folgende Themen:  • lnterdisziplinaritat, lnterkulturalitat • Fahigkeit, effektiv, integer und respektvoll mit verschiedenen Teams zusammenzuarbeiten Obernahme gemeinsamer Verantwortung fur die Zusammenarbeit und Wertschatzung der einzelnen Beitrage jedes Teammitglieds • Unternehmenswerte beachten und betriebliche Ethikregeln anwenden ENABLER:', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 02_Informationstechnische Schutzziele be
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '02_Informationstechnische Schutzziele bei der Kommunikation kennen und umsetzen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '02_Informationstechnische Schutzziele bei der Kommunikation kennen und umsetzen', 2, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Vernetztes_Zusammenarbeiten_par_4_Abs._7_Nr._5/02_Informationstechnische_Schutzziele_bei_der_Kommunikation_kennen_und_umsetzen/02_Informationstechnische_Schutzziele_bei_der_Kommunikation_kennen_und_umsetzen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • Die Notwendigkeit zur Entwicklung eines Sicher­ heitsbewusstseins bei der Nutzung von IT-Technik im privaten und betrieblichen Bereich entwickeln Reflexion von Erfahrungen in virtuellen Raumen • Bei der Nutzung von Social Media die Gefahren fur die IT-Sicherheit im privaten und betrieblichen Bereich kennen und beachten • Im Umgang mit Kommunikation und Information Zustandigkeitsabgrenzung verdeutlichen • Sicherer Umgang mit dienstlichen E-Mails, kur', true, NOW(), NOW());
  END IF;
  
  -- Enabler: 03_Ethische Aspekte und Compliance-Regel
  IF NOT EXISTS (SELECT 1 FROM enablers WHERE title = '03_Ethische Aspekte und Compliance-Regelungen' AND course_id = course_id) THEN
    INSERT INTO enablers (id, course_id, title, order_index, ppt_url, description_text, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), course_id, '03_Ethische Aspekte und Compliance-Regelungen', 3, 'https://ngpsgwwlnlliphfgtrya.supabase.co/storage/v1/object/public/content/enablers/Vernetztes_Zusammenarbeiten_par_4_Abs._7_Nr._5/03_Ethische_Aspekte_und_Compliance-Regelungen/03_Ethische_Aspekte_und_Compliance-Regelungen.pdf', 'In diesem Modul lernen Sie folgende Themen:  • ,, Diversity" gewahrleisten und unterschiedliche Perspektiven und Befindlichkeiten berucksichtigen Gender-Neutralitat gewahrleisten, aber auch z. B. das dritte Geschlecht berucksichtigen • Im Zentrum ethischer Aspekte steht die Wurde alier Menschen sowie deren lntegritat. Diese ist fur alle direkt und indirekt Betroffenen der IT-Liisungen kurz-, mittel- und langfristig zu gewahrleisten. • Im Rahmen von Nachhaltigkeit sind auch Auswir­ kungen auf all', true, NOW(), NOW());
  END IF;
  
END $$;
