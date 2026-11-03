# HAI Chat als Seitenpanel rechts

Stand: 03.11.2026. Der Text-Chat der HAI ist kein schwebendes Fenster mehr, sondern ein Panel, das sich von rechts ins Bild schiebt, wenn man auf das HAI-Symbol klickt, und wieder zurückschiebt, wenn man erneut klickt, auf Schließen klickt oder Esc drückt. Inhalt und Funktionen des Chats sind unverändert (Verlauf, Sitzungsliste im Vollbild, Quiz-Modus-Knopf, Mikrofon, Sprachmodus-Knopf, Navigationskarten, Quizkarten, Stopp). Nur das Gefäß wechselt.

Korrektur vom 03.11.2026: PR 285 hatte alles nach unten links gelegt, das war ein Missverständnis. Symbol, Panel und Figur liegen wieder unten rechts, dort, wo das HAI-Symbol schon vor PR 285 war. Die Idee des Seitenpanels, das sich beim Klick auf das Symbol herausschiebt, bleibt, nur die Seite ist rechts.

## 1. Wo alles liegt

Alles rund um die HAI sitzt unten rechts. Vor PR 285 lag der Knopf unten rechts (`fixed bottom-6 right-6`) und das Chatfenster als schwebendes Fenster darüber (`fixed right-6 bottom-24`), PR 285 hatte beides nach links gelegt, jetzt ist es wieder rechts, das Fenster ist aber ein Seitenpanel.

| Teil | Datei | Lage |
|---|---|---|
| HAI-Symbol (runder Knopf mit dem Pixel-Hai, `data-tour="hai-button"`) | `src/components/hai/HaiButton.tsx` | unten rechts, `bottom-4 right-4`, ab sm `bottom-6 right-6` |
| Chatpanel | `src/components/hai/HaiChat.tsx` (`ChatPanel`) | am rechten Rand, unter der Kopfzeile der Seite (`top-16`), bis unten |
| Figur des Sprachmodus | `src/components/hai/voice-mode/HaiVoiceModeOverlay.tsx` | steigt aus dem Symbol auf, gleicher Anker |

Die gemeinsame Lage steht in `src/components/hai/haiLayout.ts` (`useHaiAnchor`), damit Symbol und Figur immer an derselben Stelle liegen.

## 2. Das Panel

- **Größe:** auf dem Desktop (ab 768 Pixel) 420 Pixel breit, bis unten; auf dem Handy die volle Breite als Blatt unter der Kopfzeile, unten bleibt ein Streifen (`bottom-24`), in dem das Symbol sichtbar und tippbar bleibt.
- **Navigation:** Die Hauptnavigation (`Sidebar`) liegt links, das Panel rechts, die beiden begegnen sich nicht. Deshalb gibt es keinen Versatz mehr für die ausgeklappte Navigation (die Klassen `lg:left-72` und `lg:left-[19.5rem]` und `useOptionalSidebar` aus PR 285 sind entfernt), und die Navigation hat wieder Ebene z-40 (`MainLayout`, in PR 285 z-41). Die Kopfzeile der Seite (z-50) bleibt frei, das Panel beginnt darunter.
- **Overlay statt Verschieben:** Das Panel liegt über der Seite, die Seite rückt nicht nach links. Begründung: Eine verschobene Seite löst Layoutsprünge, Neuberechnung von Tabellen und Kalender, Scrollpositionen und das Umbrechen aller Inhalte aus, und die Navigation verändert ihre Breite selbst (Hover). Ein Overlay ist stabil. Was dahinter liegt, wird nicht abgedunkelt und bleibt bedienbar (kein Hintergrund, kein Weichzeichner, kein `aria-modal`).
- **Bewegung:** Nur `transform` (Gleiten von rechts, etwa 0,28 Sekunden, `framer-motion`). Mit `prefers-reduced-motion` ist die Dauer 0, das Panel erscheint und verschwindet ohne Bewegung; der Versatz des Symbols (`transition-transform`) ist dann ebenfalls aus (`motion-reduce:transition-none`).
- **Das Symbol ist der Griff:** Es bleibt immer sichtbar und klickbar. Bei offenem Panel rückt es ab 768 Pixel um die Panelbreite nach links (`md:-translate-x-[420px]`), sitzt also am linken Rand des Panels, und zeigt einen kleinen Pfeil (nach rechts, in die Richtung, in die das Panel zurückgeht) als Hinweis, dass ein Klick das Panel zurückschiebt. Auf dem Handy bleibt es im Streifen unter dem Blatt. Es hat `aria-expanded` und `aria-controls` (das Panel hat die Kennung `hai-chat-panel`).
- **Vergrößern:** Der Vollbild-Chat (`full`) bleibt als Knopf "Vergrößern" im Kopf des Panels, dort mit Sitzungsliste, wie bisher. Verkleinern bringt das Panel zurück.
- **Navigation durch die HAI:** Öffnet die HAI per Karte oder "Ja" eine andere Seite, bleibt das Panel offen (`goToOffer` setzt nur das Vollbild auf das Panel zurück).

## 3. Fokus und Tastatur

Das Panel ist nicht modal, deshalb gibt es keine Fokusfalle:

- Beim Öffnen springt der Fokus in das Eingabefeld.
- Beim Schließen (Symbol, Schließen-Knopf oder Esc) geht der Fokus zurück an das Symbol.
- Tab verlässt das Panel wie jede andere Stelle der Seite.
- Esc schließt das Panel nur, wenn der Fokus im Panel, am Symbol oder nirgends liegt (nicht, wenn ein Dialog der Seite oder ein anderes Feld den Fokus hat) und nicht, solange der Sprachmodus offen ist: Dann beendet Esc zuerst den Sprachmodus.
- Das Panel ist ein Landmark (`aside`, Name "HAI Chat"), kein Dialog.

## 4. Sprachmodus aus dem Panel

Der Knopf "Gespräch" im Kopf des Panels öffnet den Sprachmodus: Das Symbol wird zum Becken und die Figur steigt aus ihm auf (`docs/hai-sprachmodus.md`, Abschnitt 13). Auf dem Desktop bleibt das Panel offen, Becken und Figur stehen links davon (der Anker rückt um 420 Pixel nach links, das Becken wächst von der unteren rechten Ecke des Symbols aus nach links und oben, also nicht auf das Panel). Unter 1024 Pixel Breite bleibt neben dem Panel kein Platz für Becken und Sprechblase, dort schiebt sich das Panel beim Start des Sprachmodus zurück (auf dem Handy tut das schon die Sprachsitzung). Alles Gesagte steht danach im Chat.

## 5. Tour

Die Plattform-Tour (`src/lib/tour-steps.ts`, `TRAINEE_HAI_STEPS`, `TRAINER_HAI_STEPS`) zeigt weiter auf `[data-tour="hai-button"]`. Das Tooltip öffnet sich nach links (`placement: 'left'`), weil das Symbol rechts sitzt, wie vor PR 285. Das Tooltip beim Überfahren des Symbols öffnet sich ebenfalls nach links.

## 6. Prüfungen

`tests/unit/components/hai/HaiPanel.test.tsx` (19 Fälle): Symbol unten rechts, Tour-Ziel (Tooltip nach links), Öffnen und Schließen per Symbol, Lage rechts und Breite (Klassen), kein Abdunkeln, kein Dialog, Symbol klickbar und mit dem Panel verschoben, Fokus ins Eingabefeld, Fokus zurück, Esc, kein Fokusfang, kein Versatz für die Navigation, Esc beim offenen Sprachmodus, Becken ist das Symbol. Dazu `HaiVoiceMode.test.tsx` (Sprachmodus startet aus dem Panel) und `HaiButton.layer.test.tsx` (Ebene z-40 unter Viewern und Dialogen).

Noch nicht an einem echten Gerät geprüft: Gleiten auf dem Handy, Bildschirmtastatur unter dem Blatt, Verhalten bei sehr schmalen Tablets. Fälle im Testplan, Gruppe J (J33 bis J40).
