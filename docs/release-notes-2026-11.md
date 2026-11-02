# Release Notes: KfBM als zweiter Beruf, neue FIAE-Inhalte, HAI mit Sokrates

Stand: 02.11.2026. Gilt für den Release-Kandidaten aus master nach dem Merge von preview (PR 183). Production ist bis zum ausdrücklichen Go von Niko unverändert. Das Rollout-Runbook ist `docs/kfbm-production-rollout.md`, die Ablaufkarte der HAI `docs/hai-produktivgang.md`.

## 1. Überblick

Die Lernplattform führt jetzt zwei Ausbildungsberufe in einem System: Fachinformatiker Anwendungsentwicklung (FIAE, bleibt der Referenzpfad) und Kaufleute für Büromanagement (KfBM). Dazu kommen die vollständige Sicherheitshärtung, neue FIAE-Inhalte, ein neuer Weg für Inhalte (Upload, Import, Freigabe) und eine HAI, die beide Berufe getrennt kennt und über den Haus-Server Sokrates antwortet.

| Bereich | Kurzfassung |
|---|---|
| Berufe | Ausbildungskatalog je Beruf, mehrere Ausbildungen je Azubi, Reiter statt Berufswechsler |
| Lernweg | Enabler der Reihe nach, Wiederholung erlaubt, nur das Quiz zählt, gesperrte Enabler zeigen nur Titel und Material |
| Inhalte | KfBM vollständig, FIAE neu geliefert (Dokumente, Quizze, Global-Quizze), Szenarien ganz sichtbar |
| Verwaltung | Berufe je Organisation, Plätze und Rollengrenzen, Freigabe- und Zuweisungswerkzeug, Inhaltsstatistik mit Soll |
| HAI | Berufstrennung, Lösungsschutz, Lernkarten, Tagesbegleiter, Sprachassistent, Einbettung und Chat über Sokrates |
| Sicherheit | Server-Sitzung für alle Routen, Zeilenschutz, Speicherrechte, Passwortregel, Bucket mit signierten Links |
| Betrieb | 38 Migrationen mit Freigabetor, Release-Strecke mit zwei Schemas, Inhaltsübertragung per Id |

## 2. Neu für Auszubildende

- Auswahl und Anzeige der eigenen Berufe, bei mehreren Ausbildungen ein Reiter je Beruf (PR 95, 96, 112, 151, 167).
- Phasenplan, Berufsschule, Prüfungen und Beschriftungen folgen dem Beruf (PR 98, 111).
- Reihenfolge der Arbeit: ein Enabler nach dem anderen, Quiz wiederholbar, gesperrte Enabler mit Erklärung und Material, ein Use Case bleibt zu, solange sein Enabler gesperrt ist (PR 168, 202).
- Lernfeld-Seite mit Enablern und Use Cases (PR 163).
- Globale Quizze lassen sich abschließen, Freitextfragen ohne Musterantwort werden nicht bewertet (PR 132, 172).
- Antworten und Erklärungen eines Quiz erscheinen erst nach dem Absenden (PR 130).
- Optionale Datei bei der Use-Case-Abgabe, Aufbewahrung bis zum Ende der Ausbildung (preview, PR 186, 191).
- Ein neuer Azubi arbeitet erst nach der Freigabe durch Trainer oder Administrator, bis dahin zeigt die Seite einen klaren Hinweis statt einer stillen Weiterleitung (PR 164).
- Dokumente zum Lesen im Browser, kein Download für Azubis (preview, PR 208).

## 3. Neu für Trainer und Administratoren

- Berufe je Organisation freischalten, Azubis einschreiben, Plätze und Rollengrenzen, Menüs je Stufe (PR 97, 101).
- Werkzeug "Inhalte freigeben oder sperren" mit Probelauf und Katalogcode, Zuweisung nach Phasenplan, Karte "Ausbildungsberufe" (PR 163, 165).
- Inhalts-Upload mit KI-Zuordnung (Ordner wählen, Prüfliste, Übertragung mit Probelauf, Protokoll und Rückbau SQL), Sokrates als Stufe, JSON und Excel (PR 139 bis 145, 150, 156 bis 158, 170).
- Inhaltsstatistik je Beruf mit Soll (PR 152, 174).
- Aktivitätsberichte, Bewertungen und Listen nach Beruf und Organisation gefiltert, Bewertungen umfassen die ganze Organisation (PR 114, 126, preview PR 194, 197, 211).
- Quizverwaltung zeigt alle globalen Quizze (PR 219).
- Der Super-Administrator sieht inaktive Berufe als Reiter (PR 153).

## 4. HAI

- Berufsfilter im Index, Persona und Prompts je Beruf, Grenzen für Fremdberufe (PR 118, 121, 198, 200).
- Lösungsschutz: Musterlösung, Trainerlösung und Bewertungsschlüssel gibt es nie für Azubis, eine ausdrückliche Anfrage endet vor der Suche mit einem festen Text, die Rolle kommt vom Server (PR 201, 231). Trainer dürfen Musterlösungen für ihre Berufe nutzen (Schalter, Standard aus).
- Aktionen brauchen eine Bestätigung und prüfen die Zuständigkeit (PR 122).
- Lernkarten (zwölf, geprüft und freigegeben am 01.11.2026) mit Quelle Dunlosky, keine Lerntypen, kein Burnout-Rat (PR 179, 232).
- Tagesbegleiter ("Was steht heute an?") mit höchstens drei Punkten aus echten Daten (PR 233).
- Sprachassistent mit Einwilligung, Schalter je Organisation, Standard aus (PR 233). Anbieterwahl in der neuen HAI-Admin-Seite: Soniox (Region EU) als Hauptanbieter, Sokrates und der Browser als Rückfallebene, Umschalten ohne neuen Release (PR 241).
- Quiz-Modus: Abfrage Frage für Frage aus den Lektionsquizzen ohne Wertung, nur aus freigeschalteten Enablern des eigenen Berufs. Die richtige Antwort und die Erklärung gibt es erst, wenn das Quiz zu der Frage bestanden ist (wie im echten Quiz, gleiche Definition von bestanden), davor nur "Richtig!" oder "Leider falsch." mit Link zum Enabler. Trainer sehen die Lösung immer. Gegen das Durchprobieren gelten höchstens drei Versuche je Frage und Stunde (PR 240, 249, Beschluss vom 02.11.2026).
- Agentenschicht: Die HAI führt gezielt durch die Plattform, Navigationskarten mit Knopf "Öffnen" aus einer festen Zulassungsliste je Rolle, "Weiter lernen", keine Schreibwirkung (PR 239).
- Begründungen bei Ablehnungen: Kann die HAI etwas wegen Rolle, Beruf, gesperrtem Enabler, Lösungsschutz, Freigabe, Plan, Schalter, Zuständigkeit oder Umfang nicht, nennt sie den Grund in einem freundlichen Satz und sagt, was stattdessen geht. Feste Texte vor Suche und Modell, ein Hinweis im Prompt nur bei Zugriffsgrund, neue stabile Codes der Routen (`PRO_REQUIRED`, `COURSE_NOT_ASSIGNED`), Klartext statt "Fehler" im Browser, nichts aus einem fremden Beruf in den Texten, eine technische Störung wird nie als fehlende Berechtigung ausgegeben (PR 259, `docs/hai-ablehnungen.md`).
- HAI folgt dem gewählten Beruf: Wählt ein Azubi mit zwei Berufen den Reiter FIAE oder KfBM, antwortet die HAI nur zu diesem Beruf (Suche, Persona, Titel), wie die übrige Plattform und der Quiz-Modus. Eine Frage zum anderen eigenen Beruf bekommt den festen Hinweis, oben auf den Reiter zu wechseln (Kategorie Auswahl). Die Quizkarte nennt den Beruf ("Quiz: FIAE"). Die Tageslage ("Was steht heute an?") bleibt berufsübergreifend, ohne Reiter bleibt alles wie bisher (alle Berufe). Eine Kennung, die nicht zu den Berufen der Person gehört, wird ignoriert (PR 261, `docs/hai-persona-per-occupation.md`).
- Einbettung und Chat über Sokrates (Qwen3-Embedding, gemma4:31b), Rückfall des Chats nur auf Sokrates, nie auf einen externen Anbieter (PR 171, 199, 209).
- Vektorindex (halfvec) beschleunigt die Suche von 26 auf 0,9 Sekunden, hinter einem Schalter (PR 231).
- Prüfsatz mit 98 Fällen: kein Leck, Antworten 93,1 Prozent, Fremdberuf 100 Prozent, Lösungen verweigern 100 Prozent.

## 5. Neue FIAE-Inhalte

- Dokumente aus der Word-Lieferung, Szenario-Teile (ganz sichtbar, Beschluss vom 29.10.2026), Aufgabenfassungen der Use Cases, Quizze und Global-Quizze (PR 212, 213, 217, 218, 228).
- Übertragung nach Production per Id mit Trockenlauf, Konfliktliste und Rückbau (PR 223 bis 225, 229). Lesender Trockenlauf gegen Production am 01.11.2026: 983 Dokumente aktualisiert, 32 eingefügt, Quizze 432 gleich und 32 ersetzt, Global-Quizze 13 gleich und 9 ersetzt, 0 Konflikte.
- Bekannte Lücken stehen in WMCNL-2908 (unter anderem Titel und Inhalt bei 24/07 passen in der Lieferung nicht zusammen).

## 6. Sicherheit

- Zugangsdaten aus dem Code entfernt, Historie bereinigt (PR 84).
- Serverseitige Sitzung für alle Routen: Identität kommt aus dem Token, nie aus der Anfrage; Rollen und Organisation werden geprüft (PR 85, 116 bis 117, 120, 123, 126 bis 129).
- Zeilenschutz, geschlossene anonyme Richtlinien, Spaltenrechte und Trigger auf `profiles`, Speicherrechte (PR 87, 89, 93, 134).
- Dokumentpfade geprüft, Admin-PIN serverseitig, Eingaben begrenzt (PR 133, 136).
- Passwort mindestens acht Zeichen, Bucket `content` mit signierten Links, privat erst nach dem App-Release (PR 188, 189).
- Meldet Supabase Auth einen Ausfall, antwortet der Server mit 503 statt 401 und protokolliert den Grund, der Browser wiederholt eine abgelehnte Anfrage einmal mit frischem Token (PR 236).

## 7. Datenbank und Betrieb

- 38 neue Migrationsdateien von `20261023100000` bis `20261102000200`, rückwärtskompatibel geschrieben. Eine Datei (`20261025000000`, Backfill SUPER_ADMIN) hält das Freigabetor an, bis `KFBM_ROLLOUT_APPROVED` gesetzt ist.
- Release-Strecke mit zwei Schemas: `public` ist Production, `public_preview` die Preview. Ablauf `guard`, `migrate`, `content-sync`, `deploy`, Beschreibung in `docs/release-prozess.md`.
- Generalprobe am 31.10.2026 auf einem Wegwerf-Container: 34 Migrationen (damals), längste Datei 2,4 Sekunden, Nachchecks N01 bis N09 wie erwartet, FIAE-Übertragung angewendet, zweiter Lauf ohne Änderung, Rückbau erprobt. Die vier später hinzugekommenen Dateien (Check der Lernkarten-Quelle, Schalter Sprachassistent, Tabelle `hai_settings` und die Bereinigung ihres Fremdschlüssels) sind additiv.
- Rückweg: Sicherung der Datenbank vor dem Fenster, Rückbau der Katalogreihe (`docs/rollback/`), App über "Production Deploy" nur mit dem Release, das die Migrationsdateien kennt.

## 8. Änderungen für FIAE-Nutzer

Für bestehende FIAE-Azubis bleibt der Weg gleich. Sichtbar neu sind die Reiter (nur bei mehreren Berufen), die Reihenfolge der Arbeit und die neuen Inhalte. In Production gibt es heute drei Azubis, alle freigeschaltet, niemand wird ausgesperrt (Messung V14). Bestandsschutz für bereits erledigte Enabler gilt.

## 9. Bekannte Grenzen

- Soniox ist nur gegen Nachbauten getestet, der erste echte Lauf ist Teil des Preview-Tests (Testplan E14 bis E16). Safari und iPhone nehmen in einem Format auf, das Soniox eventuell ablehnt, dann fällt die Kette zurück.
- Zwei Prüffälle der HAI (Netflix-Server, Hotelbuchung) werden zu Unrecht abgelehnt.
- Gesprochene Antworten erreichen 88,5 Prozent im Prüfsatz (Schwelle 90 Prozent), alle Schutzregeln halten.
- Die HAI braucht Sokrates. Fällt der Server aus, antwortet sie nicht, Lernen und Abgaben laufen weiter.
- Offene Fehler zur späteren Behebung: WMCNL-2887 (Blocked), FIAE-Regressionsfehler (von Niko angelegt).
- E-Mail-Bestätigung (WMCNL-2847) wartet auf den SMTP-Zugang von Resend, Schlüsselwechsel und Passwörter folgen nach dem Rollout.

## 10. Reihenfolge im Fenster

1. Sicherung und Go, Wartungshinweis.
2. Migrationen mit Freigabetor, Release, Inhaltsabgleich nur KfBM.
3. Smoketest S1 bis S14, Messungen V01 bis V14 wiederholen.
4. FIAE-Übertragung per Id (nach dem App-Release).
5. HAI: Neuindexierung mit Sokrates, Anbieter umstellen, Smoketest (eigenes Fenster, `docs/hai-produktivgang.md`).
6. Bucket privat schalten.
