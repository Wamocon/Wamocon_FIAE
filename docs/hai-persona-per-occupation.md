# HAI persona per occupation

Package H3 of the HAI plan. HAI no longer speaks only as the FIAE assistant: texts,
topics and the off-topic filter come from the occupation (training catalog) of the
person.

## How it works

- `src/lib/hai/persona.ts` (pure) builds the persona with `resolveHaiPersona`
  from the catalogs of the user, the role and the training phase.
  `src/lib/hai/personaAccess.ts` loads the catalogs. Everything is derived on the
  server (`resolveRetrievalAccess`, the database, the profile), never from client text.
- `prompts.ts` and the classifier in `ragPipeline.ts` read the persona. Both pipelines
  (`processMessage`, `processMessageStream`) use the same functions
  (`resolveTurnPersona`, `personaRefusal`, `classifyIntent`).
- **FIAE** keeps today's texts byte for byte. `settings.hai` is ignored for FIAE (like the
  branding). Proof: `tests/unit/hai/persona.fiae-baseline.test.ts` against
  `tests/unit/hai/fixtures/fiae-baseline.json`, recorded with the code before this package
  (full text of the plain prompt of every mode, SHA-256 of 75 prompt combinations, the
  intent of 133 messages in 3 quiz states).
- **Other occupations** take their texts from `training_catalogs.settings.hai`. A missing
  key falls back to a generic text without IT words and without fixed numbers. The
  trainee prompt carries no trainer topics.
- **Without a catalog scope** (no profile, no catalog, database error) the persona is neutral:
  no knowledge context, no live data, no model call, only a refusal.
- **Questions about another occupation** (code, title, short name or the names in the
  settings of a catalog the user may not use) get a neutral refusal. Nothing of the other
  occupation is named. A person with several occupations may ask about all of them.
- **Off-topic filter**: the block list stays the base. Per occupation, `offtopic_exceptions`
  are words that keep a message out of the filter (procurement, travel costs, hospitality).
  Without code help (`code_help` false) code words no longer count as code help.
- **scenarioText**: the chat route no longer copies it from the request into the system
  prompt. The database holds no scenario text yet (the enabler has a description and a PDF
  link only), so the context stays empty until a server source exists. The prompt builder
  additionally strips heading markers and control characters from any scenario text.
- **Enabler and course ids** of the request only count if they belong to a catalog of the
  person; otherwise ids and titles are dropped.

## Schema of `settings.hai`

All keys are optional, the object is strict (unknown keys are rejected). Texts are one line
of plain text from a small alphabet (letters with umlauts, digits, space and `. , ; : ! ? ( ) / & + ' % - _ EUR`),
trimmed. No line break, `#`, `*`, backtick, `<`, `>`, brackets, braces, pipe, backslash,
double quote, control or bidi character. Only `greeting` and `refusal_text` may contain the
shark emoji.

| Key | Type and limits |
| --- | --- |
| `occupation_name` | text, 3 to 80 |
| `field_name` | text, 3 to 60 (default `occupation_name`) |
| `glossary` | up to 12 entries `{ term (2 to 40), definition (3 to 200) }` |
| `allowed_topics` | up to 15 texts, 3 to 80 each |
| `learning_field_label` | 1 to 4 letters, for example `LF` |
| `learning_field_max` | integer 1 to 20 (FIAE 12, KfBM 13) |
| `exam_name` | text, 3 to 60 |
| `exam_parts` | two texts (part one, part two), chosen by the training phase of the trainee |
| `source_rule` | text, 3 to 300 |
| `code_help` | boolean (default false) |
| `offtopic_exceptions` | up to 60 lower case words, 3 to 30 characters |
| `greeting` | text, 3 to 300, one line |
| `refusal_text` | text, 3 to 400 |

The schema lives in `src/lib/catalog/hai-settings.ts` and is part of `catalogSettingsSchema`.
Because the values end up in the system prompt, only a SUPER_ADMIN may write them. The
editing in the UI is not part of this package. An instruction in plain words stays possible,
so the values are to be reviewed before they are set.

## KfBM draft (example value, not a default in the code)

The subject department has to approve the texts. The draft is also the fixture of the tests
(`tests/unit/hai/fixtures/kfbmPersona.ts`).

```json
{
  "occupation_name": "Kaufleute für Büromanagement",
  "field_name": "Büromanagement",
  "glossary": [
    {
      "term": "Büroorganisation",
      "definition": "Planung und Gestaltung von Arbeitsabläufen, Terminen und Ablage im Büro"
    },
    {
      "term": "Beschaffung",
      "definition": "Einkauf von Waren und Dienstleistungen, vom Bedarf über Angebot und Bestellung bis zur Rechnung"
    },
    {
      "term": "Rechnungswesen",
      "definition": "Buchführung, Belege, Kosten und Leistungsrechnung"
    },
    {
      "term": "Reisekosten",
      "definition": "Abrechnung von Dienstreisen mit Fahrtkosten, Übernachtung und Verpflegung"
    },
    {
      "term": "Bewirtung",
      "definition": "Betreuung von Gästen und Geschäftspartnern einschließlich Kosten und Belegen"
    }
  ],
  "allowed_topics": [
    "Büroorganisation und Arbeitsabläufe",
    "Beschaffung und Bestellwesen",
    "Rechnungswesen und Buchführung",
    "Kaufmännisches Rechnen",
    "Kommunikation und Korrespondenz",
    "Reisekosten und Dienstreisen",
    "Bewirtung und Veranstaltungen",
    "Datenschutz und Datensicherheit"
  ],
  "learning_field_label": "LF",
  "learning_field_max": 13,
  "exam_name": "Abschlussprüfung",
  "exam_parts": [
    "Abschlussprüfung Teil 1",
    "Abschlussprüfung Teil 2"
  ],
  "source_rule": "Stütze fachliche Aussagen auf den Rahmenlehrplan der KMK und den Ausbildungsrahmenplan für Kaufleute für Büromanagement und nenne die Quelle.",
  "code_help": false,
  "offtopic_exceptions": [
    "büro",
    "beschaffung",
    "reisekosten",
    "bewirtung",
    "dienstreise",
    "rechnung",
    "bestell",
    "angebot",
    "lieferant",
    "buchführung",
    "kalkulation",
    "prozent",
    "skonto",
    "dienstleist"
  ],
  "greeting": "Ahoi! 🦈 Ich bin HAI.ai, dein Lernbegleiter für Büromanagement. Wie kann ich dir helfen?",
  "refusal_text": "Das liegt leider außerhalb meines Fachgebiets. 🦈 Ich bin spezialisiert auf deine Ausbildung zum Kaufmann oder zur Kauffrau für Büromanagement, also Lernfelder, Büroorganisation, Beschaffung, Rechnungswesen, Kommunikation und Prüfungsvorbereitung. Wie kann ich dir dabei helfen?"
}
```

### Setting it (not executed by this package, no migration)

`settings` is a jsonb column, so no migration is needed. A SUPER_ADMIN (or the release
owner, after the subject review) sets the value, for example per SQL on the target
database:

```sql
update training_catalogs
set settings = settings || jsonb_build_object('hai', '<JSON of the draft above>'::jsonb)
where code = 'KFBM';
```

The route `PATCH` for catalog settings, if it exists by then, validates with
`validateCatalogSettings`. A bad key is ignored at read time (`resolveHaiSettings` checks
every key on its own), so a wrong value falls back to the generic text and breaks nothing.
To roll back: `update training_catalogs set settings = settings - 'hai' where code = 'KFBM';`

## Limits

- A person with several occupations gets the texts of the first (primary) catalog and the
  exception words of all of them.
- The classifier works on words. A question about another occupation without naming it
  cannot be recognized; the index search is filtered by occupation anyway (PR 118).
