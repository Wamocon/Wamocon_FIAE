WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn

# Release-Prozess: Preview und Production mit zwei Schemas

Stand: Oktober 2026. Gilt für das Repository Wamocon_FIAE (Next.js, Drizzle, Supabase, Vercel).

## 1. Kurzfassung

Production und Preview teilen sich eine Supabase-Datenbank, aber nicht das Schema.

- `public` ist Production.
- `public_preview` ist Preview, eine Strukturkopie von `public`.

Preview bekommt nie Produktionsdaten. Die Struktur wird aus `public` geklont, Inhalte entstehen über Seed, Import oder den Inhaltsabgleich. Nach Production gelangt nur durch ein veröffentlichtes Release etwas: erst die Struktur-Migration, dann der Abgleich der Ausbildungsinhalte, dann das Deployment. Ein Merge auf `master` verändert Production nie.

## 2. Ereignisse, Migration und Deployment

| Ereignis                                                                                           | Workflow           | Migration                                                          | Deployment                                             |
| -------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Branch angelegt und gepusht (Migrationen oder Preview-Skripte geändert, kein offener Pull Request) | Preview Migration  | `public_preview`                                                   | keines                                                 |
| Pull Request geöffnet, danach jeder Push in den Pull Request                                       | Preview Deploy     | `public_preview`                                                   | Preview                                                |
| Pull Request gemergt (Push auf `master`)                                                           | Preview Deploy     | `public_preview`                                                   | Preview, nie Production. `public` wird nicht migriert. |
| Release veröffentlicht (ohne Prerelease)                                                           | Release Production | `public` (Struktur), danach Inhaltsabgleich der Ausbildungsinhalte | Production                                             |
| Manuell: Production Deploy                                                                         | Production Deploy  | keine, nur lesende Prüfung                                         | letztes Release                                        |
| Manuell: Preview Deploy                                                                            | Preview Deploy     | optional (`run_migration`)                                         | Branch nach Wahl                                       |
| Manuell: Inhaltsabgleich                                                                           | Content Sync       | Trockenlauf (Standard) oder Anwenden                               | keines                                                 |
| Manuell: Preview zurücksetzen                                                                      | Preview Reset      | Plan (Standard) oder Neuaufbau von `public_preview`                | keines                                                 |
| Täglich 04:17 UTC                                                                                  | Database Drift     | nur lesend                                                         | keines                                                 |
| Pull Request mit Änderungen an Datenbank oder Workflows                                            | Database Checks    | keine, kein Secret, keine Datenbank                                | keines                                                 |

Die Reihenfolge im Release ist per `needs` erzwungen: `guard`, dann `migrate`, dann `content-sync`, dann `deploy`. Schlägt ein Job fehl, startet "Re-run failed jobs" an der Stelle des Fehlers. Jeder Schritt ist wiederholbar.

Zwei Begrenzungen beim Push auf einen Branch: Der Lauf startet nur, wenn sich `supabase/migrations/**` oder die Preview-Skripte geändert haben, und er wird übersprungen, sobald für den Branch ein offener Pull Request existiert (dann übernimmt der Lauf des Pull Requests, damit nichts doppelt läuft).

## 3. Aufbau

| Datei                                                          | Zweck                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.github/workflows/preview-migration.yml`                      | Branch-Push: Migration von `public_preview`                                                     |
| `.github/workflows/deploy-preview.yml`                         | Pull Request, Push auf `master`, manuell: Migration von `public_preview` und Preview-Deployment |
| `.github/workflows/release-production.yml`                     | Release: `guard`, `migrate`, `content-sync`, `deploy`                                           |
| `.github/workflows/deploy-production.yml`                      | Manuell: letztes Release nach Production                                                        |
| `.github/workflows/content-sync.yml`                           | Manuell: Inhaltsabgleich (Trockenlauf als Standard)                                             |
| `.github/workflows/db-drift.yml`                               | Täglich, nur lesend                                                                             |
| `.github/workflows/preview-reset.yml`                          | Manuell: `public_preview` neu aus der Struktur von `public` aufbauen                            |
| `.github/workflows/db-checks.yml`                              | Pull Request: Skript-Tests und Migrationsprüfung, ohne Secrets                                  |
| `.github/actions/db-setup`, `preview-migrate`, `vercel-deploy` | Wiederverwendbare Bausteine im Repository                                                       |
| `scripts/db/*.mjs`                                             | Prüfung, Umschreiben, Preview-Migration, Drift, Vergleich, Inhaltsabgleich                      |
| `supabase/content-tables.json`                                 | Allowlist des Inhaltsabgleichs                                                                  |
| `supabase/legacy-migrations.txt`, `supabase/known-drift.txt`   | Bekannte Altlasten (mit Begründung)                                                             |
| `supabase/preview-setup/01` bis `04`                           | SQL-Vorlagen für die einmalige Preview-Einrichtung                                              |
| `src/lib/db-schema.ts`                                         | Zentrale Schema-Auswahl der App                                                                 |

Das alte `deploy.yml` (Aufruf des Remote-Workflows `Wamocon/github_workflow`) ist ersetzt.

### Entscheidung: lokale Bausteine statt Remote-Workflow

Der Remote-Workflow hat keinen `ref`-Input, setzt bei leerem `db_schema` den Wert `public` (ein Preview-Deployment würde dann Produktionsdaten lesen) und legt mit einem persönlichen Token Vercel-Projekte und Secrets an. Deshalb liegt die Deploy-Logik als lokale Composite Action im Repository. Das Schema ist dort kein Input, sondern folgt aus dem Ziel (Preview oder Production), der Stand des Codes kommt vom Checkout des aufrufenden Jobs, die Vercel-CLI ist fest gepinnt. Composite Actions laufen im aufrufenden Job, deshalb stehen Environment-Secrets sicher zur Verfügung.

## 4. Schutz vor Schema-Verwechslung

1. Der Preview-Deploy setzt `NEXT_PUBLIC_DB_SCHEMA` und `SUPABASE_DB_SCHEMA` immer fest auf `public_preview`, Production fest auf `public`. Die Werte aus dem Vercel-Projekt werden überschrieben, `scripts/db/deploy-env.mjs` prüft das Ergebnis und bricht bei Abweichung ab.
2. Dasselbe Skript prüft die Datenbank-Rolle in `DB_CONNECTION_STRING` exakt: Preview muss als `app_preview` oder `app_preview.<Projekt-Referenz>` verbinden. Namen, die nur so beginnen (`app_preview_migrator`, `app_previewx`), werden abgelehnt. Production darf keine der Preview-Rollen nutzen.
3. `next.config.ts` bricht den Build ab, wenn ein Vercel-Production-Build nicht `public` oder ein Vercel-Preview-Build nicht `public_preview` nutzt. Auch ohne `VERCEL_ENV` (lokaler Build, Docker, anderes CI) wird `public_preview` nur mit einer `DB_CONNECTION_STRING` der Rolle `app_preview` akzeptiert. Ungültige Werte brechen jeden Build ab.
4. Die App prüft beim Start der Datenbank- und Supabase-Clients auf dem Server (`assertDbConfig`), ob Rolle und Schema zusammenpassen. Das Preview-Schema ohne passende Verbindungszeichenfolge schlägt sicher fehl.
5. Die Rolle `app_preview` hat ihren `search_path` auf Rollenebene (`public_preview, extensions`) und keine Rechte auf `public`. Der rollenbasierte `search_path` ist hinter dem Pooler robuster als ein Startparameter und schlägt sicher fehl.
6. Ohne gesetzte Variablen läuft die App wie bisher auf `public`.
7. Das Deployment gibt keine Werte aus dem Vercel-Projekt aus: Nach `vercel pull` werden alle Werte (außer `NEXT_PUBLIC_*`, `VERCEL_*` und dem Schema) mit `::add-mask::` maskiert, bevor gebaut wird. Das vollständige Vercel-Protokoll wird nicht mehr ausgegeben, nur bei einem Fehler die letzten 30 Zeilen. Ausgaben der Datenbank-Skripte maskieren die Verbindungszeichenfolge und ihr Passwort.

`NEXT_PUBLIC_*` wird beim Build eingebacken. Jedes Deployment bekommt deshalb einen eigenen Build, nichts wird zwischen Preview und Production hochgestuft.

## 5. Secrets und Variablen

Es werden nur Namen genannt, nie Werte.

### GitHub (Repository, Environments `Production` und `Preview`)

| Name                        | Art                             | Wo                                     | Zweck                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`     | Secret                          | NUR Environment `Production`           | Supabase CLI für Production: Migration von `public`, Inhaltsabgleich, Strukturabzug von `public`, Vergleich. Persönliches Zugriffstoken, am besten ein eigenes nur dafür. Kein Repository- oder Organisations-Secret, nicht im Environment `Preview`. |
| `PREVIEW_DB_URL`            | Secret                          | NUR Environment `Preview`              | Verbindungszeichenfolge der Datenbank-Rolle `app_preview_migrator` (Session-Pooler, Port 5432). Die Rolle besitzt `public_preview`, hat keine Rechte auf `public`, `auth`, `storage`, kein BYPASSRLS. Alle Preview-Läufe nutzen nur sie.              |
| `VERCEL_TOKEN`              | Secret                          | Environment `Production` und `Preview` | Vercel CLI (siehe Restrisiko unten)                                                                                                                                                                                                                   |
| `VERCEL_ORG_ID`             | Secret                          | Environment `Production` und `Preview` | Vercel Team oder Konto                                                                                                                                                                                                                                |
| `VERCEL_PROJECT_ID`         | Secret                          | Environment `Production` und `Preview` | Vercel Projekt                                                                                                                                                                                                                                        |
| `SUPABASE_PROJECT_REF_PROD` | Variable (Repository)           | Repository                             | Projekt-Referenz, nicht hartkodiert und kein Secret. Nur Production-Jobs lesen sie.                                                                                                                                                                   |
| `CONTENT_SYNC_OWNER_EMAIL`  | Variable (Repository), optional | Repository                             | Profil, das als Ersteller synchronisierter Kurse und Quizze eingetragen wird                                                                                                                                                                          |

**Sicherheitsmodell der Preview-Läufe.** Unüberprüftes Branch-SQL läuft in Preview vor dem Review. Deshalb sehen Preview-Jobs kein Production-Token. Sie verbinden sich über `PREVIEW_DB_URL` als `app_preview_migrator`. Die Grenze ist diese Datenbank-Rolle, nicht das Umschreiben der Migrationen (`public.` nach `public_preview.`). Das Umschreiben und die Sperrliste bleiben als Komfort und Frühwarnung, sie sind keine Sicherheitsgrenze mehr. Die Struktur von `public` liest ein getrennter Production-Job (nur lesend, nur Struktur, keine Zeilen) und übergibt sie als Datei.

| Job                                                                                                                  | Environment             | Token                   | Zugriff                                                |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------- | ------------------------------------------------------ |
| Preview Migration, Preview Deploy (Migration), Preview Reset (`rebuild`), Database Drift (`preview-drift`)           | `Preview`               | kein Supabase-Token     | `PREVIEW_DB_URL` (nur `public_preview`)                |
| Preview Reset (`snapshot`), Release Production, Production Deploy, Content Sync, Database Drift (`production-drift`) | `Production` (Reviewer) | `SUPABASE_ACCESS_TOKEN` | Projekt, lesend oder migrierend wie im Job beschrieben |

Das tägliche Drift-Programm läuft nur auf der Preview-Seite (Ledger von `public_preview` gegen die Dateien auf `master`). Der Vergleich mit `public` braucht das Production-Token und damit eine Freigabe des Environments `Production`. Ein täglicher Lauf, der jeden Tag auf eine Freigabe wartet, würde ignoriert, und ein Production-Token in einem unbeaufsichtigten Zeitplan-Lauf ist genau das, was die Sicherheitsprüfung ausschließt. Deshalb ist der Production-Teil (`production-drift`) ein manueller Lauf mit Eingabe `compare_production`, zum Beispiel nach einem Release.

**Annahmen und Restrisiken.**

- Wer auf einen Branch dieses Repositories schreiben darf, kann Workflow-Dateien und Skripte ändern und läuft im Environment `Preview`. Er kann `PREVIEW_DB_URL` und `VERCEL_TOKEN` auslesen. Folge für `PREVIEW_DB_URL`: Zugriff nur auf `public_preview`. Folge für `VERCEL_TOKEN`: ein Vercel-Token reicht meist weiter als ein Projekt, am besten ein Token mit engem Geltungsbereich verwenden. Schreibrechte auf das Repository sind deshalb vertrauenswürdigen Personen vorbehalten.
- Rechte, die `PUBLIC` jedem Datenbank-Nutzer gibt (zum Beispiel `EXECUTE` auf Funktionen in `public`, `USAGE` auf dem Schema `public`), erbt auch `app_preview_migrator`. `supabase/preview-setup/04-verify.sql` listet sie auf. Eine `SECURITY DEFINER`-Funktion in `public`, die für `PUBLIC` ausführbar ist und Daten schreibt, wäre ein Weg aus `public_preview` heraus. Das ändert diese Pull Request nicht in Production, die Liste verlangt eine Entscheidung des Eigentümers.
- Die Rolle `app_preview_migrator` kann keine Fremdschlüssel auf `auth.users` anlegen. Der Strukturklon lässt sie weg, neue Migrationen mit einem solchen Schlüssel werden mit Hinweis abgelehnt (Rahmen `-- preview:skip` ... `-- preview:end`). In Preview fehlt dadurch das Löschen per Kaskade aus `auth.users`.

### Vercel-Projekt (Laufzeit der App, nicht GitHub)

| Name                                          | Preview                                            | Production                              |
| --------------------------------------------- | -------------------------------------------------- | --------------------------------------- |
| `DB_CONNECTION_STRING`                        | Benutzer `app_preview.<Projekt-Referenz>` (Pooler) | wie bisher                              |
| `NEXT_PUBLIC_SUPABASE_URL`                    | wie Production (geteilte Auth)                     | wie bisher                              |
| Neuer Schlüsselname, serverseitig             | `SUPABASE_SECRET_KEY` (Präfix `sb_secret_`)        | `SUPABASE_SECRET_KEY`                   |
| Alter Schlüsselname, serverseitig             | `SUPABASE_SERVICE_ROLE_KEY`                        | `SUPABASE_SERVICE_ROLE_KEY`             |
| Neuer Schlüsselname, öffentlich               | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`             | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`  |
| Alter Schlüsselname, öffentlich               | `NEXT_PUBLIC_SUPABASE_ANON_KEY`                    | `NEXT_PUBLIC_SUPABASE_ANON_KEY`         |
| `NEXT_PUBLIC_DB_SCHEMA`, `SUPABASE_DB_SCHEMA` | nicht setzen, der Deploy setzt sie fest            | nicht setzen, der Deploy setzt sie fest |

Production nutzt die neuen Schlüsselnamen. Der Code liest beide Namenspaare über `src/lib/env.ts`, die neuen Namen gewinnen. Es genügt also ein Paar je Umgebung.

## 6. Einmalige menschliche Schritte

Die Workflows führen nichts davon aus. Solange Secrets und Variablen fehlen, scheitern alle Läufe sicher in der ersten Prüfung.

1. **Schema in Supabase freigeben.** Im Supabase-Dashboard unter Project Settings, Data API, "Exposed schemas" das Schema `public_preview` ergänzen. Ohne diesen Schritt kann supabase-js (`db.schema`) das Schema nicht ansprechen.
2. **GitHub Environments anlegen.**
   - `Production`: unter "Required reviewers" mindestens eine Person eintragen, "Deployment branches and tags" auf `master` und Release-Tags beschränken. Ein Release braucht bis zu drei Freigaben, je eine für `migrate`, `content-sync` und `deploy`.
   - `Preview`: ohne Reviewer, alle Branches erlaubt.
   - **Release-Tags schützen (menschliche Einstellung).** Unter Settings, Rules, Rulesets ein Tag-Ruleset für das Muster `v*` anlegen, das das Erstellen, Ändern und Löschen von Release-Tags nur Maintainern erlaubt. Im Environment `Production` unter "Deployment branches and tags" nur `master` und das Tag-Muster `v*` zulassen. Grund: Die Workflow-Datei eines Tags ist Teil des Tags. Die Prüfungen in den Workflows (`github.ref == 'refs/heads/master'` bei manuellen Läufen, `require-master` in jedem Production-Job per `git merge-base --is-ancestor` gegen ein frisch geholtes `master`) sind eine zweite Absicherung, ersetzen diese Einstellungen aber nicht.
   - Secrets laut Abschnitt 5 im jeweiligen Environment eintragen, die Variablen im Repository.
3. **Baseline der Production-Migrationen abgleichen.** Die 56 Drizzle-Dateien unter `src/db/migrations/drizzle` sind Historie und keine abspielbare Kette, sie bleiben unangetastet. Die Datei `202606260001_schema_only_ausbildung_duration.sql` ist von Hand in Production angewendet worden. Damit `supabase db push` sie nicht ein zweites Mal ausführt, gleicht ein Mensch das Ledger einmal ab (nicht ausgeführt durch dieses Paket):
   1. `supabase link --project-ref <Projekt-Referenz>`
   2. `supabase migration list --linked` und den Stand von lokalen Dateien und Ledger vergleichen.
   3. Gemessen am 23.10.2026 (nur lesend): Das Ledger `supabase_migrations.schema_migrations` reicht bis Version `20260227143256`, die Datei `202606260001` fehlt dort, obwohl ihre Spalte `profiles.ausbildung_duration_years` in Production existiert. Deshalb `supabase migration repair --status applied 202606260001`. Ein Drizzle-Ledger gibt es nicht, die Tabelle `training_catalogs` fehlt noch (die Katalog-Migrationen sind nirgends angewendet).
   4. `supabase db push --linked --dry-run` muss "Remote database is up to date." melden. Erst dann das erste Release.

   Solange das nicht erledigt ist, stoppt der Baseline-Guard (`scripts/db/baseline-guard.mjs`) den Release-Lauf.

4. **Preview einrichten.**
   1. `supabase/preview-setup/01-preview-role.sql` im SQL-Editor ausführen (Schemas `public_preview` und `preview_meta`, Rollen `app_preview` und `app_preview_migrator`). Danach beide Passwörter von Hand setzen (siehe Kommentar in der Datei) und nirgends ablegen.
   2. In Vercel für die Umgebung Preview `DB_CONNECTION_STRING` mit dem Benutzer `app_preview.<Projekt-Referenz>` eintragen, dazu die Supabase-Schlüssel (Abschnitt 5). In GitHub im Environment `Preview` das Secret `PREVIEW_DB_URL` mit dem Benutzer `app_preview_migrator.<Projekt-Referenz>` (Session-Pooler, Port 5432) eintragen.
   3. Workflow "Preview Reset" mit Modus `plan` starten (der Job `snapshot` im Environment `Production` liest nur die Struktur von `public`, danach zeigt `rebuild` den Plan), Ausgabe prüfen, dann mit `execute`. Das leert `public_preview`, klont die Struktur von `public` (nur Struktur, keine Zeilen) und führt `02-preview-side.sql` aus.
   4. `supabase/preview-setup/03-shared-objects.sql` im SQL-Editor ausführen (Realtime, Storage-Richtlinien für `preview/<Nutzer-Id>/`, Hilfsfunktion). Nach jedem späteren Reset erneut, weil die Preview-Tabellen neu entstehen.
   5. `supabase/preview-setup/04-verify.sql` ausführen und die erwarteten Ergebnisse vergleichen, besonders die Abfragen 3 bis 5 (Rechte auf `public`, `auth`, `storage`).
   6. Es gibt keine Änderung an Production und keinen Trigger. Gemessen am 23.10.2026 (nur lesend): Auf `auth.users` existiert kein Trigger, Profile entstehen über `/api/auth/sync-profile` in dem Schema, mit dem die jeweilige Bereitstellung verbunden ist. Ein Anmelde-Metadatum oder ein Zwillings-Trigger ist deshalb nicht nötig, und ein zusätzlicher Trigger auf der geteilten Tabelle `auth.users` könnte jede Anmeldung blockieren.
   7. Inhalt in Preview: Seed, Import oder Inhaltsabgleich in Richtung `production-to-preview` (zuerst als Trockenlauf).
5. **Releases von Hand veröffentlichen.** Mit dem `GITHUB_TOKEN` eines Workflows erzeugte Releases lösen keine Workflows aus (GitHub-Regel). Ein Release muss von einer Person oder mit einem persönlichen Token beziehungsweise einer GitHub-App erstellt werden. Releases entstehen nur aus `master`, der Release-Lauf prüft das.
6. **Vercel baut nicht mehr selbst.** Die Datei `vercel.json` setzt `git.deploymentEnabled` auf `false`. Das Vercel-Projekt `wamocon-fiae-svfz` (Production-Branch `master`) deployt dann weder Branches noch `master` automatisch, alle Deployments laufen über die Workflows. Gemessen am 23.10.2026 hatte das Projekt keinen Ignored Build Step und baute jeden Branch als Preview und `master` als Production. **Reihenfolge:** Wird dieser Pull Request gemergt, bevor Secrets, Variablen und Environments eingerichtet sind, deployt nichts mehr automatisch. Deshalb erst die Schritte 1 bis 5, dann mergen. `vercel.json` liegt im Repository und gilt für jedes Vercel-Projekt, das mit diesem Repository verbunden ist. Das zweite Projekt `wamocon-lfa` (baut nur den Branch `staging`) wird von diesem Paket nicht angefasst, würde mit der Datei aber ebenfalls nicht mehr automatisch bauen. Bitte vor dem Merge klären, ob `staging` weiter automatisch gebaut werden soll.
7. **Werte der Variablen (keine Geheimnisse).** `SUPABASE_PROJECT_REF_PROD` = `ngpsgwwlnlliphfgtrya` (Supabase-Projekt FIEA-Production, Region eu-west-1), `VERCEL_PROJECT_ID` = `prj_nbHzAS4oCNAgHaJh1gb8rfSAndHA`, `VERCEL_ORG_ID` = `team_3KLIxWWTDEzyuitA2oGwAorz`. Im Supabase-Dashboard (Data API, "Exposed schemas") ist heute `public, graphql_public, test` eingetragen: `public_preview` hinzufügen und das leere Schema `test` entfernen (Schritt 1). Das Token `SUPABASE_ACCESS_TOKEN` gehört in die Environments `Production` und `Preview`, nicht als Repository-Secret.

### Vercel-Region

`vercel.json` setzt `regions` auf `dub1` (Dublin). Die Funktionen liefen bisher in `iad1` (US-Ost), die Datenbank liegt in `eu-west-1` (Irland). Jede Abfrage einer API-Route überquerte den Atlantik, bei mehreren Abfragen je Anfrage summiert sich das auf spürbare Wartezeit. Dublin liegt im selben Rechenzentrumsraum wie die Datenbank. Die Einstellung ist optional und steht in einem eigenen Commit, sie lässt sich ohne Nebenwirkung zurücknehmen. Sie wirkt nur auf Deployments dieses Repositories (Production und Preview).

## 7. Einschränkungen

Bitte vor dem Einsatz lesen. Die Preview-Umgebung ist bewusst günstig gebaut und hat Grenzen.

- **Geteiltes Preview-Schema.** Alle Branches und Pull Requests migrieren dasselbe `public_preview`. Die Migration eines noch ungeprüften Branches läuft dort vor dem Review. Zwei Branches mit unvereinbaren Migrationen stören sich gegenseitig. Gegenmaßnahmen: Datenbanksperre pro Migration, Verlauf mit Prüfsumme (eine nachträglich geänderte, schon angewendete Datei bricht den Lauf ab), Warnung bei Migrationen anderer Branches, Concurrency-Gruppen, die nie abbrechen. Wenn nichts mehr hilft: Workflow "Preview Reset". Er löscht alle Preview-Daten.
- **Geteilte Auth.** Preview und Production nutzen dieselben Supabase-Nutzer und, solange die App den Dienstschlüssel braucht, auch denselben Dienstschlüssel (`SUPABASE_SECRET_KEY` beziehungsweise `SUPABASE_SERVICE_ROLE_KEY`). Ein Preview-Nutzer ist ein echter Auth-Nutzer, sein Profil entsteht beim ersten Aufruf von `/api/auth/sync-profile` in `public_preview`. Passwörter und Sitzungen gelten für beide Anwendungen.
  - **Mindestmaßnahme in der App.** Ist die Bereitstellung eine Preview (`IS_PREVIEW_SCHEMA`, `src/lib/db-schema.ts`), antworten alle Routen, die `auth.admin.*` nutzen, mit 403 und einer klaren Meldung, bevor sie etwas ändern: `POST /api/register`, `POST /api/admin/users` (Konto anlegen) und `DELETE /api/admin/users/[userId]` (Konto löschen). Auch die Registrierung im Browser (`signUp` im `AuthContext`) ist in Preview gesperrt. Der Schutz steht in `src/lib/preview-guard.ts` und ist mit Tests belegt.
  - **Restrisiko.** Der Dienstschlüssel von Production liegt weiterhin in der Preview-Umgebung, und neuer Code in einem Branch könnte `auth.admin.*` an anderer Stelle aufrufen, ohne den Schutz zu nutzen. Auch Funktionen mit Nutzerbezug (Passwort zurücksetzen, eigenes Passwort ändern) wirken auf das gemeinsame Konto. Neue Routen mit `auth.admin.*` brauchen deshalb im Review den Aufruf von `blockInPreview()`.
  - **Der robustere Weg** bleibt ein eigenes Supabase-Projekt für Preview (eigene Auth, eigener Schlüssel, eigener Speicher). Es macht die Sperre, die Rolle `app_preview`, das Schema `public_preview` und das Präfix `preview/` überflüssig, kostet aber ein zweites Projekt und einen Abgleich der Inhalte. Das Zwei-Schemas-Verfahren ist die gewählte, günstigere Lösung mit diesen bekannten Grenzen.
- **Geteilter Storage.** Die Buckets `avatar` und `content` sind geteilt. Uploads aus Preview landen unter dem Präfix `preview/`, die Richtlinien dafür (nur für Nutzer mit Profil in `public_preview`) legt `03-shared-objects.sql` an, von Hand. Dateien, die über den Inhaltsabgleich nach Production gelangen, behalten ihren Pfad unter `preview/`.
- **Clusterweite Objekte.** Rollen, Publikationen (Realtime) und Erweiterungen gibt es nur einmal. Migrationen, die sie ändern, werden für Preview abgelehnt, die Realtime-Mitgliedschaft der Preview-Tabellen setzt `03-shared-objects.sql`, von Hand.
- **Preview läuft Production voraus.** `public_preview` hat Migrationen, die `public` noch nicht hat. Das ist gewollt. Der Drift-Check meldet es nur als Hinweis.
- **Migrationen müssen rückwärtskompatibel sein.** Zwischen Migration und Deployment läuft kurz die alte App gegen das neue Schema. Erst erweitern, später aufräumen.
- **Rolle `app_preview`** umgeht Row Level Security (wie `postgres` für Production), hat aber keine Rechte auf `public`. `04-verify.sql` belegt das.
- **Inhaltsabgleich.** Siehe Abschnitt 8, die Schlüssel sind vorläufig.

## 8. Inhaltsabgleich

`scripts/db/content-sync.mjs` gleicht ausschließlich Ausbildungsinhalt ab, gesteuert von der Allowlist `supabase/content-tables.json`.

Regeln:

- Additiv und nie zerstörend: fehlende Zeilen werden eingefügt, gelöscht wird nie etwas.
- **Ein Release fügt nur ein** (`--update never`, Standard des Skripts). Bestehende Zeilen zu ändern ist eine eigene, bewusste Entscheidung: nur der manuelle Workflow "Content Sync" mit der Eingabe `update_mode = newer` wendet die Einstellung `update` je Tabelle an (`newer`, `always` oder `never`).
- **Spalten-Allowlist.** Je Tabelle steht in `columns` die ausdrückliche Liste der kopierten Spalten. Eine Spalte, die nicht genannt ist, wird nie kopiert, auch wenn beide Schemas sie haben (zum Beispiel neue Spalten späterer Migrationen oder `is_indexed_by_hai`). Schlüssel- und Remap-Spalten müssen in der Liste stehen, geheimnisartige Spaltennamen (`password`, `token`, `secret`, `credential`) werden abgelehnt.
- **Fremdschlüssel auf Nutzertabellen.** Ist eine kopierte Spalte ein Fremdschlüssel auf `profiles`, `organizations` oder ein Objekt in `auth` oder `storage` und hat keine `remap`-Regel, bricht der Abgleich ab, bevor etwas geschrieben wird.
- Der Abgleich erkennt Zeilen über konfigurierbare Schlüsselspalten (`key`). Fremdschlüssel werden über den Schlüssel der Elterntabelle übersetzt, weil die Ids der Schemas verschieden sind. Eine Zeile, deren Elter nicht übersetzt werden kann, wird übersprungen und gezählt.
- Alles oder nichts: ein Lauf in einer Transaktion unter Sperre. Ein nicht eindeutiger Schlüssel bricht ab.
- Trockenlauf ist Standard (Transaktion mit Rollback, genaue Zahlen). Mit Anwenden folgt ein zweiter Trockenlauf, der null Änderungen melden muss. Der Bericht mit den Zahlen je Tabelle steht auch im Job-Summary des Laufs, im Release also vor der Freigabe des folgenden Deployments einsehbar.
- Nie dabei: `profiles`, Abgaben, Fortschritt, Zeugnisse, Organisationen, Benachrichtigungen, `hai_embeddings` und alles, was Nutzerdaten enthält. Der Code lehnt solche Namen selbst dann ab, wenn sie in der Allowlist stünden. `profiles` und `organizations` werden nur gelesen, um Ids zu übersetzen (E-Mail beziehungsweise Slug).
- Ersteller (`created_by_id`) werden beim Einfügen gesetzt (Profil mit der E-Mail aus `CONTENT_SYNC_OWNER_EMAIL`, falls kein Profil mit gleicher E-Mail existiert) und beim Aktualisieren nie überschrieben.

Tabellen der Allowlist. Als vorläufig gelten alle Schlüssel außer `code`; die stabilen `code`-Spalten entstehen in einem anderen Strang, dann nur `key` in der JSON-Datei anpassen.

| Tabelle                                                                 | Schlüssel                                                                 | Status                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `training_catalogs`                                                     | `code`                                                                    | vorläufig, nur in der Migration eines anderen Branches, optional                                      |
| `courses`                                                               | `title`, `year`, `chapter`                                                | vorläufig                                                                                             |
| `enablers`, `use_cases`                                                 | `course_id`, `title`                                                      | vorläufig                                                                                             |
| `content_documents` (nur Metadaten, ohne `is_indexed_by_hai`)           | `title`, `file_name`, `document_type`                                     | vorläufig                                                                                             |
| `quizzes`                                                               | `title`, `quiz_type`                                                      | vorläufig                                                                                             |
| `enabler_quizzes`, `enabler_quiz_links`                                 | `enabler_id` beziehungsweise `enabler_id`, `difficulty`                   | vorläufig                                                                                             |
| `questions`, `options`                                                  | `quiz_id`, `question_text` beziehungsweise `question_id`, `option_text`   | vorläufig                                                                                             |
| `lernfelder`                                                            | `code`                                                                    | vorläufig (in `schema.ts` ist `lernfelder` doppelt definiert, angenommen ist die Variante mit `code`) |
| `lernfeld_mappings`                                                     | `lernfeld_id`, `enabler_id`, `use_case_id`                                | vorläufig                                                                                             |
| `training_components`                                                   | `code`                                                                    | vorläufig (nach der Katalog-Migration `training_catalog_id`, `code`)                                  |
| `training_use_cases`                                                    | `component_id`, `letter`                                                  | vorläufig                                                                                             |
| `training_catalog_learning_fields`, `training_catalog_content_mappings` | `training_catalog_id`, `code` beziehungsweise Lernfeld, Enabler, Use Case | vorläufig, optional                                                                                   |

Nicht aufgenommen, weil nicht in der Vorgabe genannt: `skills`, `course_skills`, `mes_softskill_criteria`, `certificate_text_templates`, `modules`, `lessons`.

## 9. Migrationen schreiben

- Datei `supabase/migrations/<14 Ziffern>_<name>.sql`, Name in Kleinbuchstaben. Zwei Altdateien mit 12 Ziffern stehen in `supabase/legacy-migrations.txt`.
- Neue Migrationen müssen neuer sein als jede Migration auf `master`. Bereits vorhandene Dateien werden nie geändert, umbenannt oder gelöscht.
- Zerstörende Anweisungen (Tabelle oder Schema entfernen, `alter table ... drop <Name>` auch ohne das Wort `column`, `drop owned`, `truncate`, `delete` ohne `where`) brauchen die Zeile `-- migration:destructive-ok`. `alter table ... drop constraint` zählt nicht dazu. Die Prüfung läuft im Pull Request gegen `master` und im Release-Lauf gegen das vorherige Release (neue Dateien seit dem letzten Release).
- Jede Migration wird für `public_preview` umgeschrieben (`public.` wird zu `public_preview.`, `begin` und `commit` werden entfernt). Was sich nicht sicher umschreiben lässt (Rollen, Publikationen, Änderungen an `auth`), lehnt die Prüfung ab. Einen Abschnitt, der für Preview nicht laufen soll, rahmen die Zeilen `-- preview:skip` und `-- preview:end`.
- Katalogabfragen brauchen ein Schema, Erweiterungen `if not exists` und `with schema extensions`.

Prüfen vor dem Push:

- `npm run test:scripts` (Unit-Tests der Skripte, ohne Datenbank)
- `npm run db:migrations:check` und `npm run db:preview:check`
- `node scripts/db/content-sync.mjs --linked` (Trockenlauf, braucht Zugang und läuft normalerweise nur in der CI)

## 10. Rollback-Hinweise

- **App.** Production Deploy deployt immer das letzte Release. Für einen Rückschritt das fehlerhafte Release auf GitHub zurückziehen oder die Markierung "Latest" auf das vorherige Release setzen und "Production Deploy" starten. Alternativ im Vercel-Dashboard auf das vorherige Deployment zurückgehen. Das ändert nur die App, nicht die Datenbank.
- **Datenbank.** Es gibt kein automatisches Zurück. Ein Fehler in einer Migration wird mit einer neuen Migration vorwärts korrigiert. Deshalb gilt: erweitern, dann umstellen, dann aufräumen. Vor riskanten Releases eine Datenbanksicherung anlegen.
- **Inhalte.** Der Abgleich löscht nichts. Ein falsch übernommener Inhalt wird in Production von Hand korrigiert, der Abgleich überschreibt ihn nur, wenn die Quelle neuer ist (`newer`).
- **Teilweise fehlgeschlagenes Release.** Ist die Migration durch und das Deployment gescheitert, "Re-run failed jobs" starten oder "Production Deploy" verwenden. Dessen lesende Prüfung stellt sicher, dass die Migrationen schon angewendet sind.
- **Preview.** Bei kaputtem Zustand "Preview Reset" (erst `plan`, dann `execute`). Das löscht alle Preview-Daten, Production bleibt unberührt.

## 11. Was geprüft ist und was nicht

Geprüft: Unit-Tests der reinen Funktionen (Umschreiben, Prüfregeln, Plan-Berechnung, Allowlist, SQL-Erzeugung, Deploy-Umgebung), Syntax aller Workflows und Skripte, TypeScript, Lint der geänderten App-Dateien, Jest der App-Schema-Auswahl.

Nur statisch geprüft, weil kein Zugriff auf Datenbank, Supabase oder Vercel bestand: das Verhalten gegen die echte Datenbank (Klonen der Struktur per Dump, Umschreiben eines echten Dumps, erzeugtes SQL des Inhaltsabgleichs, SQL-Vorlagen in `supabase/preview-setup`), die Supabase-CLI-Ausgaben (`db push --dry-run`, `db dump`, `db query`), die Environment-Secrets in Composite Actions, die Vercel-Builds. Der erste Lauf jedes Teils sollte ein Plan oder Trockenlauf sein.
