# HAI Chat: Anbieter und Ausfallverhalten (Paket CF1)

Stand 28.10.2026. Gilt für den Chat der HAI (Seite `/api/hai/chat`, Arbeitszeugnis-Assistent), nicht für die Einbettungen.

## 1. Kurzfassung

- **Primär** ist der Anbieter aus `HAI_CHAT_PROVIDER` (heute `gemini`, Modell `HAI_GEMINI_CHAT_MODEL`). Daran ändert dieses Paket nichts.
- **Fallback** ist ausschließlich Sokrates (OpenAI-kompatibler Anbieter, Open WebUI mit Ollama). Fällt der Primäranbieter aus, wird nur Sokrates gefragt, nie Gemini, Claude, OpenRouter oder Ollama.
- Den Fallback gibt es nur, wenn `OPENAI_COMPATIBLE_API_KEY` gesetzt ist **und** die Adresse (`OPENAI_COMPATIBLE_BASE_URL`, Standard `https://sokrates.test-qualitaetsmanagement.com/api`) https ist und auf der Positivliste der Sokrates-Hosts steht.
- **Ohne Fallback** meldet der Chat der Person einen klaren Fehler (`hai.error.chatUnavailable`). Es wird nichts still an einen anderen Anbieter gesendet.
- Es gibt keinen Wert, der den früheren Zustand "alle Anbieter mit Schlüssel" wiederherstellt.

## 2. Heutige Kette (vor und nach dem Paket)

| Schritt | Vorher | Nachher |
| --- | --- | --- |
| 1 | Primär aus `HAI_CHAT_PROVIDER` (Standard bei fehlender Variable: Sokrates) | unverändert |
| 2 | Sokrates, wenn Schlüssel gesetzt | Sokrates, wenn Schlüssel gesetzt und Adresse zulässig |
| 3 | Gemini, wenn `GEMINI_API_KEY` gesetzt | entfällt |
| 4 | Claude, wenn `ANTHROPIC_API_KEY` gesetzt | entfällt |
| 5 | OpenRouter, wenn `OPENROUTER_API_KEY` gesetzt | entfällt |
| Ende | Fehler "alle Anbieter fehlgeschlagen", die Pipeline zeigt "Ups, da ist etwas schiefgelaufen" und speichert den Text als Antwort | `ChatUnavailableError`, Meldung `hai.error.chatUnavailable`, nichts als Antwort gespeichert |

Auslöser des Fallbacks: jeder Fehler des Primäranbieters, bevor Text ausgegeben wurde (HTTP-Fehler, Zeitüberschreitung, Netzwerkfehler, Ausnahme des SDK). Beim Streaming gilt: Hat der Primäranbieter schon Text gesendet und bricht dann ab, gibt es **keinen** zweiten Versuch (eine zweite Antwort würde an die erste angehängt). Die Person sieht dann die Fehlermeldung statt des halben Textes.

## 3. Variablen

| Variable | Zweck | Standard |
| --- | --- | --- |
| `HAI_CHAT_PROVIDER` | Primäranbieter (`gemini`, `claude`, `openrouter`, `openai-compatible`) | `openai-compatible` (Sokrates), in Vercel `gemini` |
| `HAI_CHAT_FALLBACK` | `sokrates` oder `none`. Jeder andere Wert (auch `any`) wird zu `sokrates` verworfen | `sokrates` |
| `OPENAI_COMPATIBLE_API_KEY` | Schlüssel von Sokrates, Typ Sensitive. Ohne ihn gibt es keinen Fallback | nicht gesetzt |
| `OPENAI_COMPATIBLE_MODEL` | Modell bei Sokrates, Empfehlung `sokrates-fast` | `gpt-4o-mini` (existiert bei Sokrates nicht, deshalb setzen) |
| `OPENAI_COMPATIBLE_BASE_URL` | Adresse von Sokrates | Sokrates (nicht setzen) |
| `CONTENT_UPLOAD_KI_ALLOWED_HOSTS` | Positivliste der Sokrates-Hosts, gilt auch für den Fallback | nur der Host von Sokrates |

Der Schlüssel, das Modell und die Adresse sind dieselben wie beim KI-Upload (`docs/kfbm-upload-runbook.md`, Abschnitt 11). Wer das Modell ändert, ändert es für beide.

Für Sokrates gilt Reasoning aus: Jede Anfrage trägt `reasoning_effort: "none"`, weil die Denkmodelle sonst die ganze Tokengrenze verbrauchen und eine leere Antwort liefern (Runbook 11.7). Eine leere Antwort gilt als Fehler, nie als leere Nachricht. Die Felder `reasoning` und `reasoning_content` der Antwort werden nie gelesen.

## 4. Zeitlimits (Sokrates)

| Fall | Grenze |
| --- | --- |
| Antwort ohne Streaming | 60 Sekunden für den ganzen Aufruf |
| Streaming bis zum ersten Byte | 45 Sekunden (der erste Aufruf lädt das Modell, 8 bis 10 Sekunden) |
| Streaming, Pause zwischen zwei Teilen | 30 Sekunden |

Beim Streaming zählt nicht die Länge der Antwort, sondern die Pause. Der Primäranbieter Gemini hat im Code **kein** eigenes Zeitlimit (nur Wiederholungen bei 429 und 503 mit bis zu rund 10 Sekunden Wartezeit). Die Route `/api/hai/chat` setzt kein `maxDuration`. Ob die Zeit bis zum Fallback in die Funktionsdauer von Vercel passt, ist nicht geprüft.

## 5. Was ohne Schlüssel passiert

Ist `OPENAI_COMPATIBLE_API_KEY` nicht gesetzt (oder `HAI_CHAT_FALLBACK=none`, oder die Adresse unzulässig), und der Primäranbieter fällt aus:

- Der Chat zeigt: "HAI ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten noch einmal oder wende dich an deinen Trainer." (`hai.error.chatUnavailable` in `de.json` und `en.json`).
- Die Nachricht der Person bleibt gespeichert, eine Antwort der HAI wird nicht gespeichert.
- Der Arbeitszeugnis-Assistent meldet seinen bisherigen Fehler ("Fehler bei der KI-Generierung").
- Im Protokoll steht, welcher Anbieter mit welcher Fehlerart ausgefallen ist und dass es keinen weiteren Anbieter gab.
- Ist auch der Primäranbieter nicht bereit (Schlüssel fehlt), aber Sokrates ist bereit, antwortet Sokrates.

## 6. Datenschutz

- Bei einem Ausfall gehen Chat-Inhalte nur an Sokrates, den eigenen Dienst. Der Primäranbieter (Gemini) bekommt sie weiterhin, solange er der Primäranbieter ist.
- Das Protokoll enthält nie Inhalte: keine Nachricht, keinen Systemprompt, keine Antwort, keinen Fehlertext des Servers, keinen Schlüssel. Es nennt den Anbieter, die Fehlerart (zum Beispiel `http status=429`, `timeout`, `empty`) und den Zustand des Fallbacks (`sokrates`, `no_key`, `disabled`, `target_rejected`, `primary_is_sokrates`).
- Die Adresse des Fallbacks wird geprüft (https, kein Port, keine Zugangsdaten, Host auf der Positivliste). Eine falsch gesetzte Adresse schickt nichts an einen fremden Host, der Fallback ist dann aus.
- Weiterleitungen (Redirects) folgt der Sokrates-Aufruf nicht, damit der Inhalt nie an einen anderen Host geht.
- Ist Sokrates selbst der **Primäranbieter** (`HAI_CHAT_PROVIDER=openai-compatible`), wird die Adresse nicht gegen die Positivliste geprüft, sie liegt allein in der Hand des Eigentümers. Die Positivliste gilt für den Fallback und wird mit `CONTENT_UPLOAD_KI_ALLOWED_HOSTS` gemeinsam mit dem KI-Upload geführt.
- Die Websuche (nur Gemini) gibt es beim Fallback nicht, Sokrates beantwortet die Frage ohne Suche.
- Vor dem ersten Einsatz des Fallbacks mit echten Inhalten klären: Speichert oder protokolliert Open WebUI die Anfragen, und wie lange (Entscheidung O13 des KI-Uploads)? Beim Fallback liegen dann Chat-Inhalte dort.
- Die Schlüssel `OPENROUTER_API_KEY` und `ANTHROPIC_API_KEY` werden vom Chat nicht mehr als Fallback benutzt. Sie dürfen entfernt werden (Datensparsamkeit), solange kein Primäranbieter sie braucht. `GEMINI_API_KEY` bleibt (Primär und Einbettungen).

## 7. Prüfung in der Preview (nur mit Go von Niko)

1. Variablen setzen (siehe Liste im Pull Request), neues Deployment abwarten.
2. Fallback prüfen: In der Preview `GEMINI_API_KEY` bewusst ungültig setzen, eine Frage im Chat stellen. Erwartet: Antwort von Sokrates, im Protokoll "provider gemini failed, trying openai-compatible".
3. Ohne Fallback prüfen: `OPENAI_COMPATIBLE_API_KEY` entfernen, wieder fragen. Erwartet: die Meldung aus Abschnitt 5, im Protokoll "no further provider".
4. Leere Antworten? Dann reicht Open WebUI oder LiteLLM `reasoning_effort` nicht durch (Runbook 11.7).

## 8. Offene Entscheidung

Soll später auch der **Primäranbieter** Sokrates sein (`HAI_CHAT_PROVIDER=openai-compatible`)? Dann entfiele der Datenfluss an Gemini für den Chat vollständig (die Einbettungen bleiben bei Gemini, solange nicht neu indexiert wird). Vorher zu klären:

- Qualität der Antworten gegenüber Gemini (Golden Set, Paket H5).
- Antwortzeit und Last (erster Aufruf 8 bis 10 Sekunden, Modell auf einem einzelnen Server).
- Verfügbarkeit: Ohne zweiten Anbieter gäbe es bei einem Ausfall von Sokrates keine Antwort mehr (nur die Fehlermeldung).
- Test mit mehreren gleichzeitigen Personen vor der Demo.

Entscheidung steht bei Niko, bis dahin bleibt Gemini primär.
