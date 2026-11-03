# HAI Sprachmodus mit Hai-Figur

Stand: 03.11.2026. Der Sprachmodus ist ein Gesprächsmodus über dem Sprachassistenten (`docs/hai-sprachassistent.md`). Die HAI erscheint dabei als **Figur**: ein freundlicher Cartoon-Hai mit Kopf, Armen, Händen, Körper und Beinen, der unten links auf der Seite aus einem runden Wasserbecken aufsteigt, mit dem Azubi spricht (der Mund bewegt sich mit der Sprache) und mit den Beinen im Wasser stehen bleibt, solange der Sprachmodus läuft. Die Seite dahinter bleibt benutzbar: kein Vollbild, kein Abdunkeln, keine Fokusfalle. Was gesagt wird, steht im Chat im Hintergrund.

Bis PR 263 war der Sprachmodus ein Vollbild mit dem Logo-Bild in einem runden Rahmen. Das ist ersetzt. Der kleine Zustand "Hai rückt an den Rand" entfällt, weil die Figur ohnehin unten links steht.

Der Sprachmodus ändert nichts an dem, was die HAI darf oder weiß. Berufstrennung, Lösungsschutz, Berechtigungen und die Regeln für gesprochene Antworten (`buildVoiceRules`, höchstens vier Sätze) gelten unverändert. Er ist eine Oberfläche auf demselben Sprachassistenten, ohne neue Route und ohne neuen Server-Pfad.

## 1. Bedienung

- **Einstieg:** Im Chat gibt es den Knopf "Gespräch" (Sprechwellen-Symbol), in der Kopfzeile des Chats (Seitenansicht und Vollbild) und neben dem Mikrofon. Er erscheint nur, wenn die Organisation den Sprachassistenten eingeschaltet hat und der Browser mindestens einen Anbieter der Kette nutzen kann. Der Knopf ist ein echter Knopf: Tab erreicht ihn, Enter und Leertaste öffnen den Sprachmodus.
- **Die Figur:** Sie steigt unten links (`fixed bottom-4 left-4`, plus Sicherheitsabstand für Notch und Home-Leiste) aus dem Wasserbecken auf, mit Spritzern. Sie liegt auf Ebene z-40, also unter Dialogen und Viewern (wie der HAI-Knopf) und über dem Seiteninhalt. Auf dem Desktop ist sie etwa 280 Pixel hoch, auf dem Handy etwa 160 Pixel. Nur die Figur und ihre Bedienelemente nehmen Klicks an, alles andere geht an die Seite durch.
- **Bedienelemente** (eine kleine Leiste rechts neben dem Becken, alle mit `aria-label`, per Tab erreichbar):
  - Mikrofon ausschalten oder einschalten. Aus: Die Gesprächsschleife hält an, es wird nichts aufgenommen und nichts gesagt, die Figur bleibt stehen und zeigt "Mikrofon ist aus". An: Die Schleife startet wie beim Öffnen.
  - Unterbrechen und zuhören (nur, solange die HAI spricht oder nachdenkt) beziehungsweise "Erneut zuhören" (nach einer Pause oder einem Fehler).
  - Untertitel an oder aus (Schalter, `role="switch"`).
  - Hinweise zum Sprachmodus (klappt eine kleine Karte auf: wie man beendet, wohin der Ton gerade geht).
  - Sprachmodus beenden.
- **Beenden:** Esc (außer eine andere Stelle der Seite hat Esc schon benutzt), der Knopf mit dem Kreuz oder der Sprachbefehl "Sprachmodus beenden" (auch "Stopp", "Tschüss", "Das war es", die Liste steht in `isStopCommand`). Das Beenden schaltet das Mikrofon aus und bricht das Vorlesen ab. Die Figur taucht danach wieder ins Wasser ein (etwa 0,8 Sekunden), dabei sind Bedienelemente und Zustandstext schon weg. Der Fokus geht an den Knopf zurück, der den Sprachmodus geöffnet hat.
- **Die Figur antippen:** Während die HAI spricht oder nachdenkt, unterbricht der Klick auf die Figur, und die HAI hört zu. Nach einer Pause oder einem Fehler startet er das Zuhören neu. Per Tastatur gibt es dafür den Knopf in der Leiste.
- **Untertitel:** Eine Sprechblase neben dem Kopf (mit Zipfel zum Kopf, dunkle Schrift auf weißem Grund, in beiden Themes lesbar). Oben steht die Frage des Azubi (erst als Zwischenergebnis, dann so, wie sie an die HAI ging), darunter die Antwort Satz für Satz, so wie sie vorgelesen wird, der letzte Satz fett, die früheren gedimmt. Die Wahl bleibt im Browser (`hai-voice-mode-captions`). Ohne Untertitel (oder solange nichts zu zeigen ist) gibt es keine Blase.
- **Tagesbegleiter:** Beim ersten Gespräch des Tages stellt die HAI die Eröffnungsfrage selbst ("Guten Morgen, was steht heute an?", nach Tageszeit, Berliner Zeit). Das ist die erste gesprochene Äußerung der Figur, sie erscheint als Untertitel. Abschaltbar in den Einstellungen des Mikrofons wie bisher.
- **Chatpanel und Figur:** Das Panel liegt rechts, die Figur links, auf dem Desktop kommen sie sich nicht in die Quere. Das große Chat-Fenster (Vollbild des Chats) geht beim Öffnen des Sprachmodus auf die Seitenansicht zurück, auf dem Handy (bis 767 Pixel), wo das Panel die ganze Breite deckt, wird das Panel weggeräumt.
- **Seite öffnen:** siehe Abschnitt 5.

## 2. Zustände der Figur

Die Figur zeigt den Zustand der Gesprächsschleife (`useHaiVoice`). Der Zustand steht immer auch als Text (kleine Zeile mit `role="status"`, `aria-live="polite"`), nie nur als Bewegung. Die Figur selbst ist Dekoration (`aria-hidden`). Jeder Zustand setzt Datenattribute an der Wurzel der Figur, das CSS und die Tests lesen dieselben Namen.

| Zustand | Wann | Haltung (`data-arms`, `data-head`, `data-eyes`) | Becken (`data-pool`) | Text |
|---|---|---|---|---|
| wartet | Phase `idle`, vor dem ersten Zuhören oder bei fehlender Einwilligung | Arme locker (`loose`), Kopf gerade, ruhiges Wippen um die Füße, Augen blinzeln | ruhig, Wellen laufen | HAI wartet |
| hört zu | Phase `listening` | Kopf geneigt (`tilt`), eine Hand am Ohr (`ear`), Augen weit (`wide`) | ruhige Ringe, schneller, solange Text des Azubi eintrifft, stärker mit dem Pegel der Aufnahme (`--hai-level`), wenn der Anbieter einen meldet | HAI hört zu |
| denkt | Phase `thinking` | Hand am Kinn (`chin`), Kopf zur Hand (`think`), Blick nach oben (`up`), Gedankenblase aus drei Punkten | ruhig | HAI denkt nach |
| spricht | Phase `speaking` | Mund bewegt sich (Abschnitt 4), Arme gestikulieren abwechselnd (`gesture`), Kopf nickt, Körper hüpft leicht | schnelle Ringe | HAI spricht |
| Pause | Phase `error` mit `no-speech` (drei stille Runden) oder Mikrofon ausgeschaltet | Arme leicht geöffnet (`shrug`), Kopf geneigt (`lean`), Lider halb zu (`droop`) | Warnfarbe (Amber) | HAI macht Pause, dazu "Tippen Sie auf die HAI, um weiterzusprechen" beziehungsweise "Mikrofon ist aus" |
| Fehler | Phase `error` sonst (Mikrofon verweigert, Erkennung fehlgeschlagen, nicht unterstützt) | Hände vor dem Bauch (`worry`), Brauen besorgt (`worried`) | Warnfarbe (Amber) | Das Gespräch ist angehalten, dazu die Fehlermeldung |

Auftauchen und Eintauchen: Das Attribut `data-phase` ist `rising` (steigt auf, etwa 1,4 Sekunden, mit Spritzern und Ringen), danach `standing` (steht, die Zustandsbewegungen laufen) und beim Beenden `diving` (taucht ein). Die Beine bleiben im Becken, der Körper schwingt nur um die Füße.

Gezeichnet ist alles als eine SVG-Grafik (`src/components/hai/voice-mode/HaiCharacter.tsx`, Farben des Logos: Dunkelblau und Türkis), nur `transform` und `opacity` werden animiert (CSS in `src/app/globals.css`, Klassen `hai-figure` und `hf-*`). Die Figur ist zweimal gezeichnet, einmal über und einmal unter der Wasserlinie, zugeschnitten auf das Wasser: So stehen die Füße sichtbar unter der Oberfläche (getönt, mit leichtem Wackeln durch die Brechung), und beim Aufstieg erscheint die Figur zuerst durchs Wasser.

**Reduzierte Bewegung** (`prefers-reduced-motion: reduce`): Es bewegt sich nichts, weder Animation noch Übergang noch Aufstieg (die Figur steht sofort, beim Beenden ist sie sofort weg). Die Haltung (Arme, Kopf, Augen), die Mundform und die Farbe des Beckens zeigen den Zustand weiter, dazu der Text. Das gilt doppelt abgesichert, über die Systemeinstellung im CSS und über ein Attribut (`data-motion="reduced"`), das die Komponente aus derselben Einstellung setzt.

## 3. Chat im Hintergrund

Der Sprachmodus benutzt denselben Chat, nicht einen zweiten:

- Eine **Sprachsitzung** (`HaiVoiceSessionProvider`, `src/components/hai/voice-mode/HaiVoiceSession.tsx`) liegt im `HaiWrapper` innerhalb des `HaiProvider`, über allen Seiten. Sie besitzt die eine Gesprächsschleife (`useHaiVoice`). Das Mikrofon im Chat (`HaiVoiceControl`) und der Sprachmodus lesen dieselbe Schleife, es gibt nie zwei.
- Die Schleife ruft `sendMessage(text, { voice: true })` des `HaiProvider`. Jede gesprochene Frage ist damit eine Nutzernachricht, jede Antwort eine Antwort der HAI in derselben Sitzung. Nach dem Gespräch steht alles im Chat zum Nachlesen. Es gibt keinen neuen Server-Pfad: `/api/hai/chat` mit `voice: true`, die Prüfung des Schalters der Organisation und der Anbieterkette (Soniox, Sokrates, Browser) bleiben, wie sie waren.
- Der Ablauf bleibt der des Hooks: Zuhören, Antwort Satz für Satz vorlesen (Mikrofon dabei aus), wieder zuhören, Unterbrechen, Stopp per Sprachbefehl, nach drei stillen Runden Pause.

Was der Hook dafür nach außen gibt (rückwärtskompatibel, alles zusätzlich): `heard` (die zuletzt verstandene Frage), `spoken` (die Stücke der Antwort, die an die Stimme gegeben wurden), `level` (Lautstärke der Aufnahme von 0 bis 1, wenn der Anbieter sie meldet, sonst `null`).

Die Sprachsitzung fragt den Schalter der Organisation (`GET /api/hai/voice`) erst, wenn der Chat zum ersten Mal geöffnet wurde. Eine Seite, auf der niemand die HAI benutzt, macht damit keinen zusätzlichen Aufruf. Die Figur liegt in einem Portal außerhalb des Seiteninhalts und in der Sitzung über den Seiten, deshalb bleibt sie beim Seitenwechsel stehen.

## 4. Der Mund bewegt sich mit der Sprache

Der Mund hat vier Formen (`data-mouth`): `closed` (Lippen zu, lächelt), `half` (halb offen), `open` (offen, mit Zunge) und `round` (ein kleines "o"). Ein Haken (`useMouthShape`) entscheidet in jedem Animationsbild (`requestAnimationFrame`) über die Form und schreibt sie als Attribut an die Figur, das CSS blendet die passende Form ein. **Es gibt keinen React-Zustand je Bild**, nichts wird neu gerendert, das Attribut wird nur bei einer Änderung geschrieben. Das Attribut `data-mouth-source` sagt, woher die Form kommt:

| Quelle | Wann | Wie |
|---|---|---|
| `level` | Die Wiedergabe läuft über Web Audio: die Anbieter Soniox und Sokrates (`OrderedPlayback` in `src/lib/hai/voice/client/audio.ts`) | Jede abgespielte Quelle ist zusätzlich mit einem `AnalyserNode` verbunden (einer je Audio-Kontext, `src/lib/hai/voice/client/outputLevel.ts`). Der Klang geht unverändert an den Ausgang. Der Haken liest die Lautstärke (Effektivwert, auf 0 bis 1 skaliert) und leitet die Form ab: unter 0,05 zu, bis 0,16 halb offen, darüber offen, jede dritte Silbe ein rundes "o" |
| `rhythm` | Das Vorlesen des Browsers (`speechSynthesis`) liefert keinen Pegel, der Haken sieht nur `speechSynthesis.speaking` | Ein Rhythmusmuster aus Silbentakten von 110 bis 230 Millisekunden mit zufälliger Streuung und kurzen Pausen wie zwischen Wörtern, solange der Browser spricht. Die `boundary`-Ereignisse der Äußerung werden nicht gelesen, weil die Sprachausgabe dafür angefasst werden müsste |
| `none` | Nichts ist hörbar (zwischen zwei Sätzen, oder nicht im Zustand "spricht") | Mund zu |

Der Pegel zählt nur im Zustand "spricht". In den anderen Zuständen bleibt der Mund zu, auch wenn irgendwo noch Ton ist. Mit reduzierter Bewegung läuft der Haken weiter (Mundform ist keine Bewegung der Figur), alle Animationen sind aus.

## 5. Navigation im Sprachmodus

Die Agentenschicht (`docs/hai-agentenschicht.md`) liefert zu einer Wegweiser-Frage ein Navigationsangebot ("Soll ich sie öffnen?"). Im Sprachmodus gilt:

1. Die HAI nennt die Seite mit dem Grund und fragt. Neben der Figur steht dazu die Karte mit dem Knopf "Öffnen" (dieselbe Karte wie im Chat, in einem dunklen Feld).
2. "Ja" oder "Öffnen" (gesprochen) beziehungsweise der Knopf öffnet die Seite über den Router. Das gesprochene Ja beantwortet der `HaiProvider` selbst, ohne Aufruf des Servers, die HAI sagt kurz "Ich öffne die Seite ...". "Nein" oder eine andere Frage verwirft das Angebot, dann öffnet auch ein späteres "Ja" nichts.
3. Der Sprachmodus **bleibt aktiv**, die Figur bleibt unten links stehen (es ist dieselbe Figur, nichts wird neu gebaut), zeigt weiter ihren Zustand und hört weiter zu. Das Chatpanel wird dabei ausgeblendet, damit es die neue Seite nicht verdeckt.
4. Das Kreuz und der Sprachbefehl "Sprachmodus beenden" beenden den Modus.

Die Sitzung überlebt die Navigation, weil der `HaiProvider` im `RootLayout` über den Seiten liegt und beim Seitenwechsel nicht neu gebaut wird. Die Navigation schreibt nie etwas. Die Zulassungsliste der Pfade (`isAllowedNavigationPath`), die Berechtigung und die Berufstrennung bleiben beim Server wie bisher.

Ein Seitenwechsel außerhalb des Sprachmodus (Tipp auf "Öffnen" im Text-Chat) öffnet die Figur nicht.

## 6. Datenschutz und Schalter

- Der Schalter je Organisation (`VOICE_DISABLED`, Standard aus) gilt unverändert. Ist der Sprachassistent aus, erscheint der Knopf "Gespräch" nicht, ebenso wenig das Mikrofon. Gesprochene Anfragen weist der Server wie bisher mit 403 ab.
- **Keine Aufnahme ohne Einwilligung.** Fehlt die Einwilligung, öffnet der Knopf zwar den Sprachmodus, die Figur steigt auf, daneben steht aber zuerst eine kleine Karte mit der Einwilligung, dem wirksamen Anbieter und dem Ersatz (Text aus `consentParagraphs`, dieselben Sätze wie am Mikrofon). Bis zum Klick auf "Einverstanden und starten" wird nichts aufgenommen, auch ein Klick auf die Figur startet nichts, der Mikrofonknopf ist gesperrt. "Abbrechen" beendet den Sprachmodus. Der Fokus liegt zuerst auf "Einverstanden und starten".
- Hinter dem Knopf "Hinweise" steht jederzeit, wohin der Ton gerade geht (derselbe Satz wie in den Einstellungen des Mikrofons).
- Die Figur ist ein eigenes Bild aus Formen, es wird nichts nachgeladen, kein Dienst von außen, keine Verfolgung. Das Logo-Bild (`public/images/hai-logo.png`) bleibt Marke im Knopf und im Banner des Chats, die Figur übernimmt nur seine Farben und das Wasser.

## 7. Barrierefreiheit

- Die Figur ist Dekoration: `aria-hidden`, nichts darin ist fokussierbar, es gibt keinen Text im Bild.
- Der Zustand steht als kleine Zeile (`role="status"`, `aria-live="polite"`, sichtbar als Marke neben dem Becken) und ist für Bildschirmleser da.
- Die Bedienelemente haben Namen (`aria-label` und `title`), sind echte Knöpfe, sind per Tab erreichbar und haben einen sichtbaren Fokusring (hell mit dunklem Abstand, in beiden Themes sichtbar). Mindestgröße 40 Pixel.
- Esc beendet das Gespräch. Es gibt keine Fokusfalle und kein `aria-modal`: Tab verlässt die Leiste und erreicht die Seite. Beim Öffnen liegt der Fokus auf dem Mikrofonknopf (mit offener Einwilligung auf "Einverstanden und starten"), beim Beenden geht er an den öffnenden Knopf zurück.
- Reduzierte Bewegung: siehe Abschnitt 2.
- Kontrast: Die Sprechblase ist dunkelblaue Schrift auf Weiß, die Leiste und der Zustandstext sind helle Schrift auf Dunkelblau, das Becken hat einen hellen Rand und dunkle Umrisse, damit die Figur auf hellem und dunklem Hintergrund steht.

## 8. Aufbau

Dateien in `src/components/hai/voice-mode/`:

| Datei | Aufgabe |
|---|---|
| `HaiVoiceSession.tsx` | Sprachsitzung: die eine Schleife, offen oder zu, Mikrofon aus oder an, Untertitel-Wahl, Einwilligung |
| `voiceSessionContext.ts` | Form und Kontext der Sitzung |
| `HaiVoiceModeOverlay.tsx` | die Figur unten links mit Sprechblase, Karten und Bedienleiste, Esc, Fokus, Eintauchen |
| `HaiCharacter.tsx` | die Figur als SVG mit allen Zuständen, Aufstieg und Eintauchen |
| `mouth.ts` | die vier Mundformen: aus dem Pegel oder aus dem Rhythmusmuster (reine Logik) |
| `useMouthShape.ts` | der Haken, der die Mundform je Bild als Attribut schreibt |
| `HaiVoiceModeButton.tsx` | der Knopf "Gespräch" |
| `useVoiceEnabled.ts` | Schalter der Organisation (`GET /api/hai/voice`) |
| `usePrefersReducedMotion.ts`, `providerStatement.ts` | Bewegungseinstellung, Anbieter-Satz |

Gemeinsame Dateien, nur klein und lesend: `src/lib/hai/voice/client/audio.ts` (drei Zeilen: jede abgespielte Quelle zusätzlich an den Abgriff hängen) und die neue Datei `src/lib/hai/voice/client/outputLevel.ts` (der Abgriff und das Lesen des Pegels). Die Logik der Anbieterkette, der Erkennung und der Sprachausgabe ist unverändert. Entfallen sind `HaiMascot.tsx` (das Logo-Bild im Rahmen) und `useFocusTrap.ts` (es gibt keine Fokusfalle mehr).

## 9. Prüfungen

- `tests/unit/components/hai/HaiVoiceMode.test.tsx` (51 Fälle): mit dem echten `HaiProvider`, der echten Gesprächsschleife und der echten Sprachsitzung, nachgebildeter Browser. Geprüft werden: Knopf nur bei eingeschaltetem Schalter, Figur unten links statt Dialog (kein `inset-0`, kein `aria-modal`, z-40, Klicks gehen durch), Aufstieg und Eintauchen, Esc (und Esc, das schon benutzt wurde), Kreuz, Sprachbefehl, Fokus zurück an den Knopf, keine Fokusfalle, nichts füllt den Bildschirm, Chat-Fenster und Handy, Einwilligung als kleine Karte, Zustände, Mikrofon aus und an, Untertitel in der Sprechblase, Chat im Hintergrund, Navigation mit "ja" (dieselbe Figur bleibt stehen), Quiz-Modus, reduzierte Bewegung, Namen und Rollen, Hinweise.
- `tests/unit/components/hai/HaiCharacter.test.tsx`: Teile der Figur (Kopf, Augen, Flosse, Arme mit Händen, Körper, Beine, Füße, Becken), Haltung je Zustand als Datenattribute, Warnfarbe, Aufstieg und Eintauchen, Mund folgt dem Pegel, reduzierte Bewegung.
- `tests/unit/components/hai/mouth.test.ts`, `tests/unit/components/hai/useMouthShape.test.tsx`: die Mundformen aus Pegel und Rhythmus, der Haken mit gefälschtem `AnalyserNode` und von Hand geführtem Takt, kein React-Rendern je Bild.
- `tests/unit/hai/outputLevel.test.ts`: der Abgriff (ein `AnalyserNode` je Kontext, Quelle geht weiter an den Ausgang, ohne Analyser unverändert) und das Lesen des Pegels.
- Gestaltung: Bildschirmfotos der sechs Zustände, des Aufstiegs, der vier Mundformen sowie hell, dunkel und Handy lagen der Übergabe bei (aus einer Vorschau außerhalb des Repositorys).

## 10. Grenzen und nächste Stufe

- **Nicht mit echtem Gerät geprüft:** echtes Mikrofon, echter Ton, ob der Mund bei Soniox und Sokrates zur Stimme passt (der Abgriff ist gegen einen gefälschten Analyser getestet, nicht gegen echten Ton), Safari und iOS (Audio freischalten im Tipp), das Verhalten bei eingeblendeter Bildschirmtastatur auf dem Handy. Die Fälle stehen im Testplan, Gruppe J.
- **Browser-Stimme:** Der Mund folgt hier einem Rhythmusmuster, nicht den Silben der Stimme, weil `speechSynthesis` keinen Pegel liefert. Er ist deshalb nicht lippensynchron, er bewegt sich nur, solange gesprochen wird.
- **Die Figur liegt über der Seite** unten links und kann dort Inhalt verdecken, auch eine seitliche Navigation. Die Leiste ist klein, die Figur lässt Klicks durch, das Kreuz beendet sie.
- **Pegel der Aufnahme:** Soniox und Sokrates melden den Pegel (`onlevel`), das Wasser folgt ihm im Zustand "hört zu" (Abschnitt 12). Der Browser als Anbieter meldet ihn nicht, dort laufen ruhige Ringe, schneller, solange Text des Azubi eintrifft.
- **Quiz-Modus:** Er läuft nicht im Sprachmodus. Startet eine gesprochene Anfrage ihn trotzdem ("Frag mich ab"), endet der Sprachmodus, der Chat öffnet sich und zeigt die Quiz-Karte.
- Aktionskarten (Bestätigung einer Schreibaktion) erscheinen nur im Chat, nicht im Sprachmodus.

## 11. Vorbild damicon

Übernommen aus damicon: das Gespräch mit dem Maskottchen und den Zuständen wartet, hört zu, denkt, spricht, die Untertitel, der Chat im Hintergrund, das Weiterlaufen über Seitenwechsel, die Zustandsschrift neben der Animation. Der Grundsatz "Warum kein neuer Chat" gilt hier genauso: Der Sprachmodus benutzt denselben Chat wie das Panel, und nach dem Gespräch steht alles dort zum Nachlesen.

Anders als bei damicon: Die HAI hat keinen eigenen dritten Modus auf dem Server. Die gesprochenen Regeln (`buildVoiceRules`) und der Schalter existierten schon, der Sprachmodus ist hier nur die Oberfläche. Die Figur ist neu gezeichnet, in den Farben der Marke der HAI.

## 12. Dauerzuhören, Mikrofonzustand und Rückfallhinweis (03.11.2026)

Mit Soniox bleibt das Mikrofon, solange der Sprachmodus läuft, für das ganze Gespräch offen (Einzelheiten, Datenschutz und Schalter: `docs/hai-sprachassistent.md`, Abschnitt 8). Die Figur und die Leiste zeigen das so:

- **Zustandstext:** "HAI hört zu" erscheint erst, wenn das Mikrofon wirklich offen ist (`voice.micOpen`), vorher steht "HAI richtet das Mikrofon ein". Mit Mikrofon aus bleibt "Mikrofon ist aus".
- **Mikrofonknopf:** pulsiert nur bei offenem Mikrofon (`data-mic-open="true"`), steht sonst still. Der Knopf schaltet das Mikrofon wie bisher aus und an (`toggleMic`, beendet das offene Mikrofon sofort).
- **Zusatzzeile "Mikrofon offen"** (`data-testid="hai-voice-mic-open"`) steht unter dem Zustand, solange die HAI denkt oder spricht und das Mikrofon dabei offen ist: Die Person sieht, dass sie die HAI unterbrechen kann. In Runden und bei ausgeschaltetem Mikrofon fehlt sie.
- **Unterbrechen per Stimme:** Der Zustand der Figur wechselt von "spricht" zu "hört zu", sobald die Wiedergabe gestoppt ist, die Untertitel zeigen die neue Äußerung. Ein Tipp auf die Figur oder die Hand unterbricht weiter wie bisher.
- **Hinweise:** Im Live-Modus steht dort zusätzlich "Das Mikrofon bleibt offen, solange der Sprachmodus läuft. Sie können die HAI unterbrechen, indem Sie einfach sprechen." (`hai.voice.liveHint`).
- **Rückfallhinweis:** Neben dem Zustand steht in Amber eine Zeile, wenn Zuhören oder Sprechen nicht über den geplanten Anbieter läuft ("Ich höre über den Browser. Der Dienst hat den Schlüssel abgelehnt."), je Funktion eine Zeile (`HaiVoiceFallbackNotice`, `data-testid="hai-voice-fallback"`). Ohne Rückfall fehlt sie.
- **Pegel:** Das Wasser folgt dem echten Pegel der Aufnahme (`voice.level`, von Soniox über `onlevel`), solange der Zustand "hört zu" ist.
- **Wartesatz:** Dauert die Antwort länger als drei Sekunden, sagt die HAI einmal "Einen Moment." (`waitPhrase` der Sitzung), der Satz steht nicht in den Untertiteln und nicht im Chat.
- **Einwilligungskarte:** nennt bei Soniox zusätzlich das offene Mikrofon (`hai.voice.consent.live`).

Geändert gegenüber Abschnitt 10: Der Punkt "Pegel der Aufnahme" ist erledigt (Soniox und Sokrates melden `onlevel`, `ChainedRecognition` reicht ihn durch).
