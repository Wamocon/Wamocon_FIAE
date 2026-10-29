WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn

# Bestätigung der E-Mail-Adresse bei der Selbstregistrierung

Stand: Oktober 2026. Gilt für das Repository Wamocon_FIAE (Next.js, Supabase Auth, Vercel) und das gemeinsame Supabase-Projekt von Production und Preview.

## 1. Kurzfassung

Heute ist in Supabase Auth `mailer_autoconfirm` an. Jede Selbstregistrierung ist damit sofort bestätigt. Künftig soll die Einstellung "Confirm email" an sein: Wer sich selbst registriert, bekommt eine E-Mail mit einem Link und kann sich erst anmelden, wenn der Link geklickt wurde. Danach gilt wie bisher: Selbstregistrierte Azubis warten auf die Freischaltung durch den Ausbilder.

Die App behandelt beide Zustände richtig. Die Umschaltung im Dashboard hat für Nutzer deshalb erst dann eine Wirkung, wenn sie gewollt ist, und sie lässt sich jederzeit zurücknehmen.

Wichtig: Bis zu diesem Release hat die Registrierung das Konto serverseitig mit `auth.admin.createUser` und `email_confirm: true` angelegt. Die Dashboard-Einstellung hätte darauf keinen Einfluss gehabt. Mit diesem Release ist die Registrierung ein normaler `signUp` mit dem öffentlichen Schlüssel, erst damit greift "Confirm email".

Konten, die ein Admin anlegt (`POST /api/admin/users`), bleiben unberührt: Sie werden mit `email_confirm: true` angelegt, sind sofort bestätigt und sofort freigeschaltet (`trainer_activated` ist wahr). Die Einstellung "Confirm email" gilt für `auth.admin` nicht.

## 2. Ablauf

| Schritt | Mit Bestätigung (Confirm email an)                                                                                                         | Ohne Bestätigung (mailer_autoconfirm an, wie heute)                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1       | Person füllt `/register` aus (E-Mail, Passwort mit mindestens 8 Zeichen).                                                                  | wie links                                                                    |
| 2       | `POST /api/register` prüft Eingaben, Ratenbegrenzung (5 je Stunde und Adresse) und ob ein Profil mit dieser Adresse existiert (sonst 409). | wie links                                                                    |
| 3       | Die Route ruft `auth.signUp` auf. Antwort: Benutzer ohne Sitzung. Supabase verschickt die Bestätigungs-E-Mail.                             | `auth.signUp` antwortet mit Benutzer und Sitzung. Es wird keine Mail gesendet. |
| 4       | Die Route legt das Profil an: Rolle TRAINEE, `trainer_activated` falsch, Ausbilder zugewiesen. Die Ausbilder bekommen eine Benachrichtigung mit dem Zusatz, dass die Adresse noch nicht bestätigt ist. | Gleiches Profil, gleiche Benachrichtigung ohne Zusatz.                       |
| 5       | Antwort `confirmationRequired: true`. Die Seite zeigt "Bitte bestätigen Sie Ihre E-Mail-Adresse", nennt die Adresse und bietet "Bestätigungs-E-Mail erneut senden" an. Keine automatische Weiterleitung. | Antwort `confirmationRequired: false`. Die bekannte Meldung zur Freischaltung, nach 5 Sekunden Weiterleitung zur Anmeldung. |
| 6       | Die Person klickt den Link. Er führt zu `GET /auth/callback?token_hash=...&type=email`. Die Route tauscht den Token (`verifyOtp`) und leitet auf `/login?confirm=done`. | entfällt                                                                     |
| 7       | Die Anmeldeseite zeigt "Ihre E-Mail-Adresse ist bestätigt". Die Person meldet sich an.                                                     | Die Person meldet sich an.                                                   |
| 8       | Das Gate `AWAITING_ACTIVATION` hält das Konto, bis ein Ausbilder oder Admin freischaltet.                                                  | wie links                                                                    |

Meldet sich jemand an, bevor die Adresse bestätigt ist, scheitert die Anmeldung mit "Ihre E-Mail-Adresse ist noch nicht bestätigt". Darunter steht der Knopf zum erneuten Senden.

### Was die Callback-Route sicher macht

- Sie nimmt nur den Token-Hash der Bestätigung einer Registrierung an (`type=email` oder `type=signup`). Andere Typen (Passwort zurücksetzen, Einladung, Magic Link) werden nicht getauscht.
- Das Weiterleitungsziel kommt aus einer Positivliste eigener Pfade (heute nur `/login`, genauer Vergleich). Absolute Adressen, `//host`, Backslashes, kodierte Tricks und alles andere fallen auf `/login` zurück. Es gibt kein offenes Weiterleiten.
- Die Weiterleitung bleibt auf der eigenen Adresse. Die Basis kommt aus `NEXT_PUBLIC_APP_URL`, nicht aus Host-Headern der Anfrage.
- Es wird keine Sitzung behalten. Die Person meldet sich mit Passwort an.
- Höchstens 20 Versuche je Clientadresse in zehn Minuten, die Antwort ist nie zwischenspeicherbar (`Cache-Control: no-store`).
- Ohne Token (zum Beispiel wenn Supabase die Adresse selbst bestätigt und nur hierher weitergeleitet hat) zeigt die Anmeldeseite einen neutralen Hinweis und behauptet nichts.

### Erneut senden

`POST /api/auth/resend-confirmation` löst bei Supabase `auth.resend` (Typ `signup`) aus. Die Route antwortet für jede wohlgeformte Adresse gleich, egal ob ein Konto besteht, damit niemand herausfinden kann, wer registriert ist. Auch das Versandlimit von Supabase wird nicht angezeigt. Grenzen: 10 Anfragen je Clientadresse und Stunde, 5 je E-Mail-Adresse und Stunde, 1 je Adresse und Minute. Die Seite sperrt den Knopf 60 Sekunden lang. In Preview ist die Route abgeschaltet.

## 3. Einstellungen im Supabase-Dashboard

Alle Einstellungen gelten für das gemeinsame Projekt, also für Production und Preview. Preview sperrt die Selbstregistrierung selbst (`blockInPreview`), die E-Mails kommen immer mit der Site URL von Production.

| Bereich im Dashboard                             | Einstellung                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication, Sign In / Providers, Email       | **Confirm email: an.** "Allow new users to sign up" muss an bleiben, sonst scheitert die Registrierung mit einer Meldung (Code `signup_disabled`).               |
| Authentication, Sign In / Providers, Email       | Optional: Dauer des Links (Email OTP Expiration). Vorschlag: 86400 Sekunden (24 Stunden), weil Azubis nicht sofort ins Postfach schauen. Der Knopf zum erneuten Senden fängt abgelaufene Links auf. |
| Authentication, URL Configuration                | **Site URL:** `https://fiae-learn.com`                                                                                                                         |
| Authentication, URL Configuration                | **Redirect URLs:** `https://fiae-learn.com/**` und `https://preview.fiae-learn.com/**`. Das Passwort-Zurücksetzen nutzt `/reset-password` auf der jeweiligen Domain.   |
| Project Settings, Authentication, SMTP Settings  | **Custom SMTP an** mit dem Zugang von Resend (Abschnitt 4).                                                                                                    |
| Authentication, Emails, Templates                | Drei Vorlagen mit deutschen Texten (Abschnitt 5): Confirm signup, Reset password, Invite user.                                                                 |
| Authentication, Rate Limits                      | Versand je Stunde prüfen und bei Bedarf anheben (Abschnitt 6).                                                                                                 |

In Vercel (Production) muss `NEXT_PUBLIC_APP_URL=https://fiae-learn.com` gesetzt sein. Die App baut daraus den Link `https://fiae-learn.com/auth/callback`, der als `emailRedirectTo` an Supabase geht. Fehlt die Variable oder ist sie keine gültige Adresse, nimmt ein Production-Build die Adresse `https://fiae-learn.com`. Host-Header der Anfrage werden nur in Entwicklung und Tests gelesen.

## 4. Was Niko liefern muss

1. **Domain bei Resend verifizieren.** In Resend die Domain `fiae-learn.com` anlegen und die angezeigten DNS-Einträge beim DNS-Anbieter setzen: SPF (TXT), DKIM (TXT, meist drei CNAME oder ein TXT je nach Anzeige) und den Eintrag für Bounces. Empfohlen zusätzlich DMARC (TXT `_dmarc`, zunächst `p=none`). Die genauen Werte zeigt Resend an, sie sind nicht Teil des Repositories. Erst wenn Resend "Verified" zeigt, ist ein Versand von dieser Domain möglich.
2. **Absenderadresse festlegen.** Vorschlag: `noreply@fiae-learn.com` mit dem Absendernamen "LFA-Lernplattform". Dieselbe Adresse gehört in die Vercel-Variable `EMAIL_FROM_ADDRESS`, die heute noch auf der Testadresse `onboarding@resend.dev` steht. Die Zugangsdaten-Mails der App (Admin legt Konto an) laufen über denselben Absender.
3. **Resend-Schlüssel als SMTP-Passwort.** Einen eigenen API-Schlüssel nur für den Versand von der Domain `fiae-learn.com` anlegen (Berechtigung "Sending access", auf die Domain beschränkt). Der Schlüssel wird direkt im Supabase-Dashboard als SMTP-Passwort eingetragen, nie in Chat, Repository oder Ticket.
4. **SMTP-Werte für Supabase** (nach der Dokumentation von Resend, vor dem Eintragen noch einmal gegen die aktuelle Seite prüfen):

   | Feld        | Wert                              |
   | ----------- | --------------------------------- |
   | Host        | `smtp.resend.com`                 |
   | Port        | 465 (SSL) oder 587 (STARTTLS)     |
   | Benutzer    | `resend`                          |
   | Passwort    | der Resend-Schlüssel              |
   | Absender    | `noreply@fiae-learn.com`          |
   | Absendername | `LFA-Lernplattform`              |

5. **Zugang** zum Supabase-Dashboard (Auth-Einstellungen) und zum DNS-Anbieter, oder ein Termin, an dem Niko die Schritte selbst ausführt.
6. **Entscheidungen:** Linkdauer (Vorschlag 24 Stunden), Tarif bei Resend (die Versandgrenzen des Tarifs müssen zur Zahl der Registrierungen passen).
7. **Vor der Umschaltung prüfen** (nur lesend, im SQL-Editor von Supabase, nicht durch Agenten): `select count(*) from auth.users where email_confirmed_at is null;` Der Wert sollte 0 sein. Konten ohne Bestätigung könnten sich nach der Umschaltung nicht mehr anmelden.

## 5. Entwurf der E-Mail-Vorlagen

Die Vorlagen werden im Dashboard unter Authentication, Emails, Templates eingetragen. Betreff und Inhalt sind Entwürfe in Sie-Form. Die Platzhalter `{{ .SiteURL }}`, `{{ .TokenHash }}`, `{{ .ConfirmationURL }}` und `{{ .Email }}` ersetzt Supabase.

### 5.1 Confirm signup (Bestätigung der Registrierung)

Wichtig: Diese Vorlage nutzt den Token-Hash und führt direkt zur Callback-Route der App. Die Standardvorlage mit `{{ .ConfirmationURL }}` würde über die Adresse von Supabase laufen und die Bestätigung mit Tokens im URL-Fragment übergeben, die ein Server nicht lesen kann. Die Person wäre dann zwar bestätigt, sähe aber nur den neutralen Hinweis.

Betreff: `Bitte bestätigen Sie Ihre E-Mail-Adresse`

```html
<h2>Willkommen auf der LFA-Lernplattform</h2>
<p>Guten Tag,</p>
<p>vielen Dank für Ihre Registrierung. Bitte bestätigen Sie Ihre E-Mail-Adresse mit einem Klick auf diesen Link:</p>
<p>
  <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">E-Mail-Adresse bestätigen</a>
</p>
<p>Danach prüft Ihr Ausbilder Ihre Registrierung und schaltet Ihr Konto frei. Sie können sich nach der Bestätigung anmelden, die Lernplattform steht Ihnen nach der Freischaltung zur Verfügung.</p>
<p>Der Link ist begrenzt gültig und kann nur einmal verwendet werden. Ist er abgelaufen, können Sie auf der Anmeldeseite einen neuen anfordern.</p>
<p>Wenn Sie sich nicht registriert haben, können Sie diese E-Mail ignorieren. Es wird dann nichts freigeschaltet.</p>
<p>Mit freundlichen Grüßen<br />WAMOCON GmbH</p>
```

### 5.2 Reset password (Passwort zurücksetzen)

Der Ablauf bleibt der bisherige: Die Seite `/forgot-password` fordert die Mail an, der Link führt über Supabase zu `/reset-password`. Deshalb bleibt `{{ .ConfirmationURL }}` in der Vorlage. Nur der Text wird deutsch.

Betreff: `Passwort für die LFA-Lernplattform zurücksetzen`

```html
<h2>Passwort zurücksetzen</h2>
<p>Guten Tag,</p>
<p>für Ihr Konto ({{ .Email }}) wurde ein neues Passwort angefordert. Mit diesem Link können Sie es festlegen:</p>
<p><a href="{{ .ConfirmationURL }}">Neues Passwort festlegen</a></p>
<p>Das neue Passwort muss mindestens 8 Zeichen lang sein. Der Link ist begrenzt gültig und kann nur einmal verwendet werden.</p>
<p>Wenn Sie kein neues Passwort angefordert haben, können Sie diese E-Mail ignorieren. Ihr Passwort bleibt dann unverändert.</p>
<p>Mit freundlichen Grüßen<br />WAMOCON GmbH</p>
```

### 5.3 Invite user (Einladung)

Die App lädt heute nicht per `inviteUserByEmail` ein. Admins legen Konten direkt an, die Zugangsdaten verschickt die App selbst (`sendCredentialsEmail` über Resend). Die Vorlage wird trotzdem deutsch gesetzt, damit eine spätere Einladung aus dem Dashboard keine englische Standardmail verschickt.

Betreff: `Einladung zur LFA-Lernplattform`

```html
<h2>Einladung zur LFA-Lernplattform</h2>
<p>Guten Tag,</p>
<p>Sie wurden zur LFA-Lernplattform eingeladen. Mit diesem Link nehmen Sie die Einladung an und legen Ihr Passwort fest:</p>
<p><a href="{{ .ConfirmationURL }}">Einladung annehmen</a></p>
<p>Das Passwort muss mindestens 8 Zeichen lang sein. Der Link ist begrenzt gültig und kann nur einmal verwendet werden.</p>
<p>Wenn Sie diese Einladung nicht erwartet haben, können Sie die E-Mail ignorieren.</p>
<p>Mit freundlichen Grüßen<br />WAMOCON GmbH</p>
```

Die weiteren Vorlagen (Magic Link, Change email, Reauthentication) nutzt die App nicht. Sie können im Standard bleiben.

## 6. Rate-Limits

| Ebene                                  | Grenze                                                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase, eingebauter Versand          | Nur sehr wenige Mails je Stunde (Größenordnung zwei) und nur an Adressen des eigenen Teams. Für den Echtbetrieb ungeeignet. Ohne eigenes SMTP wäre "Confirm email" für Azubis praktisch unbrauchbar. |
| Supabase, mit eigenem SMTP             | Zunächst eine niedrige Standardgrenze (Größenordnung 30 Mails je Stunde), im Dashboard unter Authentication, Rate Limits einstellbar. Eine Klasse mit vielen gleichzeitigen Registrierungen braucht einen höheren Wert. |
| Supabase, je Benutzer                  | Eine Bestätigungs-E-Mail je Adresse und 60 Sekunden. Der Knopf der App wartet entsprechend.                                                                                   |
| Supabase, Anmeldungen und Registrierungen je Adresse des Aufrufers | Die Registrierung ruft `signUp` vom Server aus auf, alle Registrierungen kommen also von der Ausgangsadresse des Servers. Eine hohe Grenze je Server und Zeitraum ist nötig, wenn viele Personen gleichzeitig starten. |
| Resend                                 | Je nach Tarif Tages- und Monatsgrenzen. Vor der Umschaltung den Tarif prüfen.                                                                                                |
| App                                    | `/api/register`: 5 je Stunde und Clientadresse. `/api/auth/resend-confirmation`: 10 je Stunde und Clientadresse, 5 je Stunde und E-Mail-Adresse, 1 je Minute und Adresse. `/auth/callback`: 20 je zehn Minuten und Clientadresse. Die Zähler liegen im Speicher einer Serverinstanz, auf Vercel gilt die Grenze also je warmer Instanz. Das bremst automatisierten Missbrauch, ist aber keine harte globale Grenze. |

Hinweis: Die Zahlen von Supabase und Resend ändern sich. Sie sind vor der Produktivschaltung im Dashboard und in den aktuellen Dokumentationen nachzusehen, die Größenordnungen oben sind der Stand der Recherche.

## 7. Reihenfolge bei der Produktivschaltung

1. **App-Release.** Dieses Release zuerst veröffentlichen, solange im Dashboard `mailer_autoconfirm` noch an ist. Das ist ohne Wirkung für Nutzer: Die Registrierung läuft jetzt über `signUp`, die Antwort trägt eine Sitzung, die Seite verhält sich wie bisher. Prüfen, dass "Allow new users to sign up" an ist und eine Testregistrierung ein Profil anlegt.
2. **Niko liefert** Domain-Verifizierung, Absender und Resend-Schlüssel (Abschnitt 4). Erst weitermachen, wenn Resend die Domain als verifiziert zeigt.
3. **Dashboard einstellen** in dieser Reihenfolge: Site URL und Redirect URLs, SMTP, Vorlagen, Rate Limits, zuletzt "Confirm email" an. `EMAIL_FROM_ADDRESS` in Vercel auf die neue Absenderadresse stellen und neu deployen.
4. **Test mit einem Wegwerfkonto** (echtes Postfach, das nicht zu einem Kunden gehört):
   - Registrieren. Erwartet: Seite "Bitte bestätigen Sie Ihre E-Mail-Adresse", Mail kommt an, Absender und deutscher Text stimmen, kein Spam-Ordner.
   - Vor der Bestätigung anmelden. Erwartet: "Ihre E-Mail-Adresse ist noch nicht bestätigt" mit Knopf. Knopf drücken, zweite Mail kommt (frühestens nach einer Minute).
   - Den Link der neuesten Mail klicken. Erwartet: Anmeldeseite mit "Ihre E-Mail-Adresse ist bestätigt".
   - Anmelden. Erwartet: Hinweis, dass das Konto auf die Freischaltung wartet. Ein Ausbilder sieht die Benachrichtigung und schaltet frei, danach öffnet sich das Dashboard.
   - Denselben Link ein zweites Mal klicken. Erwartet: Anmeldeseite mit dem Hinweis auf einen abgelaufenen oder benutzten Link.
   - "Passwort vergessen" mit dem Wegwerfkonto. Erwartet: deutsche Mail, Link führt zu `/reset-password`, ein Passwort mit weniger als 8 Zeichen wird abgelehnt.
   - Wegwerfkonto danach in der Benutzerverwaltung löschen.
5. **Beobachten** in den ersten Tagen: Fehlerrate bei `/api/register` (Statuscode 429 und 503 in den Vercel-Protokollen) und Nachrichten von Azubis, die keine Mail bekommen.

## 8. Rückweg

- **Einstellung zurück:** "Confirm email" im Dashboard wieder aus. Neue Registrierungen sind sofort bestätigt, die App verhält sich wie heute. Konten, die in der Zwischenzeit registriert und nicht bestätigt wurden, bleiben unbestätigt. Sie bestätigen über den Link, über "Passwort vergessen" (der Link bestätigt die Adresse mit) oder Niko setzt sie im SQL-Editor: `update auth.users set email_confirmed_at = now() where email = '...' and email_confirmed_at is null;`
- **App zurück:** Das Release zurücknehmen. Der alte Code legt Selbstregistrierungen wieder mit `email_confirm: true` an, unabhängig von der Dashboard-Einstellung. Das ist der schnellste Weg, wenn Registrierungen nach der Umschaltung scheitern.
- **SMTP zurück:** Custom SMTP lässt sich im Dashboard ausschalten. Dann gilt wieder der eingebaute Versand mit seiner sehr niedrigen Grenze. Das ist nur sinnvoll, wenn "Confirm email" ebenfalls aus ist.

## 9. Grenzen und offene Punkte

- **Link-Scanner.** Manche Mailsysteme rufen Links vorab auf. Dann ist der einmalige Token verbraucht, bevor die Person klickt. Folge: "Link abgelaufen oder benutzt", der Knopf zum erneuten Senden hilft. Eine Zwischenseite mit Bestätigungsknopf wäre die Abhilfe, sie ist bewusst nicht Teil dieser Änderung.
- **Unbestätigte Konten belegen die Adresse.** Das Profil entsteht bei der Registrierung. Wer nie bestätigt, kann sich mit dieser Adresse nicht erneut registrieren (409). Lösung: erneut senden oder "Passwort vergessen".
- **Benachrichtigung der Ausbilder.** Sie kommt bei der Registrierung, nicht erst nach der Bestätigung. Ein Ausbilder kann also ein Konto freischalten, dessen Adresse noch nicht bestätigt ist. Die Person kann sich trotzdem erst nach der Bestätigung anmelden. Die Benachrichtigung nennt den Stand ausdrücklich.
- **Zähler der App** liegen im Speicher einer Serverinstanz (siehe Abschnitt 6). Läuft der Überlauf des Speichers voll, werden die ältesten Einträge verworfen, nicht alle.
- **Sperre durch Dritte.** Wer die Adresse eines anderen kennt, kann dessen Knopf "erneut senden" mit wenigen Anfragen für bis zu eine Stunde sperren. Die Zähler der Route zählen unabhängig davon, ob ein Konto besteht, damit sie nichts verraten. Der Link der ersten Mail bleibt gültig.
- **Hinweis auf registrierte Adressen.** Die Registrierung antwortet bei einer bekannten Adresse mit 409 "bereits registriert". Das war schon vorher so und ist eine bewusste Abwägung zugunsten verständlicher Meldungen. Die Bremse ist die Grenze von 5 Registrierungen je Stunde und Clientadresse.
- **Die Meldung von Supabase zum Versandlimit** (nur bei einem vorhandenen, unbestätigten Konto innerhalb einer Minute) zeigt die Route nicht an, sie steht nur im Protokoll. Sonst würde der Statuscode verraten, wer registriert ist.
- **`X-Forwarded-For`.** Die Grenzen je Clientadresse lesen den ersten Eintrag des Headers. Auf Vercel überschreibt die Plattform ihn, das ist sicher. Hinter einem eigenen Proxy, der Einträge nur anhängt, wäre der erste Eintrag fälschbar.
- **Lokale Supabase-Konfiguration.** `supabase/config.toml` hat noch `minimum_password_length = 6` und `enable_confirmations = false`. Das betrifft nur den lokalen Stack und wurde bewusst nicht geändert. Die gehosteten Einstellungen (Passwort mindestens 8, Confirm email) setzt Niko im Dashboard.
- **Trigger `handle_new_user`.** Die Migration `0004_fix_handle_new_user.sql` liest die Rolle aus `raw_user_meta_data`. Ob dieser Trigger in der gehosteten Datenbank noch besteht und die Rolle auswertet, wurde nicht geprüft (keine Verbindung). Wenn ja, könnte ein direkter Aufruf der Auth-Schnittstelle mit dem öffentlichen Schlüssel eine Rolle setzen. Das ist unabhängig von dieser Änderung und sollte getrennt geprüft werden.
- **Nicht geprüft:** Diese Änderung wurde ohne Verbindung zu Supabase und ohne Versand einer echten Mail entwickelt. Der Ablauf mit echtem Postfach ist erst beim Test in Abschnitt 7 belegt.
