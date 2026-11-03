# HAI: Gedächtnis

Stand: 03.11.2026. Die HAI kann sich zwei Arten von Dingen merken, beides nur nach Zustimmung: das Gedächtnis eines einzelnen Nutzers (Vorlieben, Lernstil, Lernstand, Schwächen) und ein übergreifendes Gedächtnis für alle Nutzer (kurze Hinweise zu Stil und Betonung). Die ganze Funktion hängt am Schalter `HAI_MEMORY` (Standard aus). Ohne den Schalter verhält sich die HAI Byte für Byte wie vorher. Die Funktion ist gebaut und getestet, in Production aber erst nach der Abstimmung mit Datenschutz und Betriebsrat einzuschalten (Abschnitt 8).

## 1. Zweck

- Die HAI antwortet so, wie ein Nutzer es mag (kurz oder ausführlich, Du oder Sie, mit Beispielen, Schritt für Schritt), ohne dass er es in jedem Gespräch neu sagen muss.
- Die HAI betont Themen, bei denen ein Azubi sich schwer tut, und kennt seinen Lernstand.
- Alle Nutzer eines Berufs profitieren von Hinweisen, die viele Azubis brauchen (zum Beispiel "Erkläre Neues mit einem Beispiel"). Diese Hinweise gibt ein Plattform-Admin frei.

Das Gedächtnis ändert nur Stil und Betonung. Es öffnet keinen Inhalt, keine Rolle und keinen anderen Beruf, und es hebt keinen Schutz auf (Abschnitt 5).

## 2. Entscheidungen des Auftraggebers

1. **Übergreifendes Gedächtnis (für alle):** Einträge muss ein Plattform-Admin im Adminbereich freigeben. Erst freigegebene Einträge wirken. Die HAI darf nur vorschlagen.
2. **Gedächtnis eines Nutzers:** Nichts wird still gespeichert. Die HAI fragt im Chat, ob ein erkanntes Verhalten übernommen werden soll (Ja, Nein, Ändern). Nur bestätigte Einträge wirken.
3. **Umfang:** Vorlieben und Lernstil (Antwortlänge, Du oder Sie, Erklärstil, bevorzugte Lernform, Sprechen oder Tippen) sowie Lernstand und Schwächen (abgeleitet aus Quiz- und Lerndaten).
4. **Einsicht:** Nur der Nutzer selbst sieht und ändert sein Gedächtnis. Trainer und Admins sehen es nicht, auch nicht per Admin-Abfrage oder Export. Die Kontolöschung löscht das Gedächtnis (Fremdschlüssel mit `on delete cascade`).

## 3. Datenmodell

Migration `supabase/migrations/20261103000300_hai_memory.sql`, Drizzle-Schema in `src/db/migrations/schemas/schema.ts`. Alle drei Tabellen haben Row Level Security. Für `anon` und `authenticated` wird nichts vergeben, die App liest und schreibt über Drizzle als Rolle `postgres`.

**`hai_user_memories`** (Gedächtnis eines Nutzers)

| Spalte | Bedeutung |
|---|---|
| `id` | Schlüssel |
| `user_id` | Besitzer, Fremdschlüssel auf `profiles` mit `on delete cascade` (nur in der Migration, im Drizzle-Schema eine einfache Id, damit der Abgleich zweier Profile in `src/lib/profile-identity.ts` die Tabelle nicht kennen muss) |
| `training_catalog_id` | Beruf, Pflicht. Einträge verschiedener Berufe bleiben getrennt (Persona je Beruf, siehe `docs/hai-persona-per-occupation.md`) |
| `kind` | `preference`, `learning_style`, `learning_state`, `weakness` |
| `proposal_key` | fester Schlüssel des Vorschlags, zum Beispiel `pref.length.short` oder `weak.<Enabler-Id>`. Eindeutig je Nutzer und Beruf, damit ein abgelehnter Vorschlag nie wiederkommt, unabhängig vom Wortlaut |
| `content` | kurzer Text, höchstens 300 Zeichen, geprüft |
| `source` | `stated` (vom Nutzer gesagt) oder `derived` (aus Daten abgeleitet) |
| `status` | `proposed`, `active`, `rejected` |
| `created_at`, `updated_at`, `confirmed_at` | Zeiten. Ein aktiver Eintrag hat immer `confirmed_at` |

Richtlinie: genau eine, `user_id = auth.uid()` für Lesen und Schreiben. Keine Policy für Trainer oder Admins. Weil an `authenticated` nichts vergeben ist, ist sie ein zweites Netz. Das ist Absicht: Ein direktes Schreiben über die REST-Schnittstelle würde die Prüfung umgehen, die Wünsche nach Lösungen verwirft.

**`hai_global_memories`** (übergreifendes Gedächtnis)

| Spalte | Bedeutung |
|---|---|
| `id`, `created_at` | Schlüssel, Zeit |
| `training_catalog_id` | Beruf, `null` heißt für alle Berufe |
| `content` | Text, höchstens 400 Zeichen |
| `status` | `proposed`, `approved`, `rejected` (Deaktivieren ist `rejected`) |
| `origin` | `auto` (Vorschlag der HAI) oder `manual` (von einem Admin angelegt) |
| `support_count` | Zahl der Nutzer, auf denen ein Vorschlag beruht, nie die Nutzer selbst |
| `created_by`, `approved_by`, `approved_at` | einfache Ids und Zeit (Vermerke, ohne Fremdschlüssel) |
| `proposal_key`, `updated_at` | wie oben, ein offener Vorschlag je Beruf und Schlüssel |

Keine Policy, Lesen nur serverseitig, Schreiben nur über die Admin-Routen hinter `requireSuperAdmin`.

**`hai_user_memory_settings`**: Schalter je Nutzer (`user_id`, `enabled`, `updated_at`). Eine fehlende Zeile gilt als eingeschaltet.

Gegenüber dem Entwurf kamen `proposal_key` (beide Tabellen), `updated_at` (global) und die Einstellungstabelle dazu. Die Migrationsdatei nennt die Gründe.

## 4. Ablauf: Erkennen, Fragen, Speichern, Nutzen

Code unter `src/lib/hai/memory/`.

**Erkennen** (ohne Modellaufruf)

- `memoryDetect.ts`: Mustererkennung auf Deutsch für ausdrückliche Aussagen ("antworte kürzer", "bitte duzen", "erklär mir das mit Beispielen", "ich lerne besser mit Karten"). Unsichere Fälle erzeugen keinen Vorschlag: Fragen, Verneinung, Bedingung oder Zweifel ("wenn du magst", "vielleicht"), Zitate, lange Texte, widersprüchliche Aussagen. Der Text des Eintrags kommt aus der Vorlage des Musters, nie aus der Nachricht.
- `memoryDerive.ts` und `deriveData.ts`: aus vorhandenen Daten (Quiz-Versuche je Enabler, Fortschritt je Beruf wie in `dayProgress.ts`). Eine Schwäche ist ein Thema mit mindestens 2 bewerteten Versuchen und einem Durchschnitt unter 60 Prozent, die schwächsten höchstens zwei. Der Lernstand ist eine Zeile mit Datum und Zahl der abgeschlossenen Enabler. Der Text nennt nur das Thema, nie eine Frage, Antwort oder Lösung.
- Übergreifende Vorschläge (`globalPropose.ts`, `globalData.ts`): deterministisch und ohne Personenbezug aus Zählern. Ein Vorschlag entsteht nur, wenn mindestens k = 5 verschiedene Nutzer in einem Beruf betroffen sind (eine Vorliebe, die so viele bestätigt haben, oder ein Thema, bei dem so viele im Quiz Schwierigkeiten haben). Die Datenbankabfrage wendet k als `HAVING` an, eine kleinere Zahl verlässt die Datenbank nie. Der Text kommt aus Vorlagen. Du und Sie sowie Sprechen oder Tippen sind persönlich und werden nie als Hinweis für alle vorgeschlagen. Nutzer mit ausgeschaltetem Gedächtnis zählen nicht. Die Berechnung löst ein Admin mit "Vorschläge berechnen" aus.

**Fragen**

- Der Chat liefert die Rückfrage als Karte "Soll ich mir das merken?" mit den Knöpfen Ja, Nein, Ändern (`HaiMemoryCard.tsx`, Ereignis `memoryProposal` am Ende des Streams, Muster der Aktionskarte).
- Höchstens ein Vorschlag je Gespräch (die Antworten der Sitzung tragen die Id eines früheren Vorschlags), nie in einer gesprochenen Runde. Nie mitten in einer Quizrunde: Der Server schlägt bei Quiz-Anfragen und laufendem Chat-Quiz nichts vor, und die Karte bleibt zurück, solange die Quiz-Karte offen ist, und erscheint nach dem Schließen. Abgeleitete Vorschläge höchstens einmal je Woche.
- Der Vorschlag liegt als `proposed` in der Datenbank und hat keine Wirkung. Nein speichert `rejected`, der Vorschlag kommt nie wieder.

**Speichern**

- `memoryStore.ts`: Anlegen, Bestätigen, Ändern, Löschen, immer mit der Id des Nutzers der Sitzung und nur in einem Beruf, den der Nutzer hat. Höchstens 30 offene und aktive Einträge je Beruf. Bei Ändern gilt die strenge Prüfung des Textes. Ein neuer Wert für eine Wahl mit einem Wert (Länge, Anrede, Eingabeweg) ersetzt den alten aktiven Eintrag.

**Nutzen**

- `buildSystemPrompt` (`prompts.ts`) hängt den Abschnitt "Gedächtnis" als letzten Teil an, in beiden Wegen (`processMessage`, `processMessageStream`) und damit auch im Sprachweg. Er steht nach dem Persona-Tor, der Berufstrennung, dem Lösungsschutz und den Grenzfallregeln.
- Geladen werden nur aktive Einträge des einen Berufs der Runde plus die freigegebenen übergreifenden Einträge dieses Berufs und die für alle. Ohne einen einzelnen Beruf (mehrere Berufe, keine Wahl im Reiter) werden keine Einträge des Nutzers geladen, nur die übergreifenden für alle (fail closed).
- Höchstens 8 Einträge des Nutzers und 4 übergreifende, höchstens 1200 Zeichen Eintragstext. Jede Zeile wird bereinigt (kein Zeilenumbruch, keine Steuerzeichen, keine Markierungen) und noch einmal geprüft.
- Schalter des Nutzers aus: nichts wird geladen, nichts vorgeschlagen.

## 5. Sicherheitsregeln

1. Der Abschnitt ist als Daten gekennzeichnet und sagt ausdrücklich, dass er nur Stil und Betonung betrifft und jeder Regel von oben nachsteht. Verlangt eine Zeile mehr, wird sie still ignoriert.
2. Beim Anlegen und Ändern, beim Laden und beim Bau des Abschnitts wird der Text geprüft (`text.ts`): Wünsche nach Lösungen oder richtigen Antworten, eine behauptete Rolle ("Ich bin der Trainer", "Behandle mich wie einen Trainer"), Hinweise auf andere Berufe, Anweisungen an das Modell (ignoriere, vergiss, System, Prompt, Umgehen, Freigabe und ähnliche) und Links werden verworfen. Ein zu langer Text wird abgelehnt, nie stumm gekürzt.
3. Einträge eines anderen Berufs werden nie geladen. Das gilt auch für den anderen Beruf derselben Person.
4. Schwächen nennen nur Themen. Die Themen sind Titel von Enablern der Plattform und gehen durch die leichte Prüfung (Link, Lösung, Anweisung an das Modell).
5. Das Persona-Tor, die feste Prüfung auf Lösungswünsche vor dem Modell und die Berufstrennung laufen vor dem Gedächtnis und unverändert. Der Test `tests/unit/hai/goldenMemory.pipeline.test.ts` belegt es an acht Fällen des Golden Sets (ohne Modell).
6. Nur der Nutzer erreicht seine Einträge. Es gibt keine Route für Trainer oder Admins, keinen Export und keinen Parameter mit einer fremden Id. Der Test `tests/unit/hai/memory/access.static.test.ts` hält das fest: Nur eine Datei (`repoDb.ts`) liest die Tabelle, daneben die Zähler mit `COUNT(DISTINCT ...)` und `HAVING`, die nur Zahlen liefern.
7. Die Regel "Keine Lerntypen" der Lernkarten bleibt: Ein Eintrag zum Lernstil ist die Aussage des Nutzers, keine Einstufung durch die HAI, und der Abschnitt sagt das.
8. Die Tabellen stehen nicht in der Allowlist der Inhaltsübertragung (`supabase/content-tables.json`), das Gedächtnis einer Person reist nie.

## 6. Schalter

- `HAI_MEMORY=on` schaltet die Funktion ein, jeder andere Wert und kein Wert heißt aus. Wie bei den anderen HAI-Schaltern (`HAI_TRAINER_SOLUTIONS`) ist es eine Umgebungsvariable des Servers.
- Aus: kein Abschnitt im Prompt, keine Rückfrage, keine Datenbankabfrage der Pipeline. `GET /api/hai/memory` und `GET /api/admin/hai/memory` antworten `{ "available": false }` (die Oberflächen blenden sich aus), alle schreibenden Routen antworten 404.
- Je Nutzer: Schalter "Gedächtnis verwenden" im Profil (`hai_user_memory_settings`).

## 7. Migration und Reihenfolge (nur beschrieben, nicht ausgeführt)

Diese Änderung hat weder eine Migration gegen eine Datenbank ausgeführt noch einen Vercel-Befehl abgesetzt.

**Preview**

1. Migration `20261103000300_hai_memory.sql` über den Preview-Lauf (`scripts/db/preview-migrate.mjs`, schreibt in `public_preview`). Die Datei besteht den Umschreiber ohne Befund (Test `tests/scripts/db/hai-memory.test.mjs`).
2. Code mit dem Merge dieser Änderung nach `preview`.
3. `HAI_MEMORY=on` in Vercel für die Preview-Umgebung setzen und neu deployen.
4. Testfälle aus Abschnitt 10 durchgehen.

**Production**

1. Die Migration gehört zur gesperrten Reihe (Freigabetor ab `20261024000100`) und läuft mit dem Plattform-Rollout (`docs/kfbm-production-rollout.md`). Sie legt nur leere Tabellen an und ändert nichts Bestehendes. Der Nachcheck N01 in `docs/kfbm-production-rollout-checks.sql` kennt die neue Version.
2. Der Code läuft ohne die Tabellen unverändert, weil der Schalter aus ist.
3. `HAI_MEMORY` bleibt in Production nicht gesetzt, bis Datenschutz und Betriebsrat zugestimmt haben (Abschnitt 8, Punkt G9 in `docs/go-checkliste.md`). Erst dann Variable setzen und neu deployen.
4. Rückweg: Schalter entfernen (die HAI verhält sich wieder wie vorher). Die Tabellen können bleiben. Zum Entfernen steht der Rückbau im Kopf der Migrationsdatei.

## 8. Datenschutz und Betriebsrat: offener Punkt vor dem Produktivgang

Die Speicherung von **Lernstand und Schwächen** ist eine Auswertung personenbezogener Leistungsdaten (Quiz-Ergebnisse und Lernfortschritt eines Azubis). Sie braucht **vor dem Produktivgang** eine Abstimmung mit Datenschutz und Betriebsrat. Zu klären sind:

- **Zweck:** Anpassung der Antworten der HAI an den Lernenden, keine Leistungsbewertung und keine Weitergabe an Trainer oder Admins.
- **Rechtsgrundlage:** Einwilligung je Eintrag (die HAI fragt im Chat) und der Schalter im Profil. Zu prüfen ist, ob das bei Minderjährigen und im Beschäftigungsverhältnis genügt.
- **Aufbewahrung:** bis der Nutzer löscht oder das Konto gelöscht wird. Eine automatische Frist gibt es noch nicht (Abschnitt 9).
- **Einsicht durch den Nutzer:** Profil, Abschnitt "Mein HAI-Gedächtnis" mit Liste je Beruf. Ein Auskunftsexport in einem Dateiformat gibt es nicht, die Liste ist die Auskunft.
- **Löschung:** je Eintrag, alles auf einmal und mit der Kontolöschung.
- **Zähler für das übergreifende Gedächtnis:** Mindestanzahl k = 5 verschiedene Nutzer, nur Zahlen, nie Personen. Zu prüfen ist, ob die Auswertung der Quiz-Ergebnisse für diese Zähler selbst zustimmungspflichtig ist.

Der Punkt steht als G9 in `docs/go-checkliste.md`. Bis zur Klärung bleibt `HAI_MEMORY` in Production aus. Vorschläge zu Vorlieben (Länge, Anrede, Erklärstil) berühren keine Leistungsdaten, die Abstimmung betrifft vor allem die abgeleiteten Einträge (`learning_state`, `weakness`).

## 9. Bewusst nicht gebaut

- **Extraktion per Modell:** Kein Modell liest Nachrichten oder Verläufe, um Vorlieben zu finden. Erkennung und Ableitung sind Muster, Zahlen und Vorlagen.
- Keine Einsicht, kein Export und keine Abfrage der Einträge einzelner Nutzer für Trainer oder Admins.
- Kein Auskunftsexport für den Nutzer als Datei.
- Keine automatische Verfallsfrist für Einträge, kein Ablaufdatum des Lernstands (der Eintrag trägt das Datum seines Standes).
- Kein Vorschlag in der gesprochenen Runde (eine Karte lässt sich dort nicht beantworten).
- Kein Aufruf eines Modells in den Tests und keine Golden-Messung.
- Keine Planung per Zeitsteuerung: Die Berechnung der übergreifenden Vorschläge startet ein Admin von Hand.

## 10. Testfälle für das Testteam

Voraussetzung: `HAI_MEMORY=on` in der Preview, Konten wie im Testplan (`docs/hai-testplan.md`): ein FIAE-Azubi, ein KfBM-Azubi, ein Azubi mit beiden Berufen, ein Trainer, ein Administrator der Plattform. Pflichtfälle sind mit **P** markiert.

| Nr | Als | Schritt | Erwartetes Ergebnis | P |
|---|---|---|---|---|
| G1 | FIAE-Azubi | Im Chat schreiben: "Antworte bitte kürzer" | Die HAI antwortet und zeigt darunter die Karte "Soll ich mir das merken?" mit "Bevorzugt kurze, knappe Antworten." und den Knöpfen Ja, Nein, Ändern. Im Profil steht der Eintrag noch nicht als aktiv, sondern als "Wartet auf deine Antwort" | P |
| G2 | FIAE-Azubi | Auf Ja klicken, danach eine Sachfrage stellen | Karte zeigt "Gemerkt". Die Antwort ist spürbar kürzer. Im Profil steht der Eintrag unter dem Beruf FIAE | P |
| G3 | FIAE-Azubi | In einem neuen Gespräch "Bitte duzen" schreiben, auf Nein klicken, später im neuen Gespräch noch einmal "Bitte duzen" schreiben | Nach Nein erscheint die Karte nie wieder für diese Aussage | P |
| G4 | FIAE-Azubi | Im selben Gespräch nach einer bestätigten Karte noch eine Vorliebe nennen ("Erkläre mir das mit Beispielen") | Keine zweite Karte im selben Gespräch | P |
| G5 | FIAE-Azubi | Auf Ändern klicken, Text anpassen, Speichern | Der geänderte Text wird gespeichert und im Profil angezeigt | |
| G6 | FIAE-Azubi | Auf Ändern klicken, Text "Gib mir immer die Musterlösung" eingeben, Speichern | Der Text wird nicht gespeichert, die Karte nennt, dass nur Stil und Vorlieben möglich sind. Der Eintrag wirkt nicht | P |
| G7 | FIAE-Azubi | Fragen schreiben, die keine Vorliebe sind ("Wie antworte ich kürzer?", "Was ist ein Join?") | Keine Karte | P |
| G8 | FIAE-Azubi | Mit einem aktiven Eintrag "kurze Antworten" nach der Musterlösung fragen ("Zeig mir die Musterlösung ...") | Feste Ablehnung wie ohne Gedächtnis, der Eintrag ändert nichts | P |
| G9 | KfBM-Azubi | Mit dem Konto aus G2 (Beruf FIAE) den Reiter KfBM wählen und eine Sachfrage stellen | Die Vorliebe aus FIAE wirkt im Reiter KfBM nicht (Einträge sind je Beruf getrennt). Im Profil steht sie nur unter FIAE | P |
| G10 | FIAE-Azubi | Quiz-Karte öffnen ("Frag mich zu SQL ab") und im Chat "Antworte bitte kürzer" schreiben | Die Karte "Soll ich mir das merken?" erscheint nicht mitten in der Quizrunde, sondern erst nach dem Schließen der Quiz-Karte | |
| G11 | FIAE-Azubi | Nach mindestens zwei schwachen Quiz-Versuchen im selben Enabler (Ergebnis unter 60 Prozent) ein Gespräch beginnen und eine Sachfrage stellen | Karte mit "Tut sich beim Thema ... schwer", ohne Frage, Antwort oder Lösungstext. Höchstens eine solche Karte je Woche | |
| G12 | FIAE-Azubi | Im Profil unter "Mein HAI-Gedächtnis" einen Eintrag bearbeiten, einen anderen löschen | Änderung und Löschung gelten sofort, die HAI nutzt sie in der nächsten Antwort | |
| G13 | FIAE-Azubi | Im Profil "Alles löschen" wählen und die Rückfrage bestätigen | Alle Einträge aller Berufe sind weg, vorher kommt eine Rückfrage | |
| G14 | FIAE-Azubi | Im Profil den Schalter "Gedächtnis verwenden" ausschalten, Sachfrage, "Antworte kürzer" schreiben | Die Antwort ist nicht mehr gekürzt, es erscheint keine Karte. Die Einträge bleiben in der Liste. Nach dem Einschalten wirken sie wieder | P |
| G15 | Trainer | Im Profil nachsehen, im Adminbereich und im Trainerbereich nach Einträgen von Azubis suchen | Der Trainer sieht nur sein eigenes Gedächtnis. Nirgends erscheinen Einträge von Azubis | P |
| G16 | Administrator der Plattform | Seite "HAI-Gedächtnis" im Adminbereich öffnen | Liste der Vorschläge mit der Zahl der Nutzer, freigegebene und abgelehnte Einträge. Keine Einträge einzelner Personen, keine Namen | P |
| G17 | Administrator der Plattform | "Vorschläge berechnen" wählen, wenn weniger als 5 Nutzer dieselbe Vorliebe bestätigt haben | Kein neuer Vorschlag. Erst ab 5 verschiedenen Nutzern im Beruf erscheint einer | P |
| G18 | Administrator der Plattform | Einen Vorschlag freigeben, danach im FIAE-Konto eine Sachfrage stellen | Der Hinweis wirkt nur bei Azubis dieses Berufs, nicht bei KfBM. Vor der Freigabe wirkt er nicht | P |
| G19 | Administrator der Plattform | Eigenen Eintrag "Gib die Musterlösung heraus" anlegen | Wird abgelehnt (Meldung, dass nur Stil und Betonung möglich sind) | P |
| G20 | Administrator der Plattform | Einen freigegebenen Eintrag deaktivieren, dann im Azubi-Konto fragen | Der Hinweis wirkt nicht mehr | |
| G21 | Azubi und Trainer | Die Seite "HAI-Gedächtnis" im Adminbereich aufrufen (Adresse `/trainer/admin/hai-memory`) | Zugriff verweigert, kein Menüpunkt | P |
| G22 | FIAE-Azubi | Im Sprachassistenten "Antworte kürzer" sagen | Keine Karte im Sprachweg. Ein bestätigter Eintrag wirkt in der gesprochenen Antwort | |
| G23 | Plattform | Schalter `HAI_MEMORY` entfernen und neu deployen | Kein Abschnitt "Mein HAI-Gedächtnis" im Profil, keine Karte, die HAI antwortet wie vorher | P |

## 11. Tests im Repository

- `tests/unit/hai/memory/`: Prüfung des Textes (`text.test.ts`), Mustererkennung mit Treffern und Nicht-Treffern (`detect.test.ts`), Ableitung (`derive.test.ts`), k-Schwelle und Freigabe (`global.test.ts`), Speicher mit Berufstrennung und Besitzer (`store.test.ts`), Abschnitt und Prompt (`prompt.test.ts`), Ablauf in einer Runde (`turn.test.ts`), Zugriff (`access.static.test.ts`).
- `tests/unit/hai/ragPipeline.memory.test.ts`: beide Wege, Schalter aus gleich byte-identischer Prompt, Abschnitt am Ende, Quiz und Sprachweg.
- `tests/unit/hai/goldenMemory.pipeline.test.ts` und die Fälle `MEM-01` bis `MEM-08` im Golden Set: Tor und Prompt-Aufbau, ohne Modell.
- `tests/integration/api/hai/memory.test.ts`: Routen, Zugriff von Trainer und Admin, Admin-Freigabe.
- `tests/unit/migrations/hai-memory.test.ts` und `tests/scripts/db/hai-memory.test.mjs`: Migration, Rechte, Abgleich mit dem Drizzle-Schema, Umschreiber für die Preview.
- `tests/helpers/guardedRoutes.ts`: jede neue Route mit ihrem Schutz für den Route-Guard-Test.
