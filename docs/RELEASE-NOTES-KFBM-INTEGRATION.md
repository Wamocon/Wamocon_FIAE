# KfBM-Integration – Release Notes für Merge Request

## Zusammenfassung

Diese Änderung legt die additive Datenmodell-Grundlage für die Integration von
Kaufleuten für Büromanagement (KfBM) als zweite Fachrichtung im LFA-Lernzentrum.
Der bestehende FIAE-Betrieb bleibt der Referenzpfad. Es werden keine
Produktivdaten geändert und keine KfBM-Inhalte importiert.

## Enthalten

- Ausbildungskataloge für FIAE und KfBM im Schema ergänzt.
- Kurse und Ausbildungsrahmenplan-Komponenten mit einem
  `training_catalog_id` versehen; FIAE bleibt der Standard.
- Katalogbezogene Lernfelder mit Ausbildungsjahr, Reihenfolge und optionalem
  Stundenbudget ergänzt.
- Zuordnungstabellen für Lernfelder zu jeweils einem Enabler oder Use Case
  hinzugefügt.
- Supabase-Migration vorbereitet, die bestehende Kurse und Komponenten FIAE
  zuordnet und KfBM inaktiv anlegt.
- FIAE-Trainingsdaten-Seed auf den FIAE-Katalog begrenzt; Fehler beim Löschen
  bestehender FIAE-Daten werden nicht mehr verschluckt.
- Projekt-Onepager, Zeitplan und HAI-Vorgehen dokumentiert.

## Noch nicht Bestandteil dieser Änderung

- Migration anwenden oder Schema in Produktion ausrollen.
- Katalogauswahl und Katalogfilter in UI, APIs, Nutzerzuordnung und Berechtigungen.
- Import der KfBM-Lernfelder, Komponenten, Mappings und Content-Dateien.
- HAI-Indexierung aller KfBM-Inhalte oder Sprachaufnahme/-ausgabe.
- Produktivfreigabe von KfBM.

## FIAE-Kompatibilität und Datenbanksicherheit

- Bestehende Kurs- und Komponenten-Datensätze werden in der Migration dem
  FIAE-Katalog zugeordnet.
- Neue Kurse und Komponenten erhalten FIAE als Schema-Default, bis Anwendungs-
  und API-Flows bewusst einen Katalog auswählen.
- Der Seed löscht nur Trainingskomponenten und Use Cases des FIAE-Katalogs.
- Die Migration ist in eine Transaktion eingeschlossen, hat Lock- und
  Statement-Timeouts und prüft die benötigten Bestandstabellen und
  RLS-Hilfsfunktion.
- Die Migration wurde nicht auf eine Datenbank angewendet. Ein
  Testdatenbanklauf und ein produktiver Rollout sind separat zu planen.

## Prüfungen

- `npm run type-check` – erfolgreich.
- `npx eslint src/db/migrations/schemas/schema.ts src/scripts/seed-training-data.ts`
  – erfolgreich.
- `npx prettier --check src/db/migrations/schemas/schema.ts` – erfolgreich.
- FIAE-Kursdetail-Regressionsfall:
  `npx jest --runInBand --runTestsByPath tests/integration/api/trainee/courses.get.test.ts --testNamePattern="returns course summary with active enablers/use-cases" --coverage=false`
  – erfolgreich.
- `git diff --check` – erfolgreich.

## Bekannte Einschränkungen

- Breitere Läufe von `courses.get.test.ts` und `use-cases.get.test.ts` hatten
  zwei Fehler im Testlauf: fehlender Next.js-`incrementalCache`-Kontext und
  ein nicht passendes Mock im Use-Case-Detailtest. Der gezielte FIAE-Detailtest
  läuft erfolgreich.
- Lokaler Plattformstart benötigt Supabase-Umgebungsvariablen; ohne lokale
  Konfiguration konnte die Startseite nicht vollständig gerendert werden.
- Katalogkontext wird noch nicht über alle UI- und API-Abfragen durchgezogen.

## Folgearbeiten

1. Migration auf einer isolierten Testdatenbank ausführen und FIAE-Datenbestand,
   RLS sowie Rollback verifizieren.
2. Ausbildungskatalog in Benutzer-/Organisationskontext und relevanten
   API-/UI-Flows durchgängig machen.
3. KfBM-Curriculum und Mapping aus freigegebenen Quellen importieren.
4. KfBM-Content über einen manifest- und kennungsbasierten Importpfad übernehmen.
5. HAI-Wissensindex und anschließend Sprachfunktionen mit Quellen-, Rollen-,
   Datenschutz- und Regressionstests erweitern.
