# Go-Checkliste für die Produktivschaltung

Stand: 02.11.2026. Ein Blatt für die Entscheidung. Die Einzelheiten stehen im Rollout-Runbook (`docs/kfbm-production-rollout.md`), in der Ablaufkarte der HAI (`docs/hai-produktivgang.md`) und in den Release Notes (`docs/release-notes-2026-11.md`). Production ist bis zum ausdrücklichen Go von Niko unverändert. Ein offener Punkt in Abschnitt 3 ist ein No-Go (Regel aus Abschnitt 7.1 des Runbooks), das Ersatzfenster wird dann neu gesetzt.

## 1. Entscheidungen von Niko

| Nr | Entscheidung | Stand |
|---|---|---|
| G1 | Go für den Plattform-Rollout (Migrationen, Release, Inhalt) und Termin des Fensters | offen |
| G2 | Merge von PR 183 (preview nach master) als Release-Kandidat, erst nach G1 | offen, am 02.11.2026 ausdrücklich "noch nicht" |
| G3 | HAI in Production mit Sokrates für Chat und Einbettung | entschieden am 02.11.2026 |
| G4 | Abhängigkeit von Sokrates, kein Rückfall auf Gemini | entschieden am 02.11.2026 |
| G5 | Go für die Neuindexierung Production (H3) und die Umstellung der Anbieter (H7) | offen |
| G6 | Zeitfenster auf Sokrates mit dem Projekt WAMO (etwa drei Stunden) | offen |
| G7 | Sprachassistent je Organisation: Einwilligung der Azubis (auch Minderjährige) und Auftragsverarbeitung, falls Soniox genutzt wird | offen, in Production bleibt der Schalter aus |
| G8 | WMCNL-2887 (Blocked) | offen |

## 2. Technisch vorbereitet (Claude)

| Punkt | Ergebnis |
|---|---|
| Migrationsreihe | 38 Dateien von `20261023100000` bis `20261102000200`, Freigabetor am Backfill (`20261025000000`) |
| Generalprobe Migrationen | 31.10.2026 auf Wegwerf-Container, längste Datei 2,4 Sekunden, Nachchecks N01 bis N09 wie erwartet, Rückbau erprobt |
| Generalprobe Schritt 8 | App gegen die Kopie, Smoke S1 bis S6, siehe `docs/probelauf-2026-11-02.md` |
| Lesende Messung Production | 02.11.2026 wiederholt (V01 bis V14): 3 Azubis, alle freigeschaltet, 8 Konten in `auth.users`, Ledger bereinigt (1 Zeile), keine unerwartete Abweichung zum 31.10.2026 |
| FIAE-Übertragung per Id | Trockenlauf am 01.11.2026: 983 Dokumente aktualisiert, 32 eingefügt, Quizze 432 gleich und 32 ersetzt, Global-Quizze 13 gleich und 9 ersetzt, 0 Konflikte. Läuft nach dem App-Release |
| Release Notes | `docs/release-notes-2026-11.md` |
| HAI | Preview-Index mit Sokrates (49.318 Zeilen, 0 Fehler), Testplan für den 03.11.2026, Ablaufkarte H1 bis H9 für Production |
| Auth-Fix | PR 236: ein Ausfall von Supabase Auth ist kein 401 mehr, Gründe stehen im Log |

## 3. Aufgaben vor dem Go (Niko oder Betrieb)

| Nr | Aufgabe | Wer |
|---|---|---|
| V1 | Sicherung der Production-Datenbank (`pg_dump` plus Dashboard-Backup), Zeitpunkt und Ablageort notieren, Restore-Test | Niko, Betrieb |
| V2 | Zweitfreigabe in den GitHub-Environments (zweiter Reviewer erreichbar im Fenster) | Niko |
| V3 | Wartungshinweis an die Nutzer, drei Azubis in Production | Niko |
| V4 | Release-Kandidat als fester Commit (nach G2) | Niko, Claude |
| V5 | Variablen in Vercel (Ziel Production) für die HAI: `HAI_EMBEDDING_PROVIDER` und `HAI_CHAT_PROVIDER` erst in H7 | Niko |
| V6 | SMTP-Zugang von Resend für fiae-learn.com (E-Mail-Bestätigung, WMCNL-2847), kann nach dem Rollout folgen | Niko |
| V7 | Schlüssel und Passwörter wechseln (service_role und anon auf publishable und secret, Passwörter, alter Sokrates-Schlüssel), nach dem Rollout | Niko, Claude |

## 4. Reihenfolge am Tag

1. V1 bis V4 erledigt, G1 und G2 erteilt.
2. Wartungsfenster beginnt, Sicherung wiederholen (letzte 30 Minuten vor dem Fenster).
3. `KFBM_ROLLOUT_APPROVED=true` setzen, Release veröffentlichen (guard, migrate, content-sync, deploy).
4. Smoketest S1 bis S14, Messungen V01 bis V14 wiederholen, Vergleich mit Abschnitt 2.
5. FIAE-Übertragung per Id (Trockenlauf, dann `--apply --confirm-host`).
6. Bucket `content` privat schalten, Smoketest der Dokumente.
7. HAI in einem eigenen Fenster (G5, G6): H1 bis H9 aus `docs/hai-produktivgang.md`.
8. Beobachten: Vercel-Logs der Routen `/api/*`, Meldungen `[session] token rejected` und `Supabase Auth unavailable`, Sokrates-Last.

## 5. Rückweg in Kürze

Vor Schritt 3 ist nichts verändert. Danach: Rückbau der Katalogreihe (`docs/rollback/`), Wiederherstellung aus der Sicherung (V1), App über "Production Deploy" nur mit einem Release, das die Migrationsdateien kennt. Für die HAI gilt der Rückweg in `docs/hai-produktivgang.md`, Abschnitt 5.
