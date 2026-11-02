# HAI Sprachmodus mit Maskottchen

Stand: 02.11.2026. Der Sprachmodus ist ein Gesprächsmodus über dem Sprachassistenten (`docs/hai-sprachassistent.md`): Ein Vollbild mit dem Hai als Maskottchen, der mit dem Azubi spricht. Was gesagt wird, steht im Chat im Hintergrund. Das Vorbild ist der Sprachmodus von damicon (`docs/infra/sprachmodus.md` im Repository damicon), übertragen auf die HAI.

Der Sprachmodus ändert nichts an dem, was die HAI darf oder weiß. Berufstrennung, Lösungsschutz, Berechtigungen und die Regeln für gesprochene Antworten (`buildVoiceRules`, höchstens vier Sätze) gelten unverändert. Er ist eine neue Oberfläche auf demselben Sprachassistenten, ohne neue Route und ohne neuen Server-Pfad.

## 1. Bedienung

- **Einstieg:** Im Chat gibt es den Knopf "Gespräch" (Sprechwellen-Symbol), in der Kopfzeile des Chats (Seitenansicht und Vollbild) und neben dem Mikrofon. Er erscheint nur, wenn die Organisation den Sprachassistenten eingeschaltet hat und der Browser mindestens einen Anbieter der Kette nutzen kann, also unter derselben Voraussetzung wie das Mikrofon. Der Knopf ist ein echter Knopf: Tab erreicht ihn, Enter und Leertaste öffnen den Sprachmodus.
- **Das Vollbild:** Ein Dialog über der ganzen Seite (`role="dialog"`, `aria-modal`, benannt "Sprachmodus: Gespräch mit der HAI"). Der Fokus liegt zuerst auf dem Maskottchen und bleibt im Dialog (Tab und Umschalt+Tab laufen im Kreis). Beim Schließen geht der Fokus an den Knopf zurück, der den Sprachmodus geöffnet hat.
- **Beenden:** Esc, der Knopf mit dem Kreuz ("Sprachmodus beenden") oder der Sprachbefehl "Sprachmodus beenden" (auch "Stopp", "Tschüss", "Das war es", die Liste steht in `isStopCommand`). Das Beenden schaltet das Mikrofon aus und bricht das Vorlesen ab.
- **Das Maskottchen antippen:** Während die HAI spricht oder nachdenkt, unterbricht der Tipp und die HAI hört zu. Nach einer Pause oder einem Fehler ("Erneut zuhören") startet der Tipp das Zuhören neu. Während die HAI zuhört, tut der Tipp nichts.
- **Untertitel:** Ein Schalter "Untertitel" in der Kopfzeile des Sprachmodus, standardmäßig an. Die Wahl bleibt im Browser (`hai-voice-mode-captions`). Mit Untertiteln steht oben die Frage des Azubi (erst als Zwischenergebnis, dann so, wie sie an die HAI ging), darunter die Antwort der HAI Satz für Satz, so wie sie vorgelesen wird, der letzte Satz hell, die früheren gedimmt. Ohne Untertitel bleibt nur der Zustand als Text. Die Schrift ist groß (ab 768 Pixel noch größer), es gibt kein Markdown, weil die gesprochene Antwort schon kurz und ohne Formatierung ist.
- **Tagesbegleiter:** Beim ersten Gespräch des Tages stellt die HAI die Eröffnungsfrage selbst ("Guten Morgen, was steht heute an?", nach Tageszeit, Berliner Zeit). Im Sprachmodus ist das die erste gesprochene Äußerung des Maskottchens, sie erscheint als Untertitel. Abschaltbar in den Einstellungen des Mikrofons wie bisher.
- **Seite öffnen:** siehe Abschnitt 4.

## 2. Zustände

Das Maskottchen zeigt den Zustand der Gesprächsschleife (`useHaiVoice`). Der Zustand steht immer auch als Text (`role="status"`, `aria-live="polite"`), nie nur als Bewegung.

| Zustand | Wann (Hook) | Maskottchen | Text |
|---|---|---|---|
| wartet | Phase `idle`, vor dem ersten Zuhören oder bei fehlender Einwilligung | schwebt langsam | HAI wartet |
| hört zu | Phase `listening` | ruhige Ringe breiten sich aus, schneller, solange Text des Azubi eintrifft. Folgt der Anbieter der Lautstärke (`level`), wächst der Schein mit ihr | HAI hört zu |
| denkt | Phase `thinking` | ein Ring kreist um das Zeichen, das Zeichen atmet | HAI denkt nach |
| spricht | Phase `speaking` | das Zeichen schwimmt im Takt der Sprache, Ringe breiten sich aus | HAI spricht |
| Pause | Phase `error` mit `no-speech` (drei stille Runden) | amber Rahmen, keine Ringe | HAI macht Pause, dazu "Tippen Sie auf die HAI, um weiterzusprechen" |
| Fehler | Phase `error` sonst (Mikrofon verweigert, Spracherkennung fehlgeschlagen, nicht unterstützt) | amber Rahmen, keine Ringe | Das Gespräch ist angehalten, dazu die Fehlermeldung des Mikrofons |

Mit `prefers-reduced-motion: reduce` bewegt sich nichts: keine Ringe, kein Schwimmen, keine Pulsbewegung, nur der Rahmen wechselt die Farbe. Das gilt doppelt abgesichert, über die Systemeinstellung im CSS und über ein Attribut (`data-motion="reduced"`), das die Komponente aus derselben Einstellung setzt.

## 3. Chat im Hintergrund

Der Sprachmodus benutzt denselben Chat, nicht einen zweiten:

- Eine **Sprachsitzung** (`HaiVoiceSessionProvider`, `src/components/hai/voice-mode/HaiVoiceSession.tsx`) liegt im `HaiWrapper` innerhalb des `HaiProvider`, über allen Seiten. Sie besitzt die eine Gesprächsschleife (`useHaiVoice`). Das Mikrofon im Chat (`HaiVoiceControl`) und der Sprachmodus lesen dieselbe Schleife, es gibt nie zwei.
- Die Schleife ruft `sendMessage(text, { voice: true })` des `HaiProvider`. Jede gesprochene Frage ist damit eine Nutzernachricht, jede Antwort eine Antwort der HAI in derselben Sitzung (dieselbe `sessionId`, derselbe Verlauf). Nach dem Gespräch steht alles im Chat zum Nachlesen. Es gibt keinen neuen Server-Pfad: `/api/hai/chat` mit `voice: true`, die Prüfung des Schalters der Organisation und der Anbieterkette (Soniox, Sokrates, Browser) bleiben, wie sie waren.
- Der Ablauf bleibt der des Hooks: Zuhören, Antwort Satz für Satz vorlesen (Mikrofon dabei aus), wieder zuhören, Unterbrechen per Tipp, Stopp per Sprachbefehl, nach drei stillen Runden Pause.

Was der Hook dafür nach außen gibt (rückwärtskompatibel, alles zusätzlich): `heard` (die zuletzt verstandene Frage), `spoken` (die Stücke der Antwort, die an die Stimme gegeben wurden), `level` (Lautstärke 0 bis 1, wenn der Anbieter sie meldet, sonst `null`).

Die Sprachsitzung fragt den Schalter der Organisation (`GET /api/hai/voice`) erst, wenn der Chat zum ersten Mal geöffnet wurde. Eine Seite, auf der niemand die HAI benutzt, macht damit keinen zusätzlichen Aufruf.

## 4. Navigation im Sprachmodus

Die Agentenschicht (`docs/hai-agentenschicht.md`) liefert zu einer Wegweiser-Frage ein Navigationsangebot ("Soll ich sie öffnen?"). Im Sprachmodus gilt:

1. Die HAI nennt die Seite mit dem Grund und fragt. Unter den Untertiteln steht dazu die Karte mit dem Knopf "Öffnen" (dieselbe Karte wie im Chat).
2. "Ja" oder "Öffnen" (gesprochen) beziehungsweise der Knopf öffnet die Seite über den Router. Das gesprochene Ja beantwortet der `HaiProvider` selbst, ohne Aufruf des Servers, die HAI sagt kurz "Ich öffne die Seite ...". "Nein" oder eine andere Frage verwirft das Angebot, dann öffnet auch ein späteres "Ja" nichts.
3. Der Sprachmodus **bleibt aktiv**. Das Maskottchen rückt als kleine Einheit an den Rand (unten rechts ab 768 Pixel, auf dem Handy unten in der Mitte), zeigt weiter seinen Zustand als Text, hört weiter zu und liegt über der neuen Seite. Der Chat (Panel) wird dabei ausgeblendet, damit er die Seite nicht verdeckt.
4. Ein Tipp auf das kleine Maskottchen holt das Vollbild zurück, das Kreuz beendet den Modus. Der Sprachbefehl "Sprachmodus beenden" beendet beide Ansichten.
5. Öffnet man das Chatpanel, während die kleine Einheit läuft, rückt sie neben das Panel (ab 768 Pixel) beziehungsweise nach oben (Handy), damit sie die Eingabe nicht verdeckt.

Die Sitzung überlebt die Navigation, weil der `HaiProvider` im `RootLayout` über den Seiten liegt und beim Seitenwechsel nicht neu gebaut wird. Die Navigation schreibt nie etwas. Die Zulassungsliste der Pfade (`isAllowedNavigationPath`), die Berechtigung und die Berufstrennung bleiben beim Server wie bisher, die Seite prüft selbst noch einmal, wie bei einem Link in der Adresszeile.

Ein Seitenwechsel außerhalb des Sprachmodus (Tipp auf "Öffnen" im Text-Chat) macht den Sprachmodus nicht zur kleinen Einheit, er ist dann nicht offen.

## 5. Datenschutz und Schalter

- Der Schalter je Organisation (`VOICE_DISABLED`, Standard aus) gilt unverändert. Ist der Sprachassistent aus, erscheint der Knopf "Gespräch" nicht, ebenso wenig das Mikrofon. Gesprochene Anfragen weist der Server wie bisher mit 403 ab.
- **Keine Aufnahme ohne Einwilligung.** Fehlt die Einwilligung, öffnet der Knopf zwar den Sprachmodus, der zeigt aber zuerst die Einwilligung, mit dem wirksamen Anbieter und dem Ersatz (Text aus `consentParagraphs`, dieselben Sätze wie am Mikrofon). Bis zum Klick auf "Einverstanden und starten" wird nichts aufgenommen, auch ein Tipp auf das Maskottchen startet nichts. "Abbrechen" beendet den Sprachmodus.
- Im Fuß des Sprachmodus steht jederzeit, wohin der Ton gerade geht (derselbe Satz wie in den Einstellungen des Mikrofons).
- Der Hai ist das vorhandene Zeichen der HAI. Es wird nichts nachgeladen, kein Dienst von außen, keine Verfolgung.

## 6. Das Hai-Bild

Verwendet wird das Bild, das die App schon für die HAI hat: `public/images/hai-logo.png` (die Welle mit der Haiflosse, dieselbe Marke wie im Knopf und im Banner des Chats, `HaiButton`, `HaiLogoBanner`). Es sitzt in einem runden Rahmen auf dem Dunkelblau der Marke, der Dialog selbst hat einen dunklen Verlauf, so ist es in hellem und dunklem Theme gleich lesbar. Es gibt keine neue Bilddatei und kein neues Logo. Die Animationsgif-Datei der App (`shark-new.gif`) wird nicht benutzt: Sie lässt sich nicht pausieren und hat kein ruhiges Standbild, das bräuchte der Modus für `prefers-reduced-motion` und für die Zustände. Die Zustände entstehen deshalb um das Standbild herum (Ringe, Schein, Schwimmen), als CSS in `src/app/globals.css` (Klassen `hai-mascot-*`).

## 7. Aufbau

Alle neuen Dateien liegen in `src/components/hai/voice-mode/`:

| Datei | Aufgabe |
|---|---|
| `HaiVoiceSession.tsx` | Sprachsitzung: die eine Schleife, Ansicht (zu, groß, klein), Untertitel-Wahl, Einwilligung, Wechsel zur kleinen Einheit nach der Navigation |
| `voiceSessionContext.ts` | Form und Kontext der Sitzung |
| `HaiVoiceModeOverlay.tsx` | das Vollbild und die kleine Einheit |
| `HaiMascot.tsx` | das Maskottchen mit seinen Zuständen |
| `HaiVoiceModeButton.tsx` | der Knopf "Gespräch" |
| `useVoiceEnabled.ts` | Schalter der Organisation (`GET /api/hai/voice`), vorher in `HaiVoiceControl` |
| `useFocusTrap.ts`, `usePrefersReducedMotion.ts`, `providerStatement.ts` | Fokusfalle, Bewegungseinstellung, Anbieter-Satz |

Kleine, abgegrenzte Änderungen in `HaiChat.tsx` (zwei Knöpfe), `HaiWrapper.tsx` (Sprachsitzung um Knopf und Chat), `HaiVoiceControl.tsx` (liest die Sitzung, Knopf "Gespräch" neben dem Mikrofon) und `useHaiVoice.ts` (`heard`, `spoken`, `level`). Der Engine-Code unter `src/lib/hai/voice/` ist unverändert.

Nebenbei geändert: Der Start nach der ersten Einwilligung im Mikrofon-Panel benutzt jetzt den aktuellen Stand der Schleife. Vorher hielt der Knopf den Stand vor der Einwilligung fest, die Sitzung startet mit einem Verweis auf den neuesten Stand.

## 8. Prüfungen

- `tests/unit/components/hai/HaiVoiceMode.test.tsx` (41 Fälle): mit dem echten `HaiProvider`, der echten Gesprächsschleife und der echten Sprachsitzung, nachgebildeter Browser (Spracherkennung, Sprachausgabe, Speicher), nachgebildeter Router und Routen. Geprüft werden Knopf nur bei eingeschaltetem Schalter, Öffnen und Schließen (Esc, Knopf, Sprachbefehl), Fokusfalle und Rückgabe des Fokus, Einwilligung zuerst, Zustände aus den Zuständen des Hooks, Untertitel an und aus, gesprochene Frage und Antwort im Verlauf derselben Sitzung, Tagesbeginn, "ja" und "öffnen" mit Router und kleiner Einheit, Tipp holt das Vollbild zurück, Kreuz und Sprachbefehl beenden die kleine Einheit, Bewegungseinstellung, Namen und Rollen.
- `tests/unit/components/hai/HaiMascot.test.tsx` (15 Fälle): Bild, Zustände, Ringe, Schein mit und ohne Pegel, reduzierte Bewegung.
- `tests/unit/components/hai/useHaiVoice.test.tsx`: neue Fälle für `heard`, `spoken` und `level`.

## 9. Grenzen und nächste Stufe

- **Nicht mit echtem Gerät geprüft:** echtes Mikrofon, echter Ton, die Wirkung der Animation im Browser, die Lage der kleinen Einheit auf einem Handy, Safari und iOS (Audio freischalten im Tipp). Alles in den Tests sind nachgebildete Browser. Die Fälle stehen im Testplan, Abschnitt J.
- **Pegel der Aufnahme:** Der Hook nimmt einen Pegel entgegen (`onlevel` des Erkenners), das Maskottchen folgt ihm. Die Anbieter (Soniox, Sokrates, Browser) melden ihn heute noch nicht. Bis dahin atmet der Schein ruhig, und die Ringe werden schneller, solange Text des Azubi eintrifft. Der nächste Schritt ist, `onlevel` in `ChainedRecognition` weiterzureichen und in `soniox.ts` und `haus.ts` den Pegel zu berechnen, das gehört in `src/lib/hai/voice/` und ist nicht Teil dieser Änderung.
- **Quiz-Modus:** Er läuft nicht im Sprachmodus, das ist die nächste Stufe. Startet eine gesprochene Anfrage ihn trotzdem ("Frag mich ab", die Erkennung sitzt auf dem Server und ist unverändert), endet der Sprachmodus, der Chat öffnet sich und zeigt die Quiz-Karte, damit das Quiz nicht unsichtbar hinter dem Maskottchen läuft. Die Quiz-Karten und die Aktionskarten im Chat sind unberührt. Navigationskarten werden als Text vorgelesen und als Knopf unter den Untertiteln gezeigt.
- Aktionskarten (Bestätigung einer Schreibaktion) erscheinen nur im Chat, nicht im Sprachmodus.
- Die kleine Einheit liegt über der Seite und kann bei einer Seite mit eigenen festen Elementen unten rechts etwas verdecken. Das Kreuz beendet sie, ein Tipp holt das Vollbild zurück.

## 10. Vorbild damicon

Übernommen aus damicon: das Gesprächsfenster mit dem Maskottchen im Zentrum und den Zuständen wartet, hört zu, denkt, spricht, die Untertitel, der Chat im Hintergrund, das Weiterlaufen über Seitenwechsel, die Zustandsschrift neben der Animation. Der Grundsatz "Warum kein neuer Chat" gilt hier genauso: Der Sprachmodus benutzt denselben Chat wie das Panel, nur sichtbar, und nach dem Gespräch steht alles dort zum Nachlesen. Es gibt nicht zwei Wege, die sich auseinanderentwickeln könnten.

Anders als bei damicon: Die HAI hat keinen eigenen dritten Modus auf dem Server. Die gesprochenen Regeln (`buildVoiceRules`) und der Schalter existierten schon, der Sprachmodus ist hier nur die Oberfläche. Das Maskottchen ist das vorhandene Zeichen der HAI (Welle mit Haiflosse) und kein neu gezeichneter Charakter.
