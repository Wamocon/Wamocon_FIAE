# HAI Chat als angedocktes Seitenpanel rechts

Stand: 03.11.2026. Der Text-Chat der HAI ist kein schwebendes Fenster mehr, sondern ein Panel am rechten Rand, das ein Teil des App-Layouts ist: Beim Öffnen wird es zu einer Spalte, und der Rest der Oberfläche (Kopfzeile und Seiteninhalt) rückt nach links. Die Breite lässt sich ziehen. Das Panel öffnet sich mit einem Klick auf das HAI-Symbol, schließt sich mit einem zweiten Klick, mit dem Schließen-Knopf oder mit Esc. Inhalt und Funktionen des Chats sind unverändert (Verlauf, Sitzungsliste im Vollbild, Quiz-Modus-Knopf, Mikrofon, Sprachmodus-Knopf, Navigationskarten, Quizkarten, Stopp). Nur das Gefäß wechselt.

Entwicklung: PR 285 legte das Panel als Overlay nach links, PR 287 zurück nach rechts (weiter als Overlay, `fixed`). Auftrag von Niko vom 03.11.2026: "das Seitenpanel soll als Bestandteil der UI aufgehen, das heißt der Rest der UI verschiebt sich nach links und man kann das Seitenpanel breiter und schmaler ziehen". Das ersetzt die Overlay-Entscheidung aus PR 287 (dort war als Begründung Stabilität genannt, siehe Abschnitt 8).

## 1. Wo alles liegt

| Teil | Datei | Lage |
|---|---|---|
| Spalte im Layout (Platzhalter, 0 Pixel breit solange das Panel zu ist) | `src/components/hai/HaiDockColumn.tsx`, eingebaut in `src/components/layout/MainLayout.tsx` | letztes Kind der Layout-Zeile, rechts von Kopfzeile und Seite, volle Höhe |
| Chatpanel | `src/components/hai/HaiChat.tsx` (`ChatPanel`) | per Portal in der Spalte, am linken Rand der Spalte |
| Ziehgriff | `src/components/hai/HaiDockHandle.tsx` | am linken Rand des Panels |
| Zustand (Breite, angedockt ja oder nein, CSS-Variablen) | `src/components/hai/HaiDockContext.tsx` | Anbieter über den Seiten (in `HaiWrapper`) |
| Regeln und Speicherung (reine Funktionen) | `src/components/hai/haiDock.ts` | Grenzen, Schlüssel, Tastenschritte |
| HAI-Symbol (runder Knopf mit dem Pixel-Hai, `data-tour="hai-button"`) | `src/components/hai/HaiButton.tsx` | unten rechts im verbleibenden Inhalt, links neben dem Panel |
| Figur des Sprachmodus | `src/components/hai/voice-mode/HaiVoiceModeOverlay.tsx` | steigt aus dem Symbol auf, gleicher Anker |

Die gemeinsame Lage von Symbol und Figur steht in `src/components/hai/haiLayout.ts` (`useHaiAnchor`).

## 2. Angedockt: die Seite macht Platz

- **Spalte im Layout:** `MainLayout` ist eine Zeile aus Navigation, `main` (Kopfzeile und Seiteninhalt) und der Spalte des Panels. Die Spalte hat die Breite `var(--hai-dock-inset)`: so breit wie das Panel, solange es offen ist, sonst 0. `main` hat `min-w-0` und wird entsprechend schmaler, die Kopfzeile ebenfalls. Nichts liegt unter dem Panel. Die Spalte reicht über die volle Höhe des Layouts (neben der Kopfzeile, nicht darunter), die Kopfzeile des Panels ist 64 Pixel hoch wie die Kopfzeile der Seite, die beiden Linien treffen sich. Die Navigation links bleibt unverändert.
- **Seiteninhalt:** Der Seitencontainer hat `min-w-0` und scrollt bei Bedarf (`overflow-y-auto` setzt `overflow-x` auf `auto`), breite Tabellen und Diagramme bekommen ihre eigene Rollleiste oder brechen um. Die Seiten selbst wurden nicht angefasst.
- **Animation:** Öffnen und Schließen animieren die Spaltenbreite (`transition: width`, 0,28 Sekunden, Dauer aus der Variablen `--hai-dock-ms`). Das Panel hat dabei eine feste Breite (`--hai-panel-width`) und hängt am linken Rand der Spalte: es gleitet mit der Kante der Seite ein, sein Inhalt wird nicht neu umgebrochen. Beim Schließen bleibt das Panel (`AnimatePresence`) bis zum Ende der Animation stehen. Mit `prefers-reduced-motion` ist die Dauer 0: Spalte und Panel erscheinen und verschwinden ohne Bewegung.
- **Seitenwechsel:** Das Panel liegt im Layout, nicht in der Seite. Der Anbieter (`HaiDockProvider`) sitzt in `HaiWrapper` über allen Seiten, die Spalte in `MainLayout` bleibt beim Wechsel zwischen den Seiten eines Bereichs bestehen. Das Panel wird nicht neu eingehängt, der Verlauf (`HaiProvider`) und die Breite bleiben erhalten, auch wenn die HAI per Karte oder "Ja" eine andere Seite öffnet.
- **Ohne HAI** (Konto ohne PRO, gestopptes Konto): kein Anbieter, keine Spalte, keine Variablen, das Layout ist wie vorher.

### Wann angedockt, wann Blatt

| Fenster | Verhalten |
|---|---|
| unter 768 Pixel | Blatt über der Seite (`fixed`, volle Breite unter der Kopfzeile, unten bleibt ein Streifen für das Symbol), nichts wird verschoben, kein Ziehgriff |
| 768 bis 1023 Pixel | angedockt, Mindestbreite 288 Pixel, die Seite behält mindestens 480 Pixel |
| ab 1024 Pixel | angedockt, Mindestbreite 320 Pixel |
| wenn die Seite weniger als 480 Pixel behielte (zum Beispiel 1024 Pixel mit ausgeklappter Navigation) | Blatt über der Seite wie unter 768 Pixel, bis wieder Platz da ist |

Die Entscheidung folgt der Fenstergröße und dem Zustand der Navigation ständig (Größenänderung, Ein- und Ausklappen der Navigation). Die ausgeklappte Navigation (288 Pixel) zählt ab 1024 Pixel vom Platz der Seite ab. Das kurze Aufklappen der Navigation beim Überfahren des linken Rands (Hover) ist nicht eingerechnet, die Seite wird dann kurz schmaler als 480 Pixel und rollt.

## 3. Breite ziehen

- **Griff:** Am linken Rand des Panels sitzt eine Trennlinie (`role="separator"`, `aria-orientation="vertical"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-label` aus dem Übersetzungssystem: `hai.panel.resize`, `aria-controls` zeigt auf das Panel). Ein kleiner heller Griffstrich zeigt, dass man ziehen kann. Unter dem Zeiger, bei Fokus und beim Ziehen leuchtet die Linie auf. Cursor `col-resize`. Der Griff ist 12 Pixel breit (20 Pixel bei einem Finger, `pointer-coarse`) und hat `touch-action: none`.
- **Zeiger:** `pointerdown` fängt den Zeiger ein (`setPointerCapture`), `pointermove` ändert die Breite, `pointerup` beendet. Maus, Finger und Stift arbeiten gleich. Die rechte Maustaste startet nichts. Zieht man nach links, wird das Panel breiter.
- **Kein Neu-Rendern je Pixel:** Beim Ziehen schreibt `HaiDockContext` die Breite (höchstens einmal je Animationsbild, `requestAnimationFrame`) direkt als CSS-Variable auf die beteiligten Elemente (Layout-Element, Symbol, Figur). React rendert dabei nichts, auch nicht die Seite. Erst beim Loslassen geht die Breite in den React-Zustand und die Speicherung. Während des Ziehens ist die Dauer des Übergangs 0, die Seite folgt dem Zeiger ohne Verzögerung.
- **Schutzfläche und Auswahl:** Beim Ziehen liegt eine durchsichtige Fläche über dem ganzen Fenster (`z-[70]`, Cursor `col-resize`), damit ein iframe unter dem Zeiger (der PDF-Viewer des Ausbilders) die Zeigerereignisse nicht verschluckt und das Ziehen nicht hängt. Außerdem ist die Textauswahl aus (`user-select: none` am `body`) und der Cursor bleibt `col-resize`. Beides wird beim Loslassen, bei Abbruch (`pointercancel`) und wenn das Panel während des Ziehens verschwindet, zurückgegeben.
- **Doppelklick** setzt die Breite auf die Standardbreite zurück (420 Pixel).

## 4. Grenzen und Tastatur

| | |
|---|---|
| Standard | 420 Pixel |
| Mindestbreite | 320 Pixel (288 Pixel zwischen 768 und 1023 Pixel Fensterbreite) |
| Höchstbreite | 720 Pixel, aber höchstens 60 Prozent der Fensterbreite, und die Seite behält mindestens 480 Pixel |

Beispiele: 1280 Pixel Fenster: 320 bis 720. 1280 Pixel mit ausgeklappter Navigation: 320 bis 512. 1100 Pixel: 320 bis 620 (60 Prozent sind 660, die Seite behielte 620). 1000 Pixel: 320 bis 520. 900 Pixel: 288 bis 420.

Tastatur (der Griff ist per Tab erreichbar):

| Taste | Wirkung |
|---|---|
| Pfeil links | Panel 24 Pixel breiter (das Panel liegt rechts, der Griff wandert nach links) |
| Pfeil rechts | 24 Pixel schmaler |
| Umschalt + Pfeil | 96 Pixel statt 24 |
| Pos1 (Home) | Mindestbreite |
| Ende (End) | Höchstbreite |

Jede Taste speichert die Breite sofort. Tab und Esc gehen unverändert an die Seite.

## 5. Speicherung

- **Schlüssel:** `hai-panel-width` im `localStorage`, nur die Zahl (zum Beispiel `520`), keine Einheit, kein JSON.
- **Lesen:** Beim Start wird die Zahl gelesen. Alles, was keine ganze Zahl ist (leer, Text, `420px`, Dezimalzahl, JSON), ergibt die Standardbreite. Eine Zahl wird auf 320 bis 720 begrenzt.
- **Fenstergröße:** Die gewählte Breite bleibt als Wunsch gespeichert. Gezeigt wird sie auf die Grenzen des aktuellen Fensters begrenzt, bei jeder Größenänderung neu. Ein schmales Fenster ändert den gespeicherten Wunsch nicht: Wird das Fenster wieder größer, kommt die gewählte Breite zurück.
- **Schreiben:** Beim Loslassen, bei einer Taste und beim Doppelklick (die auf die Grenzen begrenzte Breite).
- **Fehlerfall:** `getItem` und `setItem` stehen in `try/catch` (privates Fenster, gesperrter oder voller Speicher). Ein Fehler beim Lesen ergibt die Standardbreite, ein Fehler beim Schreiben ändert nichts an der Anzeige, die Breite wird nur nicht gemerkt.

## 6. Das Symbol und die Figur

- **Symbol:** Der Knopf ist weiter Griff und Schalter (`aria-expanded`, `aria-controls="hai-chat-panel"`). Angedockt sitzt er unten rechts im verbleibenden Inhalt, links neben dem Panel (rechter Rand = Breite der Spalte + 1,5 rem, Variable `--hai-dock-inset`, mit demselben Übergang wie die Spalte, beim Ziehen ohne). Begründung der Lage: Im Panel unten rechts würde er das Eingabefeld, den Senden-Knopf und die Sprachsteuerung verdecken. Links neben dem Panel verdeckt er nicht mehr von der Seite als bei geschlossenem Panel (dort liegt er an der gleichen Ecke der Seite), und er ist immer klickbar. Er zeigt bei offenem Panel den kleinen Pfeil.
- **Blatt (nicht angedockt):** wie vor dem Umbau: ab md schiebt sich das Symbol um 420 Pixel nach links an den Rand des Blatts (`md:-translate-x-[420px]`), auf dem Handy bleibt es im Streifen unter dem Blatt.
- **Figur des Sprachmodus:** Sie steigt weiter aus dem Becken (dem Symbol) auf. Ihre Lage folgt dem Symbol und der Panelbreite (gleicher Anker, gleiche Variable): angedockt steht sie links neben dem Panel am unteren Rand des verbleibenden Inhalts, Sprechblase und Bedienleiste links neben ihr. Unter 1024 Pixel Fensterbreite zieht sich das Panel beim Start des Sprachmodus zurück wie bisher (`ChatPanel`, `matchMedia`). Siehe `docs/hai-sprachmodus.md`, Abschnitt 13.
- **Ebene:** Symbol und Figur liegen auf z-40, Dialoge und Viewer (z-50) darüber (WMCNL-2969).

## 7. Fokus und Tastatur des Panels

Das Panel ist nicht modal, es gibt keine Fokusfalle:

- Beim Öffnen springt der Fokus in das Eingabefeld.
- Beim Schließen (Symbol, Schließen-Knopf oder Esc) geht der Fokus zurück an das Symbol.
- Tab verlässt das Panel wie jede andere Stelle der Seite.
- Esc schließt das Panel nur, wenn der Fokus im Panel, am Symbol oder nirgends liegt (nicht, wenn ein Dialog der Seite oder ein anderes Feld den Fokus hat) und nicht, solange der Sprachmodus offen ist: Dann beendet Esc zuerst den Sprachmodus. Esc am Ziehgriff schließt das Panel (der Griff liegt im Panel).
- Das Panel ist ein Landmark (`aside`, Name "HAI Chat"), kein Dialog.
- **Vergrößern:** Der Vollbild-Chat (`full`) bleibt als Knopf "Vergrößern" im Kopf des Panels, dort mit Sitzungsliste, wie bisher. Im Vollbild ist die Spalte zu, die Seite hat ihren Platz zurück. Verkleinern bringt das Panel mit der gewählten Breite zurück.

Die Kopfzeile des Panels folgt der Breite (Container-Abfrage auf dem Panel): ab 28 rem (448 Pixel) steht das Etikett BETA, ab 24 rem (384 Pixel) tragen "Gespräch" und "Quiz-Modus" ihre Beschriftung, darunter bleiben die Symbole (die Knöpfe haben weiter `aria-label` und `title`). So bleiben Vergrößern und Schließen auch bei 320 Pixel erreichbar.

## 8. Warum jetzt angedockt (Änderung gegenüber PR 287)

PR 287 hatte das Overlay damit begründet, dass eine verschobene Seite Layoutsprünge, Neuberechnung von Tabellen und Kalender, Scrollpositionen und Umbrüche auslöst und die Navigation ihre Breite selbst ändert (Hover). Niko hat sich trotzdem für das angedockte Panel entschieden. Gegenmaßnahmen: Die Breite ändert sich nur per CSS-Variable (kein Neu-Rendern der Seite), beim Ziehen ohne Übergang, der Seiteninhalt hat `min-w-0`, das Panel selbst bricht beim Öffnen nicht um (feste Breite, hängt an der Kante der Spalte), schmale Fenster behalten das Blatt. Offen bleibt, dass der Seiteninhalt während der 0,28 Sekunden langen Animation umbricht, solange sich die Spalte ändert: Das lässt sich bei einer Spalte im Layout nicht ganz vermeiden.

## 9. Tour

Die Plattform-Tour (`src/lib/tour-steps.ts`, `TRAINEE_HAI_STEPS`, `TRAINER_HAI_STEPS`) zeigt weiter auf `[data-tour="hai-button"]`. Das Tooltip öffnet sich nach links (`placement: 'left'`), weil das Symbol rechts sitzt. Das Tooltip beim Überfahren des Symbols öffnet sich ebenfalls nach links.

## 10. Prüfungen

- `tests/unit/components/hai/haiDock.test.ts` (reine Regeln): Grenzen für Fenster und Navigation (768, 1024, 60 Prozent, 480 Pixel Inhalt, 720 Pixel), Speicherung mit Fehlerfällen, Tastenschritte.
- `tests/unit/components/hai/HaiDock.test.tsx` (Layout, Panel, Griff, Symbol, Figur): Spalte und Variablen beim Öffnen und Schließen, Panel in der Spalte, Seitenwechsel ohne Neu-Einhängen, Blatt unter 768 Pixel, bei zu wenig Platz und ohne Layout, Ziehen per Zeiger und Finger innerhalb der Grenzen ohne Neu-Rendern der Seite, Schutzfläche, Textauswahl, Abbruch, Tastatur, Doppelklick, Speichern, Lesen, Wiederherstellen, Neu-Begrenzen bei Größenänderung, `getItem` und `setItem` mit Fehler, reduzierte Bewegung, `aria`-Werte, Symbol und Figur folgen der Breite.
- Bestehend und weiter gültig (Blatt, Fokus, Esc, Symbol): `HaiPanel.test.tsx`, `HaiVoiceMode*.test.tsx`, `HaiButton.layer.test.tsx`. Bewusst geändert: `HaiWrapper.access.test.tsx` (die Attrappe des Anbieters liefert `useHai`, weil der Dock-Anbieter wissen muss, ob das Panel offen ist).

Noch nicht an einem echten Gerät geprüft: Ziehen mit dem Finger auf einem Tablet, Gleiten auf dem Handy, Bildschirmtastatur unter dem Blatt, Verhalten der echten Seiten (Dashboard, Ausbildungsnachweis, Quizze, Reviews) bei offenem Panel (geprüft wurde mit einer Vorschau aus den echten Layout- und Panelkomponenten mit Beispielinhalt, siehe Übergabe). Fälle im Testplan, Gruppe J (J33 bis J40 und J41 bis J48).
