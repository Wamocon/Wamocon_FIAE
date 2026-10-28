# Reihenfolge der Arbeit (Stufe 1)

Eine Methode für die ganze Plattform: Ein Azubi sieht alle Inhalte der Kurse, die ihm zugewiesen sind, bearbeitet sie aber nur der Reihe nach. Es gibt keine Katalogeinstellung mit zwei Verhalten, nur ein Einführungsdatum je Katalog für den Bestandsschutz.

## Regeln

- Ein Enabler ist abgeschlossen, wenn jedes aktive Lektions-Quiz mit mindestens 50 Prozent bestanden ist (bester Versuch). Ein Enabler ohne aktives Quiz zählt als abgeschlossen. Szenario- und Use-Case-Abgaben zählen nicht.
- Ein nicht bestandenes Lektions-Quiz kann wiederholt werden. Der Schlüssel (richtige Option, Begründung) kommt erst mit dem Bestehen, vorher nur richtig oder falsch je Frage. Ein bestandenes Quiz nimmt keinen weiteren Versuch an. Globale Quizze sind unverändert.
- Innerhalb eines Kurses gilt `order_index` (bei Gleichstand die Id). Inaktive Enabler gibt es für den Azubi nicht und werden übersprungen. Der erste aktive Enabler ist frei, jeder weitere erst, wenn alle aktiven Enabler davor abgeschlossen sind. Ein wirklich abgeschlossener Enabler (aktives Quiz, bestanden) wird nie wieder gesperrt.
- Gesperrt heißt: Titel und Material (Text, PDF) bleiben lesbar. Alle Schreibwege (Quiz-Versuch, Enabler-Abgabe, Use-Case-Abgabe, altes Einzelquiz, HAI-Aktion "Enabler abschließen") und die Auslieferung der Quizfragen antworten mit 403 und Code `ENABLER_LOCKED` (mit Grund und dem Enabler, der zuerst abzuschließen ist). Ein Use Case mit Enabler ist so lange gesperrt wie dieser Enabler.
- Die Sperrkette der Lektions-Quizze LOW, MEDIUM, HIGH gilt auch auf dem Server (`QUIZ_LOCKED`). Ein fehlendes oder inaktives Quiz wird übersprungen.
- Ausnahme je Azubi (`trainee_enabler_overrides`): Der Ausbilder gibt einen Enabler außer der Reihe frei, sperrt ihn oder nimmt die Ausnahme zurück (Azubi-Detail, Abschnitt "Reihenfolge der Enabler"). Nur eigene Organisation, Azubi ohne Organisation wird abgelehnt, Protokoll in `activity_log` (`TRAINEE_ENABLER_OVERRIDE`). Ausnahmen wirken nur, wo die Reihenfolge gilt.
- Die Seite "Lernen" zeigt nur aktive Kurse.

## Bestandsschutz ohne Migration

`course_members` hat keine Spalte `created_at`. Das Einführungsdatum je Katalog steht deshalb in `training_catalogs.settings.sequence_since` und wird mit dem Beitritt des Azubis zum Katalog verglichen (`trainee_enrollments.created_at`, ohne Einschreibung `profiles.created_at`).

- Die Reihenfolge gilt für Azubis, die ab dem Datum eingestiegen sind. Wer früher eingestiegen ist, arbeitet wie bisher.
- Ohne Datum ist die Reihenfolge für den Katalog nicht eingeschaltet. Das ist der sichere Ausgangszustand: Ein Release sperrt niemanden.
- Setzen nur durch den Plattform-Admin (Rechte wie die Lehrplan-Änderungen), von Hand, nie automatisch: Admin, Inhaltsstatistik, Karte des Berufs, Schaltfläche "Reihenfolge der Arbeit", Datum wählen und speichern (Schnittstelle `PUT /api/admin/catalogs/{catalogId}/sequence-rule`, Body `{ "since": "2026-11-01" }`, `null` schaltet aus). Jede Änderung steht im `activity_log` (`CATALOG_SEQUENCE_RULE`).
- Reihenfolge beim Rollout: Release, danach die Einschreibungen der Bestandsazubis sind vorhanden (Backfill), erst dann das Datum auf den Tag der Einführung setzen. Ein früheres Datum würde Bestandsazubis erfassen.

## Vor dem Rollout in Production zu prüfen (nur lesend, durch Niko)

```sql
-- Sind die FIAE-Kurse aktiv? Die Seite Lernen blendet inaktive Kurse aus.
select c.id, c.title, c.is_active
from courses c
join course_members m on m.course_id = c.id
where m.role = 'TRAINEE'
group by c.id, c.title, c.is_active
order by c.is_active, c.title;

-- Welche aktiven FIAE-Enabler haben ein Szenario, aber kein aktives Quiz?
-- Sie zählen nach der neuen Regel sofort als abgeschlossen (vorher erst nach Freigabe des Szenarios).
select e.id, e.title
from enablers e
where e.is_active
  and e.scenario_pdf_url is not null
  and not exists (
    select 1 from enabler_quiz_links l join quizzes q on q.id = l.quiz_id
    where l.enabler_id = e.id and q.is_active
  );
```

## Erweiterung (Stufe 2, nicht gebaut)

Die Reihenfolge der Komponenten eines Berufs wird dort angebunden, wo `computeCourseProgression` den Grund einer Sperre bestimmt (`src/lib/catalog/progression.ts`): Eine noch nicht offene Komponente sperrt alle ihre Enabler mit einem eigenen Grund (neuer Wert von `LockReason`).
