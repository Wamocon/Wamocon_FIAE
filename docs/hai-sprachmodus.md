# HAI Sprachmodus mit Hai-Figur

Stand: 03.11.2026. Der Sprachmodus ist ein Gesprächsmodus über dem Sprachassistenten (`docs/hai-sprachassistent.md`). Die HAI erscheint dabei als **Figur**: der Hai des HAI-Symbols (der Pixel-Hai im runden Fischbecken unten rechts) mit Kopf, Armen, Händen, Körper und Beinen. Das Symbol selbst ist das Becken: Beim Start wird der runde Knopf größer, die Figur steigt aus seinem Wasser auf, spricht mit dem Azubi (der Mund bewegt sich mit der Sprache) und bleibt mit den Beinen im Wasser stehen, solange der Sprachmodus läuft. Beim Beenden taucht sie ein, und der Knopf ist wieder der Knopf. Die Seite dahinter bleibt benutzbar: kein Vollbild, kein Abdunkeln, keine Fokusfalle. Was gesagt wird, steht im Chat im Hintergrund.

Bis PR 263 war der Sprachmodus ein Vollbild mit dem Logo-Bild in einem runden Rahmen. Das ist ersetzt. Der kleine Zustand "Hai rückt an den Rand" entfällt, weil die Figur ohnehin unten rechts steht.

Korrektur vom 03.11.2026: PR 285 hatte Symbol, Chatpanel und Figur nach unten links gelegt, das war ein Missverständnis. Alles liegt wieder unten rechts, wo das HAI-Symbol vor PR 285 war, gespiegelt: das Panel gleitet von rechts, das Becken wächst von der unteren rechten Ecke aus, Sprechblase und Bedienleiste liegen links von der Figur. Die Abschnitte unten beschreiben die gespiegelte Lage.

Der Sprachmodus ändert nichts an dem, was die HAI darf oder weiß. Berufstrennung, Lösungsschutz, Berechtigungen und die Regeln für gesprochene Antworten (`buildVoiceRules`, höchstens vier Sätze) gelten unverändert. Er ist eine Oberfläche auf demselben Sprachassistenten, ohne neue Route und ohne neuen Server-Pfad.

## 1. Bedienung

- **Einstieg:** Im Chat gibt es den Knopf "Gespräch" (Sprechwellen-Symbol), in der Kopfzeile des Chats (Seitenansicht und Vollbild) und neben dem Mikrofon. Er erscheint nur, wenn die Organisation den Sprachassistenten eingeschaltet hat und der Browser mindestens einen Anbieter der Kette nutzen kann. Der Knopf ist ein echter Knopf: Tab erreicht ihn, Enter und Leertaste öffnen den Sprachmodus.
- **Die Figur:** Sie steigt unten rechts (`fixed bottom-4 right-4`, ab sm `bottom-6 right-6`, plus Sicherheitsabstand für Notch und Home-Leiste) aus dem Wasser des HAI-Symbols auf, mit Spritzern. Sie teilt den Anker mit dem Symbol (`src/components/hai/haiLayout.ts`), steht also genau dort, wo der Knopf war, und rückt mit ihm nach links, wenn das Chatpanel offen ist: angedockt folgt der rechte Rand des Ankers der Breite der Panelspalte (CSS-Variable `--hai-dock-inset`, das Panel ist ziehbar), als Blatt verschiebt er sich um 420 Pixel (`md:-translate-x-[420px]`). Sie liegt auf Ebene z-40, also unter Dialogen und Viewern (wie der HAI-Knopf) und über dem Seiteninhalt. Auf dem Desktop ist sie etwa 280 Pixel hoch, auf dem Handy etwa 160 Pixel. Nur die Figur und ihre Bedienelemente nehmen Klicks an, alles andere geht an die Seite durch.
- **Bedienelemente** (eine kleine Leiste links neben dem Becken, also dem vergrößerten Symbol, rechtsbündig, alle mit `aria-label`, per Tab erreichbar):
  - Mikrofon ausschalten oder einschalten. Aus: Die Gesprächsschleife hält an, es wird nichts aufgenommen und nichts gesagt, die Figur bleibt stehen und zeigt "Mikrofon ist aus". An: Die Schleife startet wie beim Öffnen.
  - Unterbrechen und zuhören (nur, solange die HAI spricht oder nachdenkt) beziehungsweise "Erneut zuhören" (nach einer Pause oder einem Fehler).
  - Untertitel an oder aus (Schalter, `role="switch"`).
  - Hinweise zum Sprachmodus (klappt eine kleine Karte auf: wie man beendet, wohin der Ton gerade geht).
  - Sprachmodus beenden.
- **Beenden:** Esc (außer eine andere Stelle der Seite hat Esc schon benutzt), der Knopf mit dem Kreuz oder der Sprachbefehl "Gespräch beenden" oder "Sprachmodus beenden" (auch "Tschüss", "Auf Wiedersehen", "Das war es", die Wörter stehen an einer Stelle, `src/lib/hai/voice/signalWords.ts`, Abschnitt 14). "Stopp" beendet nicht mehr, es hält die HAI nur an. Das Beenden schaltet das Mikrofon aus und bricht das Vorlesen ab. Die Figur taucht danach wieder ins Wasser ein (etwa 0,8 Sekunden), dabei sind Bedienelemente und Zustandstext schon weg. Der Fokus geht an den Knopf zurück, der den Sprachmodus geöffnet hat.
- **Die Figur antippen:** Während die HAI spricht oder nachdenkt, unterbricht der Klick auf die Figur, und die HAI hört zu. Nach einer Pause oder einem Fehler startet er das Zuhören neu. Per Tastatur gibt es dafür den Knopf in der Leiste.
- **Untertitel:** Eine Sprechblase neben dem Kopf (mit Zipfel zum Kopf, dunkle Schrift auf weißem Grund, in beiden Themes lesbar). Oben steht die Frage des Azubi (erst als Zwischenergebnis, dann so, wie sie an die HAI ging), darunter die Antwort Satz für Satz, so wie sie vorgelesen wird, der letzte Satz fett, die früheren gedimmt. Die Wahl bleibt im Browser (`hai-voice-mode-captions`). Ohne Untertitel (oder solange nichts zu zeigen ist) gibt es keine Blase.
- **Tagesbegleiter:** Beim ersten Gespräch des Tages stellt die HAI die Eröffnungsfrage selbst ("Guten Morgen, was steht heute an?", nach Tageszeit, Berliner Zeit). Das ist die erste gesprochene Äußerung der Figur, sie erscheint als Untertitel. Abschaltbar in den Einstellungen des Mikrofons wie bisher.
- **Chatpanel und Figur:** Das Panel (Abschnitt 13 und `docs/hai-chat-panel.md`) ist eine Spalte des Layouts am rechten Rand (die Seite rückt nach links, die Breite ist ziehbar), das Symbol und damit Becken und Figur sitzen links vom Panel am unteren Rand des verbleibenden Inhalts (mit etwa 24 Pixel Abstand zur Spalte, auch beim Ziehen und bei geänderter Breite), beide verdecken sich nicht. Ab 1024 Pixel passen Becken (bis 14 rem) und Sprechblase (bis 18 rem) neben das Panel. Das große Chat-Fenster (Vollbild des Chats) geht beim Öffnen des Sprachmodus auf die Seitenansicht zurück. Unter 1024 Pixel Breite (Handy und schmale Tablets), wo neben dem Panel kein Platz für Becken und Sprechblase bleibt, wird das Panel weggeräumt.
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

Gezeichnet ist alles als eine SVG-Grafik (`src/components/hai/voice-mode/HaiCharacter.tsx`, Farben und Formen des HAI-Symbols, Abschnitt 13), nur `transform` und `opacity` werden animiert (CSS in `src/app/globals.css`, Klassen `hai-figure` und `hf-*`). Die Figur ist zweimal gezeichnet, einmal über und einmal unter der Wasserlinie, zugeschnitten auf das Wasser: So stehen die Füße sichtbar unter der Oberfläche (dunkel getönt, mit leichtem Wackeln durch die Brechung), und beim Aufstieg erscheint die Figur zuerst durchs Wasser.

**Reduzierte Bewegung** (`prefers-reduced-motion: reduce`): Es bewegt sich nichts, weder Animation noch Übergang noch Aufstieg (die Figur steht sofort, beim Beenden ist sie sofort weg). Die Haltung (Arme, Kopf, Augen), die Mundform und die Farbe des Beckens zeigen den Zustand weiter, dazu der Text. Das gilt doppelt abgesichert, über die Systemeinstellung im CSS und über ein Attribut (`data-motion="reduced"`), das die Komponente aus derselben Einstellung setzt.

## 3. Chat im Hintergrund

Der Sprachmodus benutzt denselben Chat, nicht einen zweiten:

- Eine **Sprachsitzung** (`HaiVoiceSessionProvider`, `src/components/hai/voice-mode/HaiVoiceSession.tsx`) liegt im `HaiWrapper` innerhalb des `HaiProvider`, über allen Seiten. Sie besitzt die eine Gesprächsschleife (`useHaiVoice`). Das Mikrofon im Chat (`HaiVoiceControl`) und der Sprachmodus lesen dieselbe Schleife, es gibt nie zwei.
- Die Schleife ruft `sendMessage(text, { voice: true })` des `HaiProvider`. Jede gesprochene Frage ist damit eine Nutzernachricht, jede Antwort eine Antwort der HAI in derselben Sitzung. Nach dem Gespräch steht alles im Chat zum Nachlesen. Es gibt keinen neuen Server-Pfad: `/api/hai/chat` mit `voice: true`, die Prüfung des Schalters der Organisation und der Anbieterkette (Soniox, Sokrates, Browser) bleiben, wie sie waren.
- Der Ablauf bleibt der des Hooks: Zuhören, Antwort Satz für Satz vorlesen (Mikrofon dabei aus), wieder zuhören, Unterbrechen, Anhalten per Signalwort, Beenden per Sprachbefehl, nach drei stillen Runden Pause.

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
3. Der Sprachmodus **bleibt aktiv**, die Figur bleibt unten rechts stehen (es ist dieselbe Figur, nichts wird neu gebaut), zeigt weiter ihren Zustand und hört weiter zu. Das Chatpanel wird dabei ausgeblendet, damit es die neue Seite nicht verdeckt.
4. Das Kreuz und der Sprachbefehl "Sprachmodus beenden" beenden den Modus.

Die Sitzung überlebt die Navigation, weil der `HaiProvider` im `RootLayout` über den Seiten liegt und beim Seitenwechsel nicht neu gebaut wird. Die Navigation schreibt nie etwas. Die Zulassungsliste der Pfade (`isAllowedNavigationPath`), die Berechtigung und die Berufstrennung bleiben beim Server wie bisher.

Ein Seitenwechsel außerhalb des Sprachmodus (Tipp auf "Öffnen" im Text-Chat) öffnet die Figur nicht.

## 6. Datenschutz und Schalter

- Der Schalter je Organisation (`VOICE_DISABLED`, Standard aus) gilt unverändert. Ist der Sprachassistent aus, erscheint der Knopf "Gespräch" nicht, ebenso wenig das Mikrofon. Gesprochene Anfragen weist der Server wie bisher mit 403 ab.
- **Keine Aufnahme ohne Einwilligung.** Fehlt die Einwilligung, öffnet der Knopf zwar den Sprachmodus, die Figur steigt auf, daneben steht aber zuerst eine kleine Karte mit der Einwilligung, dem wirksamen Anbieter und dem Ersatz (Text aus `consentParagraphs`, dieselben Sätze wie am Mikrofon). Bis zum Klick auf "Einverstanden und starten" wird nichts aufgenommen, auch ein Klick auf die Figur startet nichts, der Mikrofonknopf ist gesperrt. "Abbrechen" beendet den Sprachmodus. Der Fokus liegt zuerst auf "Einverstanden und starten".
- Hinter dem Knopf "Hinweise" steht jederzeit, wohin der Ton gerade geht (derselbe Satz wie in den Einstellungen des Mikrofons).
- Die Figur ist ein eigenes Bild aus Formen, es wird nichts nachgeladen, kein Dienst von außen, keine Verfolgung. Das Logo-Bild (`public/images/hai-logo.png`) bleibt Marke im Banner des Chats. Die Figur übernimmt Farben und Formen des Pixel-Hais im Symbol (`public/images/shark-new.gif`).

## 7. Barrierefreiheit

- Die Figur ist Dekoration: `aria-hidden`, nichts darin ist fokussierbar, es gibt keinen Text im Bild.
- Der Zustand steht als kleine Zeile (`role="status"`, `aria-live="polite"`, sichtbar als Marke neben dem Becken) und ist für Bildschirmleser da.
- Die Bedienelemente haben Namen (`aria-label` und `title`), sind echte Knöpfe, sind per Tab erreichbar und haben einen sichtbaren Fokusring (hell mit dunklem Abstand, in beiden Themes sichtbar). Mindestgröße 40 Pixel.
- Esc beendet das Gespräch. Es gibt keine Fokusfalle und kein `aria-modal`: Tab verlässt die Leiste und erreicht die Seite. Beim Öffnen liegt der Fokus auf dem Mikrofonknopf (mit offener Einwilligung auf "Einverstanden und starten"), beim Beenden geht er an den öffnenden Knopf zurück.
- Reduzierte Bewegung: siehe Abschnitt 2.
- Kontrast: Die Sprechblase ist dunkelblaue Schrift auf Weiß, die Leiste und der Zustandstext sind helle Schrift auf Dunkelblau, die Figur hat den schwarzen Umriss des Originals, damit sie auf hellem und dunklem Hintergrund steht.

## 8. Aufbau

Gemeinsamer Anker von Symbol, Panel und Figur: `src/components/hai/haiLayout.ts`. Der Knopf ist `src/components/hai/HaiButton.tsx`.

Dateien in `src/components/hai/voice-mode/`:

| Datei | Aufgabe |
|---|---|
| `HaiVoiceSession.tsx` | Sprachsitzung: die eine Schleife, offen oder zu, Mikrofon aus oder an, Untertitel-Wahl, Einwilligung |
| `voiceSessionContext.ts` | Form und Kontext der Sitzung |
| `HaiVoiceModeOverlay.tsx` | die Figur am Anker des Symbols (unten rechts) mit Sprechblase, Karten und Bedienleiste, Esc, Fokus, Eintauchen |
| `HaiCharacter.tsx` | die Figur als SVG im Aussehen des Originals mit allen Zuständen, Aufstieg und Eintauchen (das Wasser darin, das Becken ist das Symbol) |
| `usePondState.ts` | "Becken offen": während der Sprachmodus läuft und bis die Figur eingetaucht ist (liest der Knopf und die Figur aus derselben Quelle) |
| `mouth.ts` | die vier Mundformen: aus dem Pegel oder aus dem Rhythmusmuster (reine Logik) |
| `useMouthShape.ts` | der Haken, der die Mundform je Bild als Attribut schreibt |
| `HaiVoiceModeButton.tsx` | der Knopf "Gespräch" |
| `useVoiceEnabled.ts` | Schalter der Organisation (`GET /api/hai/voice`) |
| `usePrefersReducedMotion.ts`, `providerStatement.ts` | Bewegungseinstellung, Anbieter-Satz |

Gemeinsame Dateien, nur klein und lesend: `src/lib/hai/voice/client/audio.ts` (drei Zeilen: jede abgespielte Quelle zusätzlich an den Abgriff hängen) und die neue Datei `src/lib/hai/voice/client/outputLevel.ts` (der Abgriff und das Lesen des Pegels). Die Logik der Anbieterkette, der Erkennung und der Sprachausgabe ist unverändert. Entfallen sind `HaiMascot.tsx` (das Logo-Bild im Rahmen) und `useFocusTrap.ts` (es gibt keine Fokusfalle mehr).

## 9. Prüfungen

- `tests/unit/components/hai/HaiVoiceMode.test.tsx` (51 Fälle): mit dem echten `HaiProvider`, der echten Gesprächsschleife und der echten Sprachsitzung, nachgebildeter Browser. Geprüft werden: Knopf nur bei eingeschaltetem Schalter, Figur unten rechts statt Dialog (kein `inset-0`, kein `aria-modal`, z-40, Klicks gehen durch), Aufstieg und Eintauchen, Esc (und Esc, das schon benutzt wurde), Kreuz, Sprachbefehl, Fokus zurück an den Knopf, keine Fokusfalle, nichts füllt den Bildschirm, Chat-Fenster und Handy, Einwilligung als kleine Karte, Zustände, Mikrofon aus und an, Untertitel in der Sprechblase, Chat im Hintergrund, Navigation mit "ja" (dieselbe Figur bleibt stehen), Quiz-Modus, reduzierte Bewegung, Namen und Rollen, Hinweise.
- `tests/unit/components/hai/HaiCharacter.test.tsx`: Teile der Figur (Kopf, Augen, Flosse, Arme mit Händen, Körper, Beine, Füße, Wasser), Haltung je Zustand als Datenattribute, Warnfarbe, Aufstieg und Eintauchen, Mund folgt dem Pegel, reduzierte Bewegung, und das Aussehen des Originals (genau die acht Farben des GIF, keine Farbe der ersten Figur, weiße Front, graue Rückenfarbe, Blockaugen, dunkelroter Mund mit zwei Zähnen, Kopf und Körper als eine Kuppel).
- `tests/unit/components/hai/HaiPanel.test.tsx`: Symbol unten rechts (Klassen), Tour-Ziel (Tooltip nach links), Panel öffnen und schließen per Symbol, Schließen-Knopf und Esc, Fokus ins Eingabefeld und zurück zum Symbol, Lage rechts und Breite, kein Abdunkeln, kein Dialog, kein Fokusfang, kein Versatz für die Navigation, das Becken ist das Symbol.
- `tests/unit/components/hai/mouth.test.ts`, `tests/unit/components/hai/useMouthShape.test.tsx`: die Mundformen aus Pegel und Rhythmus, der Haken mit gefälschtem `AnalyserNode` und von Hand geführtem Takt, kein React-Rendern je Bild.
- `tests/unit/hai/outputLevel.test.ts`: der Abgriff (ein `AnalyserNode` je Kontext, Quelle geht weiter an den Ausgang, ohne Analyser unverändert) und das Lesen des Pegels.
- Gestaltung: Bildschirmfotos (`hai-figur2-*.png`) mit dem Original-Knopf neben der Figur, den sechs Zuständen, dem Becken mit Sprechblase, dem Panel mit Symbol und dem Handy lagen der Übergabe bei (aus einer Vorschau außerhalb des Repositorys).

## 10. Grenzen und nächste Stufe

- **Nicht mit echtem Gerät geprüft:** echtes Mikrofon, echter Ton, ob der Mund bei Soniox und Sokrates zur Stimme passt (der Abgriff ist gegen einen gefälschten Analyser getestet, nicht gegen echten Ton), Safari und iOS (Audio freischalten im Tipp), das Verhalten bei eingeblendeter Bildschirmtastatur auf dem Handy. Die Fälle stehen im Testplan, Gruppe J.
- **Browser-Stimme:** Der Mund folgt hier einem Rhythmusmuster, nicht den Silben der Stimme, weil `speechSynthesis` keinen Pegel liefert. Er ist deshalb nicht lippensynchron, er bewegt sich nur, solange gesprochen wird.
- **Die Figur liegt über der Seite** unten rechts und kann dort Inhalt verdecken. Die Navigation liegt links, deshalb gibt es keinen Versatz dafür. Bei offenem Panel und ausgeklappter Navigation kann die Sprechblase auf schmalen Desktops (um 1024 Pixel) in den Bereich der Navigation ragen, sie liegt dann über ihr. Die Leiste ist klein, die Figur lässt Klicks durch, das Kreuz beendet sie.
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

## 13. Aussehen im Originaldesign, das Becken ist das Symbol (03.11.2026)

Auftrag von Niko: Das Maskottchen kommt unten rechts heraus, dort, wo das HAI-Symbol ist (so seit der Korrektur vom 03.11.2026, PR 285 hatte es nach links gelegt), und hat dasselbe Design wie der ursprüngliche HAI im Fischbecken.

**Wo das Symbol liegt.** Der Knopf (`HaiButton`, `data-tour="hai-button"`) lag unten rechts (`fixed bottom-6 right-6`), das Chatfenster ebenfalls rechts. PR 285 hatte alles nach links gelegt, das war ein Missverständnis, jetzt sitzt wieder alles um die HAI unten rechts: Symbol, Figur und Chatpanel. Die Plattform-Tour zeigt weiter auf den Knopf (Selektor unverändert), das Tooltip öffnet sich nach links (`placement: 'left'`).

**Die Vorlage.** Der ursprüngliche HAI ist der Pixel-Hai im Knopf (`public/images/shark-new.gif`, 99 Bilder, genau acht Farben): ein runder, rundlicher Hai mit grauer Rückenfarbe und weißer Front, schwarzem Umriss, Augen als dunkle Striche, einem Strich als Mund und, wenn er den Mund öffnet, einem dunkelroten Mund mit zwei kleinen weißen Zähnen. Er taucht aus dunklem Wasser auf, mit dünnen Ringen und weißem Schaum an der Wasserlinie. Die Figur trägt dieselben Farben (Hex-Werte aus dem GIF gelesen, als Variablen `--hf-*` in `src/app/globals.css`):

| Farbe | Hex | Verwendung in der Figur |
|---|---|---|
| Wasser | `#242845` | das Becken (das Symbol), getönte Unterwasser-Kopie |
| Wasser tief | `#23273f` | Wasserfläche unter der Oberfläche |
| Schatten | `#363b4e` | Kiemen, Zehen, Rand der Wasserfläche |
| Wellen | `#636979` | Wellen und äußerer Ring des Wassers |
| Rücken | `#aabbc0` | Rücken, Flossen, Arme, Beine, Hände |
| Front | `#eaeeef` | Gesicht, Bauch, Zähne, Schaum, Tropfen |
| Umriss | `#000000` | Umriss, Augen, geschlossener Mund |
| Mund | `#56203e` | Innenseite des offenen Mundes |

Dazu kommt Bernstein (`#f59e0b`) als Warnfarbe für "Pause" und "Fehler", die nicht im GIF steht.

**Was bleibt, was neu ist.** Arme, Beine, Körper, der bewegliche Mund (vier Formen), die Flosse auf dem Kopf, die sechs Zustände (Haltung, Blick, Becken), die Sprechblase, die Bedienleiste, Barrierefreiheit und reduzierte Bewegung sind unverändert (Abschnitte 1 bis 7). Neu ist das Aussehen: Kopf und Körper sind eine rundliche Kuppel (erst beide Umrisse, dann beide Füllungen, ohne Naht), die Augen sind dunkle Blöcke, die beim Blinzeln zum Strich werden, Wangen, Nasenlöcher und Zunge entfallen, Brauen erscheinen nur bei großen Augen, Blick nach oben und Sorge, die Zähne sind zwei kleine Blöcke.

**Das Becken ist das Symbol.** Die Figur zeichnet kein eigenes Becken mehr (keine Glaswand, kein Rand), sondern nur das Wasser darin (dünne Ringe, Wellen, Ringe beim Hören und Sprechen, Schaum an den Beinen). Das Becken selbst ist der runde Knopf: Beim Start des Sprachmodus wächst er auf einmal (nur `transform: scale`, von der Ecke unten rechts aus, `origin-bottom-right`: Faktor 2 auf dem Handy, 2,8 ab sm, also 8 und 14 rem Durchmesser), Rand und Leuchten wachsen mit, der Pixel-Hai blendet aus, und die Figur steigt aus dem Wasser in seiner Mitte auf. Beim Beenden taucht sie ein, danach schrumpft der Knopf zurück (`usePondState`). Das Symbol bleibt der eine Knopf, der auch jetzt das Chatpanel öffnet und schließt.

**Chatpanel.** Der Text-Chat ist ein Seitenpanel von rechts, siehe `docs/hai-chat-panel.md`.

## 14. Nur die Stimme des Nutzers zählt, Signalwörter, Drücken zum Sprechen (04.11.2026)

Meldung von Niko: Die HAI hört im Gesprächsmodus alle Hintergrundgespräche zu, auch sehr leise, und nimmt sie in das Gespräch auf. Sie soll dem Nutzer zuhören und nicht den anderen im Raum. Außerdem braucht es Signalwörter, bei denen sie anhält. Die Messwerte und Quellen stehen in `docs/hai-sprachmodus-recherche.md` (Abschnitt 10), die Prüffälle im Testplan (Gruppe S).

### Ursache

Mit Soniox ist das Mikrofon im Live-Modus für das ganze Gespräch offen. Soniox schreibt auch Sprache mit, die 40 Dezibel leiser ist als eine normale Stimme, und meldet dafür eine hohe Sicherheit (gemessen: Konfidenz 0,99). Zusätzlich hob die automatische Pegelregelung des Browsers (`autoGainControl`) eine leise Stimme allein im Raum um etwa 16 Dezibel auf den Pegel der Person am Mikrofon an. Die Schleife kannte keine Lautstärke je Äußerung: Alles, was Soniox als Äußerung lieferte, ging an die HAI, und zwei erkannte Wörter reichten, um die HAI mitten im Satz zu unterbrechen. Im Laborversuch ohne das Pegel-Tor (Abschnitt 10 der Recherche, Stimme im Raum 20 Dezibel unter der Person, sonst derselbe Code) gingen vier Sätze der leisen Stimme an das Chatmodell, die HAI wurde viermal von ihr unterbrochen, und ein "Stopp" aus dem Hintergrund hielt sie an.

### Schutz in Stufen

| Stufe | Was | Ort | Stand |
|---|---|---|---|
| 1 | **Pegel-Tor je Äußerung**, adaptiv | `src/lib/hai/voice/levelGate.ts` | gebaut, im Labor belegt |
| 2 | **Mikrofonprofil `live`**: Pegelregelung aus, Echo-Unterdrückung an, Rauschunterdrückung weiter aus | `src/lib/hai/voice/client/deps.ts` | gebaut, gemessen |
| 3 | **Konfidenz** der Erkennung (mittlere Sicherheit der Wörter einer Äußerung) | `levelGate.ts`, `soniox.ts` | gebaut, trennt aber nur Genuschel, nicht nah von fern |
| 4 | **Sprechertrennung** (`enable_speaker_diarization`) | | **nicht gebaut**, Begründung unten |
| 5 | **Sichtbarkeit**: Messpunkte mit Grund, dezente Anzeige ohne fremden Text | `useHaiVoice.ts`, `trace.ts`, Overlay | gebaut |
| 6 | **Einstellungen**: Empfindlichkeit, Drücken zum Sprechen, Signalwörter | Panel, `filterSettings.ts` | gebaut |

**Pegel-Tor.** Die Erkennung meldet den Pegel der Aufnahme zehnmal je Sekunde (Effektivwert mal fünf, 0 bis 1, `onlevel`). Das Tor behält die letzte halbe Minute. Zu jeder fertigen Äußerung liefert Soniox den Zeitraum der Wörter (`start_ms`, `end_ms`, umgerechnet auf die Uhrzeit des Browsers, 150 Millisekunden Spielraum an beiden Seiten) und die Konfidenz. Das Tor prüft zwei Dinge: Der **Mittelwert** des Zeitraums muss die Schwelle erreichen und der **Spitzenwert** muss mindestens das 1,5fache der Schwelle sein (ein kurzer Ausschlag, etwa ein Lachen im Hintergrund, ist keine Stimme). Die Schwelle ist adaptiv:

- **Raumpegel**: das 20. Perzentil der letzten halben Minute (die Pausen zwischen den Wörtern machen den größten Teil der Zeit aus). Unbekannt (0) unter 20 Messungen.
- **Referenzpegel der Person**: der obere Median (60 Prozent der sortierten Werte) der Mittelwerte der letzten sieben **angenommenen** Äußerungen. Nur was durch das Tor kam und zwei oder mehr Wörter hatte, zählt. Ein einzelner Schrei verschiebt ihn nicht.
- **Schwelle** = Raumpegel plus Anteil mal (Referenz minus Raumpegel), mindestens das Dreifache (streng: Vierfache) des Raumpegels, begrenzt auf Untergrenze und Obergrenze. Vor der ersten angenommenen Äußerung gibt es keine Referenz, dann gilt nur die Untergrenze (mit dem Raumpegel).

| Einstellung | Untergrenze | Obergrenze | Anteil | Konfidenz mindestens |
|---|---|---|---|---|
| Normal (Standard) | 0,04 (Effektivwert 0,008, etwa minus 42 dBFS) | 0,20 | 20 Prozent | 0,60 |
| Streng, nur meine Stimme | 0,08 | 0,30 | 45 Prozent | 0,75 |

Die Obergrenze verhindert, dass eine laute erste Äußerung die Person aussperrt. Die Untergrenze hält den Raum auch dann draußen, wenn noch nichts gehört wurde. Pegel in der Einheit des Messpunkts: 0,33 ist eine Stimme am Laptop-Mikrofon (Effektivwert 0,066), 0,045 eine Stimme 17 Dezibel darunter.

**Vorläufiger Text** (Unterbrechen, Signalwort, Anzeige des Textes während des Sprechens): Es gibt noch keinen fertigen Zeitraum. Dann müssen der Mittelwert der letzten 1,2 Sekunden die Schwelle und der Spitzenwert das 2,5fache der Schwelle erreichen (`interimPeakFactor`). Der Wert kommt aus dem Labor: Mit 1,5 und nur dem Spitzenwert unterbrach eine Stimme 14 Dezibel unter der Person noch die HAI, weil der Spitzenwert einer Silbe über die Schwelle kam. Ein vorläufiger Text, der das Tor nicht besteht, wird nicht angezeigt und zählt nicht als Sprechen (kein Zurücksetzen der stillen Zeit).

**Ohne Messung kein Urteil.** Liefert ein Anbieter keinen Pegel oder keinen Zeitraum (Sokrates, Browser), prüft das Tor nicht: die Äußerung zählt, wie bisher. Bei Soniox ohne Zeitangaben in den Wörtern gilt der Zeitraum, in dem die Wörter ankamen.

**Konfidenz.** Soniox liefert je Wort `confidence` (0,0 bis 1,0). Die mittlere Konfidenz einer Äußerung unter 0,60 (streng 0,75) verwirft sie. Das fängt Genuschel und Rauschen, das als Wörter herauskam (gemessen: einzelne Wörter bis 0,5, Mittel einer klaren Äußerung 0,98 bis 1,0). Es trennt **nicht** nah von fern, eine Stimme 40 Dezibel leiser hat 0,999. Die Schwellen sind aus synthetischer Sprache begründet, Werte aus echten Räumen stehen aus.

**Mikrofonprofil.** `autoGainControl: false` im Profil `live`. Die Runden (Live-Modus aus) behalten die Regelung (das Mikrofon ist beim Sprechen der HAI aus, niemand sonst wird gehört, leise Sprecher profitieren). Die Rauschunterdrückung bleibt aus: Gemessen senkt sie nur gleichmäßiges Rauschen (Rauschboden von 0,00065 auf 0,00009), eine leise **Stimme** im Raum lässt sie unverändert (0,0093 gegen 0,0099), und sie verbessert die Erkennung nicht. Die Echo-Unterdrückung bleibt an.

**Sprechertrennung, nicht gebaut.** Soniox kann sie in Echtzeit (`enable_speaker_diarization`, Feld `speaker` je Wort, bis 15 Sprecher). Die Dokumentation sagt aber, dass sie in Echtzeit mehr Fehler macht als im Nachhinein, dass Sprecherwechsel vorübergehend falsch sein können und dass die Endpunkterkennung die Genauigkeit senkt ("für die höchste Genauigkeit keine Endpunkterkennung"). Wir brauchen die Endpunkterkennung für die Antwortzeit. Die Messung (synthetische Stimmen, mit Endpunkterkennung) bestätigt die Schwäche für unseren Fall: Dieselbe leise Stimme bekam in zwei Äußerungen zwei verschiedene Sprecher (1 und 2). Spricht zuerst jemand im Hintergrund, wird der "erste bestätigte Sprecher" der Hintergrund und die Person wird als Fremde verworfen. Beides sperrt den Nutzer aus, ein Fehler, der schlimmer ist als ein durchgelassenes Hintergrundgespräch. Der Pegel trennt nah und fern verlässlicher. Neu bewerten, wenn Soniox Sprechertrennung mit Endpunkterkennung belegt stabil anbietet.

**Anzeige und Messpunkte.** Eine verworfene Äußerung erscheint als Messpunkt `utterance.discarded` mit `why` (`quiet` oder `confidence`) und nur Zahlen (`mean`, `peak`, `thr`, `conf`). Der Text wird nicht gespeichert, nicht gesendet, nicht angezeigt. In der Oberfläche steht kurz "Ich habe nur dich gehört." (sechs Sekunden). Nach drei zu leisen Äußerungen in Folge steht "Ich höre dich nicht deutlich. Sprich lauter oder näher am Mikrofon.", damit die Person den Grund kennt. Eine angenommene Äußerung löscht den Hinweis.

### Signalwörter

Alle Wörter stehen an einer Stelle, `src/lib/hai/voice/signalWords.ts` (Deutsch zuerst, Englisch vorbereitet, je Sprache `halt`, `end`, `micOff`, Füllwörter). Verglichen wird gefaltet: Groß und Klein, Umlaute (ä gleich ae, ö gleich oe, ü gleich ue, ß gleich ss), Akzente und Satzzeichen zählen nicht.

| Art | Wörter (Deutsch) | Wo | Wirkung |
|---|---|---|---|
| Anhalten | Stopp, Stop, Halt, Warte, Moment, Ruhe, Hör auf, Abbrechen, Pause | **Anfang** der Äußerung (erste ein bis drei Wörter), schon aus dem vorläufigen Text | Die Stimme bricht sofort ab, der laufende Chat-Abruf wird abgebrochen, der Sprachmodus bleibt offen und hört weiter zu. Ein reines Anhaltwort geht nicht als Frage an die HAI. Folgt eine Frage ("Moment mal, was ist ein Index?"), hält die HAI an und die ganze Äußerung ist die nächste Frage |
| Beenden | Gespräch beenden, Sprachmodus beenden, Beenden, Tschüss, Auf Wiedersehen, Das war es | **ganze** kurze Äußerung, am Ende der Äußerung | Der Sprachmodus endet wie mit dem Knopf Schließen. "Beenden wir das Kapitel?" ist eine Frage |
| Mikrofon aus | Mikrofon aus, Mikrofon ausschalten | ganze kurze Äußerung | Hört nicht mehr zu, bis der Knopf gedrückt wird (wie der Knopf "Mikrofon ausschalten") |

Ein Signalwort mitten im Satz löst nichts aus ("das war nicht der Stopp", "wir halten das fest"), und nur ganze Wörter oder die kurzen Wendungen der Liste ("Halte durch" ist kein "Halt"). Ein Signalwort **umgeht** die Regel "mindestens zwei Wörter oder genug Lautstärke" des Unterbrechens, **nicht aber** das Pegel-Tor und den Echo-Filter: ein Hintergrundgespräch, in dem "stopp" fällt, hält die HAI nicht an, und die eigene Stimme der HAI ("Einen Moment.") ist kein Signal. "Stopp" beendet das Gespräch nicht mehr (vorher tat es das). Der Schalter "Signalwörter" im Panel (Standard an) schaltet alle Wörter ab, dann geht jede Äußerung als Frage an die HAI. Beim ersten Mal auf einem Gerät steht, wenn die HAI das erste Mal spricht und das Mikrofon offen ist, sieben Sekunden lang "Sag Stopp, wenn ich aufhören soll."

**Anbieter.** Das Anhalten aus dem vorläufigen Text und das Unterbrechen geht nur mit Soniox im Live-Modus: Nur dort ist das Mikrofon offen, während die HAI spricht, und nur dort kommen vorläufige Texte. Sokrates und der Browser arbeiten in Runden mit geschlossenem Mikrofon beim Sprechen: Signalwörter gelten dort für die fertige Äußerung (Beenden, Mikrofon aus, ein reines "Stopp" wird nicht als Frage gesendet), halten die HAI aber nicht an, während sie spricht. Das Pegel-Tor und die Konfidenz gibt es dort nicht, der Schutz ist "Drücken zum Sprechen".

### Einstellungen (im Panel unter "Einstellungen zum Sprachassistenten", localStorage dieses Geräts)

| Einstellung | Standard | Schlüssel | Wirkung |
|---|---|---|---|
| Empfindlichkeit für Hintergrundstimmen: Normal oder "Streng, nur meine Stimme (laute und nahe Stimme)" | Normal | `hai-voice-sensitivity` | Schwellen der Tabelle oben. Streng schützt stärker und kann leises Sprechen aussortieren |
| Drücken zum Sprechen | aus | `hai-voice-ptt` | Das Mikrofon nimmt nur auf, solange der Halteknopf oder die Leertaste gehalten wird. Nichts davor, nichts danach: 100 Prozent Schutz vor dem Hintergrund |
| Signalwörter | an | `hai-voice-signals` | siehe oben |

Der Hinweis, dass ein **Headset oder ein Mikrofon nahe am Mund** am besten schützt, steht in den Einstellungen und in den Hinweisen des Sprachmodus.

**Drücken zum Sprechen.** Der Halteknopf (Mikrofon-Symbol in der Leiste, `data-testid="hai-voice-ptt"`) nimmt Maus, Touch und Stift (Zeigerereignisse mit Festhalten des Zeigers, kein Kontextmenü bei langem Druck). Die Leertaste gilt auf der ganzen Seite, solange der Sprachmodus offen ist, mit Ausnahmen: nicht in Textfeldern, nicht auf Elementen, die die Leertaste selbst brauchen (Knopf, Link, Schalter, Auswahl), nicht mit Strg, Alt oder Meta, nur der erste Tastendruck (kein Wiederholen). Beim Verlieren des Fensterfokus oder beim Verbergen der Seite wird losgelassen. Drücken, während die HAI spricht oder nachdenkt, hält sie an (wie Unterbrechen), dann nimmt das Mikrofon auf. Beim Loslassen schließt das Mikrofon sofort und der Text geht als Frage an die HAI (Äußerungen während des Haltens, auch nach Pausen, werden zusammen gesendet). Im Halten gibt es kein Pegel-Tor und keine Konfidenzprüfung: Die Person hat entschieden. Das Mikrofon öffnet erst beim Drücken, die Aufnahme zwischen dem Drücken und dem Aufbau der Verbindung zu Soniox wird zwischengespeichert, geht also nicht verloren. Die Einwilligung "offenes Mikrofon" entfällt bei Drücken zum Sprechen, weil das Mikrofon nur beim Halten offen ist. Im Panel (Sprachmodus zu) hat das Mikrofon der Chat-Leiste denselben Halteknopf.

### Grenzen

- **Der Pegel trennt nah von fern, nicht Person von Person.** Eine zweite Person, die genauso laut am Mikrofon ankommt (nahe, laute Stimme, ein Meter), zählt. Im Laborversuch (Abschnitt 10 der Recherche) wurden Stimmen bis etwa 14 Dezibel unter der Person in "Normal" aussortiert, in "Streng" auch Stimmen 10 Dezibel darunter. Stimmen 10 und 6 Dezibel unter der Person kamen in "Normal" teilweise durch. Ein Headset ändert das Verhältnis zugunsten der Person stark, "Drücken zum Sprechen" löst es.
- **Kaltstart.** Vor der ersten angenommenen Äußerung gilt nur die Untergrenze. Spricht zuerst jemand im Hintergrund, der lauter ist als die Untergrenze, kann diese Äußerung zählen und die Referenz verfälschen (der obere Median holt sich mit der Stimme der Person schnell zurück). Im Laborversuch lag eine Stimme 20 Dezibel unter der Person unter der Untergrenze und wurde auch im Kaltstart aussortiert.
- **Zu leise Person.** Mikrofone mit sehr niedrigem Pegel (Effektivwert unter 0,008 bei normalem Sprechen) liegen unter der Untergrenze. Dann steht nach drei Äußerungen der Hinweis "Sprich lauter oder näher am Mikrofon", "Drücken zum Sprechen" ist der Ausweg. Mikrofon, Raum und Abstand sind nur am echten Gerät prüfbar (Testplan S).
- **Eine Unterbrechung, die erst am Ende aussortiert wird.** Hat der vorläufige Text das Tor bestanden und die fertige Äußerung nicht, ist die HAI schon angehalten. Sie spricht nicht weiter, die Person kann neu fragen.
- **Vorzeitiges Anhalten.** Das Signalwort wird am Anfang des vorläufigen Textes erkannt, bevor das Wort fertig ist: ein Wort wie "Haltung" oder "Pausenzeit" kann vorübergehend als "Halt" und "Pause" gelesen werden und die HAI anhalten.
- **Zeitbezug.** Der Zeitraum der Wörter und der Pegel sind auf die Uhr des Browsers umgerechnet (Start der Aufnahme plus `start_ms`). Eine Abweichung bis 150 Millisekunden fängt der Spielraum auf. Passt der Zeitraum nicht zur Uhr (Zeit in der Zukunft, Strom neu gestartet), gilt die Ankunftszeit der Wörter.
- **Sprachausgabe der HAI im Mikrofon.** Das Echo der HAI wird vom Browser (Echo-Unterdrückung) und vom Wortfilter gedämpft. Wie gut das an einem echten Gerät mit Lautsprechern klappt, ist offen (Testplan E31 und S).
