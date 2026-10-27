WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn

# Spike: Verbindungsadapter für die Übernahme (Paket U1)

Stand: 27.10.2026. Gehört zu `docs/ki-upload-konzept.md`, Abschnitt 8.1 (Anbindung an die Apply-Engine), 11.2 (Paket U1) und 11.3 (Risiko Verbindungsadapter). Alle Messungen laufen gegen lokale Wegwerf-Container. Es gab keine Verbindung zu Production, zur gehosteten Preview oder zu einem Supabase-Projekt, und keine Zugangsdaten wurden gelesen.

## 1. Ergebnis in Kürze

- **Die Engine läuft unverändert über eine reservierte Verbindung hinter einem Pooler im Transaktionsmodus.** Probelauf, Übernahme und Prüfung (`check`) liefern dieselben Zahlen wie auf der direkten Verbindung. Der Advisory-Lock hält zwei gleichzeitige Läufe auseinander.
- **Der Weg ist `sql.reserve()` von postgres-js** (der Treiber der App) oder `pool.connect()` von `pg`, nicht `sql.begin`. Der kleine Adapter dafür steht in `src/lib/content-upload/connection.ts` und ist gegen Fälschungen getestet. Die Engine bleibt unverändert.
- **Was hinter dem Pooler bricht:** nur Zustand, der über eine Transaktion hinausreicht, nämlich `set` ohne `local`, Advisory-Locks auf Sitzungsebene und benannte vorbereitete Anweisungen (`prepare: true`) bei parallelem Verkehr. Die Engine nutzt nichts davon (`set local`, `pg_try_advisory_xact_lock`, nur `unsafe()` mit Parametern).
- **Laufzeit des vollen Plans (222 Enabler, 6994 Fragen, 27 976 Optionen):** lokal 1,5 bis 2,1 Sekunden für den ersten Probelauf mit 91 Anweisungen, 0,57 Sekunden bei gefülltem Katalog. Mit einer eingestellten Wartezeit von 20 Millisekunden je Anweisung (tatsächlich etwa 26) 4,1 Sekunden und 1,1 Sekunden. Der Probelauf der Engine ist also **kein** Zeitproblem. Offen und größer ist der Planbau aus den Dateien (Staging lesen, Word parsen), siehe 6.
- **Empfehlung:** Übernahme als Route mit reservierter Verbindung (Adapter), Planbau und Probelauf als getrennte Schritte, Rückfall Skript (Abschnitt 7).

### Prüfung nach drei Sichtweisen

| Sichtweise | Befund | Folge |
| ---------- | ------ | ----- |
| IQ | Die Engine braucht eine Verbindung mit eigener Transaktion, der Pooler pinnt eine Serververbindung für die Dauer der Transaktion. Beides passt, solange kein Zustand außerhalb der Transaktion gebraucht wird. | Reservierte Verbindung, nur `set local` und Transaktions-Locks. |
| EQ | Der Eigentümer verlässt sich darauf, dass ein Fehler nichts übernimmt und dass kein Lauf hängen bleibt. | Verbindung wird in jedem Fall freigegeben, nach einem Fehler verworfen, Wartezeit auf eine freie Verbindung ist begrenzt. |
| VQ | Wenige Zahlen entscheiden: 91 Anweisungen, 1,5 bis 7 Sekunden, ein Platz im Pooler je Lauf. | Tabellen 4.1 bis 4.3 und das Modell in 4.4. |

**Synthese:** Adapter auf `sql.reserve()` bauen, die Engine nicht anfassen, die Messung in U7 gegen die echte Preview wiederholen.

## 2. Was verwendet wird (Fakten aus dem Code)

| Stelle | Treiber und Verhalten |
| ------ | --------------------- |
| `src/db/index.ts` (die App) | postgres-js 3.4.7 über Drizzle, `max: 10`, `prepare: false` ("Required for PgBouncer pooler compatibility"). Verbindungszeichenfolge aus `DB_CONNECTION_STRING`. |
| `src/lib/content-import/apply/pg-db.ts` (die Engine) | Schnittstelle `Queryable` mit `query(text, values)`, Ergebnis `{ rows, rowCount }`. `withTransaction` sendet `begin isolation level repeatable read read write` (oder `read only`), `set local lock_timeout`, `set local statement_timeout`, `set local row_security = off`, `select pg_try_advisory_xact_lock(hashtext($1))`, am Ende `commit` oder `rollback` als gewöhnliche Anweisungen auf derselben Verbindung. |
| `scripts/import/kfbm-session.mjs` (die Skripte) | `pg.Client` (ein Einzelclient), kein Pool. |

postgres-js lehnt `begin` auf dem Pool ab (`UNSAFE_TRANSACTION`, `node_modules/postgres/src/connection.js`), auf einer reservierten Verbindung (`connection.reserved`) ist es erlaubt.

## 3. Aufbau des Spikes

Nur lokal, nur Wegwerf-Container, danach entfernt. Der Pooler ersetzt Supavisor (Port 6543 in der Preview), nicht die gehostete Preview.

| Baustein | Wert |
| -------- | ---- |
| Datenbank | `public.ecr.aws/supabase/postgres:17.11.0.006`, Port 54341, Struktur von Production (Snapshot vom 23.10.2026), alle Migrationen bis `20261029000300` und die Migration von U1 |
| Pooler | `edoburu/pgbouncer` mit PgBouncer 1.26.1, Port 6439, `POOL_MODE=transaction`, `DEFAULT_POOL_SIZE=5`, `AUTH_TYPE=scram-sha-256` |
| Prepared Statements | zusätzlich `max_prepared_statements = 0`, damit der Pooler sich wie ein Pooler ohne Unterstützung benimmt (Annahme für Supavisor, siehe 8) |
| Plan | der volle KfBM-Plan (13 MB, 222 Enabler) und ein kleiner Plan (5 Komponenten, 650 Fragen), beide aus dem lokalen Planbau des Importskripts, nicht im Repository |
| Befehle | `scripts/spike/content-upload-connection.mjs` (Engine) und `scripts/spike/content-upload-pooler-probes.mjs` (Eigenheiten des Pooler), beide lehnen jeden Host außer Loopback ab |

```
docker run -d --name u1_pg -e POSTGRES_PASSWORD=pw -p 54341:5432 public.ecr.aws/supabase/postgres:17.11.0.006
docker run -d --name u1_bouncer -p 6439:5432 -e DB_HOST=<IP von u1_pg> -e DB_PORT=5432 \
  -e DB_USER=postgres -e DB_PASSWORD=pw -e POOL_MODE=transaction -e AUTH_TYPE=scram-sha-256 \
  -e DEFAULT_POOL_SIZE=5 -e ADMIN_USERS=postgres edoburu/pgbouncer:latest

node scripts/spike/content-upload-connection.mjs --variant pgjs-pooler \
  --url postgresql://postgres:pw@127.0.0.1:6439/<db> --plan <plan.json> \
  --created-by <Profil-UUID> --mode dry-run --repeat 3 [--latency 20] [--facts no]
node scripts/spike/content-upload-pooler-probes.mjs \
  --pooler postgresql://postgres:pw@127.0.0.1:6439/<db> \
  --direct postgresql://postgres:pw@127.0.0.1:54341/<db>
```

Varianten des Engine-Skripts: `pg-direct` (pg.Client auf der Datenbank), `pg-pooler` (pg.Client auf dem Pooler), `pgjs-pooler` (postgres-js mit `sql.reserve()` und dem Adapter, `prepare: false`), `pgjs-begin` (postgres-js mit `sql.begin`, zum Vergleich). Der Katalog KFBM war lokal auf aktiv gesetzt, die Engine lehnt sonst einen inaktiven Katalog ab.

## 4. Messungen

### 4.1 (a) Läuft die Engine über eine reservierte Verbindung hinter dem Pooler?

Ja. Gleiche Zahlen in allen drei Wegen, kein Konflikt, Probelauf schreibt nichts (Fragen nach den Probeläufen: 0), die Übernahme über den Pooler hat festgeschrieben (6994 Fragen, 27 976 Optionen) und ein Folgelauf meldet alles als unverändert.

| Weg | Ergebnis |
| --- | -------- |
| `pg.Client` direkt | Probelauf, Übernahme, `check` wie erwartet |
| `pg.Client` auf dem Pooler | wie direkt |
| postgres-js, `sql.reserve()`, `prepare: false` | wie direkt, Übernahme festgeschrieben |
| zwei Läufe gleichzeitig über den Pooler | einer läuft, der zweite endet mit `LOCKED` ("Another import is running (advisory lock). Nothing was written.") |
| Verbindung des Clients bricht in der Transaktion ab | nichts festgeschrieben, kein Hänger "idle in transaction" |

Die Messungen sind von Hand mit den beiden Skripten gelaufen und ihre Ausgabe ist nicht im Repository gespeichert. Die Zahl der beantworteten Abfragen in Probe p1 und die Zeiten schwanken von Lauf zu Lauf. Der Fall "zwei Läufe gleichzeitig" entstand aus zwei gleichzeitigen Aufrufen des Engine-Skripts (zweiter Aufruf mit einer Sekunde Versatz, je 40 ms Wartezeit je Anweisung), die Probe p3 prüft nur den Lock selbst.

### 4.2 (b) Was bricht

| Prüfung (Probe) | Beobachtung | Folge für die Engine |
| --------------- | ----------- | -------------------- |
| Transaktion pinnt eine Serververbindung (p4) | 40 Anweisungen in `begin ... rollback`: ein einziger Backend-Prozess, Isolation `repeatable read`. Außerhalb einer Transaktion wechselt derselbe Client zwischen 4 Backends. | Trägt die Transaktion der Engine. Alles, was vor oder nach der Transaktion steht, darf nicht vom selben Backend ausgehen. |
| `set` ohne `local` (p2) | Client A setzt `statement_timeout = 7s`, der nächste Client B sieht ebenfalls 7s: der Zustand wandert zu einem anderen Client. | Die Engine nutzt nur `set local`, das nach `commit` und `rollback` verschwindet (gemessen: innen 9s, danach wieder der alte Wert). Niemand darf in der App ein `set` ohne `local` senden. |
| Advisory-Lock auf Sitzungsebene (p3) | `pg_advisory_lock` bleibt nach dem Ende des Clients auf der Serververbindung gehalten (1 Lock gezählt). | Die Engine nutzt `pg_try_advisory_xact_lock`, das mit der Transaktion endet. Gemessen: erster Client erhält den Lock, zweiter nicht, nach dem Commit wieder ja. Sitzungs-Locks sind in der App verboten. |
| Benannte vorbereitete Anweisungen (p1) | Mit `max_prepared_statements = 0` und `prepare: true` bei parallelem Verkehr: 86 von 200 Abfragen beantwortet, der Rest ohne Antwort (der Client hängt). Mit `prepare: false`: 200 von 200. `unsafe()` mit Parametern auch bei gesetztem `prepare: true`: 200 von 200. `pg` mit Parametern: 12 von 12. | Die Engine sendet nur `unsafe()` mit Parametern. Die App setzt `prepare: false`. Beides bleibt Pflicht, auch für den Adapter. |
| `begin` auf dem Pool ohne Reservierung (p5) | `UNSAFE_TRANSACTION`, **aber** der Server hat das `begin` schon ausgeführt: danach steht ein Backend "idle in transaction". | Nie `begin` über den Pool senden. Mit `max: 1` lässt der Treiber es zu, das ist keine Lösung für die App (max 10). |
| `sql.begin` mit eigenem `begin` darin (`pgjs-begin`) | Geht nur, wenn das innere `begin isolation level ...` die **erste** Anweisung ist (PostgreSQL wendet die Optionen auch im offenen `begin` an, solange keine Abfrage lief). Liest die Engine vorher die Fakten der Verbindung (`checkTargetFacts` braucht sie), endet der Lauf mit `25001 SET TRANSACTION ISOLATION LEVEL must be called before any query`. Zusätzlich je Lauf die Hinweise `25001 there is already a transaction in progress` und `25P01 there is no transaction in progress` (der Treiber sendet sein eigenes `commit` nach dem der Engine). | Technisch möglich, aber zerbrechlich und von der Reihenfolge abhängig. Nicht als Adapter verwenden. |
| 5 offene Transaktionen füllen den Pool (p6) | Ein sechster Client wartet 2,5 s, bis ein Platz frei wird. | Ein Lauf der Übernahme belegt einen Platz im Pooler für seine Dauer. Siehe 4.4 und 8. |

### 4.3 (c) Laufzeit der Engine (voller Plan, lokal)

Messung der Engine ohne Planbau und ohne Laden der 13 MB JSON. Wiederholung drei- bis zweimal, Spanne in der Tabelle.

| Lauf | Weg | Anweisungen | Zeit |
| ---- | --- | ----------- | ---- |
| Probelauf, leere Datenbank (alles neu) | `pg.Client` direkt | 91 | 1,50 bis 1,55 s |
| | `pg.Client` auf dem Pooler | 91 | 1,59 bis 1,69 s |
| | postgres-js `sql.reserve()` auf dem Pooler | 91 | 1,67 bis 2,08 s |
| Übernahme, leere Datenbank | postgres-js `sql.reserve()` auf dem Pooler | 91 | 1,73 s |
| Probelauf, gefüllte Datenbank (alles unverändert) | `pg.Client` direkt | 18 | 0,54 bis 0,58 s |
| | postgres-js `sql.reserve()` auf dem Pooler | 18 | 0,56 s |
| `check` (nur lesen), gefüllt | postgres-js `sql.reserve()` auf dem Pooler | 17 | 0,57 s |
| Kleiner Plan (650 Fragen, 2600 Optionen), Probelauf | alle Wege | | 0,19 bis 0,27 s |

Der gefüllte Fall ist der Normalfall der Preview nach dem ersten Import: `executePlan` liest den ganzen Katalog (etwa 7 MB: Optionen 3,7 MB, Fragen 1,1 MB, Enabler 2,2 MB, Dokumentzeilen 0,2 MB) und schreibt nichts.

### 4.4 Hochrechnung mit Antwortzeit der Datenbank

Die Engine sendet wenige große Anweisungen (höchstens 500 Zeilen je `insert`). Mit dem Schalter `--latency` wartet der Spike vor jeder Anweisung (Stellvertreter für die Strecke Vercel zur Datenbank). Der Timer unter Windows ist grob: Die tatsächliche Wartezeit je Anweisung lag über dem eingestellten Wert (aus der Laufzeit zurückgerechnet etwa 10, 26 und 58 Millisekunden für 5, 20 und 50). Die Werte sind deshalb eher zu hoch als zu niedrig.

| Eingestellt (tatsächlich je Anweisung) | Probelauf neu (91 Anweisungen) | Probelauf gefüllt (18 Anweisungen) |
| -------------------------------------- | ------------------------------ | ---------------------------------- |
| 0 ms | 1,7 s | 0,56 s |
| 5 ms (etwa 10 ms) | 2,6 s | |
| 20 ms (etwa 26 ms) | 4,1 s | 1,1 s |
| 50 ms (etwa 58 ms) | 7,0 s | |

Faustformel mit der tatsächlichen Wartezeit w: Zeit ≈ 1,7 s plus 91 mal w (neu) beziehungsweise 0,55 s plus 18 mal w (gefüllt). Die Streuung des Datenvolumens (7 MB je Lauf) ist darin nicht enthalten. **Annahme:** Die Wartezeit zwischen Vercel (Region `dub1`) und Supabase liegt bei 5 bis 20 Millisekunden, in der Preview zu messen.

**Nicht gemessen und zusätzlich zu rechnen:** das Protokoll der Übernahme (`content_upload_applied_rows`, bei vollem Plan etwa 36 000 Zeilen, grob 70 weitere `insert`-Anweisungen, **Annahme**), die Use-Case-Engine in derselben Transaktion (etwa 225 Use Cases, gleiche Bauart, nicht gemessen) und der Planbau (Abschnitt 6).

## 5. Korrektur zum Konzept

Konzept 8.1 Punkt 5 sagt, `sql.begin` tauge nicht, weil ein zweites `begin` "ignoriert" werde und die Isolationsstufe ohne Fehlermeldung verloren gehe. Die Messung präzisiert das: Die Optionen des inneren `begin` werden angewendet, solange vorher keine Abfrage lief, und scheitern mit Fehler, wenn eine lief. Die Schlussfolgerung bleibt richtig (kein Adapter über `sql.begin`), die Begründung ist die Reihenfolgeabhängigkeit, die doppelten Hinweise und das fremde `commit`. Die Notiz "Stand U1" am Ende des Konzepts trägt das nach.

## 6. Empfehlung für den Adapter (kleine Schnittstelle für U7)

`src/lib/content-upload/connection.ts`, ohne Änderung der Engine:

```ts
interface ReservedConnection extends Queryable {   // Queryable: query(text, values) wie pg-db.ts
  release(failed?: boolean): Promise<void>;
}
interface ConnectionSource { reserve(): Promise<ReservedConnection> }

withReservedConnection(source, work, { reserveTimeoutMs, onReleaseError })
fromPostgresJs(sql)   // sql.reserve() + unsafe(text, values), das Standard der App
fromPgPool(pool)      // pool.connect(), nach einem Fehler release(true)
```

Verwendung in U7:

```ts
await withReservedConnection(fromPostgresJs(client), async db => {
  const facts = await readTargetFacts(db);      // dieselbe Verbindung, VOR runJob
  checkTargetFacts('preview', facts);           // apply/target.ts
  return runJob(db, plan, { mode, createdBy, updateExisting, activate: false, scenarioSolutions: false });
}, { reserveTimeoutMs: 10_000 });
```

`client` ist der postgres-js-Client der App (`src/db/index.ts` legt ihn in `globalThis.__pgClient__`, für U7 ist ein eigener Export nötig, das ist Teil von U7). Regeln, die der Adapter einhält und die U7 nicht umgeht:

1. **Eine Reservierung je Lauf**, in jedem Fall freigegeben (Erfolg, Fehler, Zeitlimit). Nach einem Fehler wird die Verbindung verworfen, wo der Pool das kann.
2. **Nach der Freigabe wird jede Anfrage abgelehnt** (`CONNECTION_RELEASED`): Eine freigegebene Verbindung gehört einem anderen, hinter dem Pooler vielleicht einem anderen Backend.
3. **Wartezeit auf eine freie Verbindung ist begrenzt** (`CONNECTION_RESERVE_TIMEOUT`), eine Verbindung, die erst nach dem Aufgeben eintrifft, geht sofort zurück. Ohne Grenze würde die Route hängen, wenn der Pool voll ist.
4. **Nur `unsafe()` mit Parametern**, `prepare: false` bleibt in `src/db/index.ts`. Kein `set` ohne `local`, kein `pg_advisory_lock`, kein `listen`, keine temporären Tabellen.
5. **Die Fakten der Verbindung (`checkTargetFacts`) werden über dieselbe reservierte Verbindung gelesen**, nicht über Drizzle. Außerhalb einer Transaktion kann der Pooler zwischen Backends wechseln (Probe p4), die Fakten gelten also für denselben Pooler-Nutzer, dieselbe Rolle und dasselbe Schema (`current_user`, `current_schema()`, beides aus der Rolle), nicht zwingend für dasselbe Backend. Wer ganz sicher gehen will, liest sie nach dem `begin` innerhalb der Transaktion.
6. **Nach einem Fehler geht die Verbindung nicht offen zurück:** `pg` verwirft sie (`release(true)`), bei postgres-js sendet der Adapter vor der Freigabe ein letztes `rollback`, weil `release()` die Sitzung nicht zurücksetzt.
7. **Lock-Timeouts bleiben, wie sie sind** (`lock_timeout` 5 s, `statement_timeout` 60 s, `set local`). Ein Lauf belegt einen Platz im Pooler für seine Dauer.

Die Planbau-Zeit ist der eigentliche Zeitposten und in diesem Spike nicht gemessen: Für den Probelauf und die Übernahme baut U7 aus den Entscheidungen den Plan, dazu liest der Server die Dateien erneut aus dem Staging (Parser brauchen den vollen Inhalt, Konzept 8.1 Punkt 2) und parst sie (bis 1153 Wortdateien, 780 MB Quelle). Das gehört **vor** die reservierte Verbindung (kein Platz im Pooler während des Parsens) und in die Warteschlange (Schritt "Plan bauen" mit Zwischenspeicher in `content_upload_applies`, ohne Dateiinhalte), nicht in die Route der Übernahme.

## 7. Empfehlung für den Rückfall

| Stufe | Wann | Wie |
| ----- | ---- | --- |
| 1 Standard | Messung in U7 gegen die echte Preview bleibt unter dem Zeitlimit der Route (`maxDuration` ausdrücklich setzen) | Übernahme als Route mit dem Adapter, Plan aus dem Zwischenspeicher |
| 2 | Der Plan ist da, aber Probelauf plus Protokoll brauchen mehr als das Zeitlimit | Übernahme als Schritt der Warteschlange: die Route legt einen Auftrag an (`content_upload_applies`, Status `running`), eine Pumpe führt `runJob` in einem eigenen Aufruf aus, der Browser fragt den Stand ab. Ein hängender Lauf wird nach 15 Minuten freigegeben (Konzept 2.4) |
| 3 | Pooler oder Zeitlimit tragen den Lauf nicht | Das Skript `scripts/import/kfbm-apply.mjs` auf dem Rechner des Eigentümers (direkte Verbindung `pg.Client`, Port 5432, unverändert) |

Das Skript bleibt in jedem Fall bestehen (Konzept K5). Stufe 2 braucht keinen neuen Adapter, nur die Pumpe aus U2.

## 8. Grenzen und ungetestete Pfade

- **Gehostete Preview und Supavisor nicht getestet** (Vorgabe: keine Verbindung). PgBouncer 1.26.1 ist ein Stellvertreter. **Annahme:** Supavisor im Transaktionsmodus verhält sich bei Pinning, `set local`, Transaktions-Locks und Prepared Statements wie hier gemessen. PgBouncer unterstützt seit 1.21 Prepared Statements (Voreinstellung), Supavisor im Transaktionsmodus nach der Dokumentation von Supabase nicht (aus dem Gedächtnis, nicht in dieser Sitzung nachgelesen). Deshalb wurde der ungünstige Fall (`max_prepared_statements = 0`) gemessen.
- **Poolgröße der Preview unbekannt.** Der Spike nutzt 5 Plätze. Ein Lauf der Übernahme belegt einen Platz, solange er läuft (Sekunden, bei der Warteschlange kürzer). Läuft in dieser Zeit anderer Verkehr der Preview, ist die Zahl der Plätze zu prüfen (Probe p6).
- **Zeitlimit der Funktionen** (`maxDuration`, Vercel-Plan) ist im Repository nicht gesetzt und nicht bekannt.
- **Kein TLS** in diesem Aufbau (Loopback). Die Skripte verlangen TLS für gehostete Ziele (`openVerifiedClient`), das gilt für die App über die Verbindungszeichenfolge der Preview.
- **Use-Case-Engine, Protokollschreiben und Planbau** nicht gemessen (Abschnitt 4.4 und 6).
- **Datenvolumen:** Der Plan hat 222 Enabler (Konzept: 226 laut Quellbericht), 6994 Fragen (Konzept: rund 7300).
- **Rollen:** Die Messungen in 4.3 liefen als `postgres` im Schema `public`. Zusätzlich lief die Engine in einem lokalen Container als Rolle `app_preview` im Schema `public_preview` (Struktur durch den echten `preview-migrate rebuild`, Rolle mit `BYPASSRLS`, ohne Recht auf `public`): Probelauf über den Pooler 1,71 bis 1,73 s mit 91 Anweisungen, `check` direkt 0,82 s, gleiche Zahlen wie in `public`. Die Rolle kann auf die sieben neuen Tabellen schreiben (Einfügen und Lesen in einer Transaktion mit `rollback`), `anon` und `authenticated` haben dort kein Recht. Der Unterschied der Preview zu diesem Aufbau liegt in Supavisor, TLS und der Entfernung, nicht in den Rechten.
