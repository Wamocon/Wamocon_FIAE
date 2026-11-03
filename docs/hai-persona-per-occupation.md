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
  The baseline was recorded again on 29.10.2026 (boundary rules) and on 03.11.2026 (decision of the
  owner: role section, scope of the solution protection, no fixed refusal sentence in the prompt after
  the gate; the strict rules for trainees stay). The reasons are in the comment of the test and in
  `docs/hai-golden-set.md`, section 5.
- **Other occupations** take their texts from `training_catalogs.settings.hai`. A missing
  key falls back to a generic text without IT words and without fixed numbers. The
  trainee prompt carries no trainer topics.
- **Without a catalog scope** (no profile, no catalog, database error) the persona is neutral:
  no knowledge context, no live data, no model call, only a refusal.
- **The texts of the refusals** (no occupation, another occupation) are fixed texts with the reason in plain words and an alternative, see `docs/hai-ablehnungen.md` (`src/lib/hai/denial.ts`). `NEUTRAL_REFUSAL` and `FOREIGN_OCCUPATION_TEXT` in `persona.ts` are no longer sent by the pipeline.
- **Questions about another occupation** (code, title, short name or the names in the
  settings of a catalog the user may not use) get a neutral refusal. Nothing of the other
  occupation is named. Without a choice in the app (next point) a person with several
  occupations may ask about all of them.
- **The chosen occupation (the tab, rule since 02.11.2026).** The app sends the occupation the
  person works in as the header `x-catalog` (`PipelineContext.preferredCatalogCode`). If it is one
  of the occupations of the person (or of the scope of a trainer), the HAI works ONLY in that
  occupation, like the rest of the platform and like the quiz mode:
  - **search and page index**: `resolveRetrievalAccess(userId, code)` narrows `catalogIds` to that
    one catalog. It asks `getCatalogScopeForUserId` with the header, the same rule as the routes,
    so chat and quiz mode cannot drift apart. The full list of the person stays next to it
    (`allowedCatalogIds`), only the persona and the navigation read it.
  - **persona**: the single persona of that occupation. The merged persona (PR 257, one persona for
    all occupations) applies only WITHOUT a choice.
  - **titles of the open enabler or course** (`getContextTitles` in the chat route): an enabler of
    the other own occupation is dropped like one of a foreign occupation, and the model gets the
    hint UMFANG.
  - **A code that is none of the occupations of the person is ignored**: no 403, nothing lost,
    nothing gained. Role, occupation and scope come from the server only.
  - **A question about the OTHER occupation the person also has** (FIAE chosen, question about
    KfBM) is answered before search and model with a fixed text of the category AUSWAHL: "Du hast
    gerade FIAE ausgewählt, deshalb antworte ich hier nur dazu. Wechsle oben auf den Reiter KfBM,
    dann helfe ich dir auch dazu." Only the names of the two own occupations appear, as the tabs
    show them (`tabNameOf`: short name of the branding, else the code). The persona carries
    them as `unselectedOwn` (own markers, the same marker rules as for foreign occupations:
    start of a word, spellings, spelled-out letters) and `chosenLabel`. `personaRefusal` checks the
    foreign occupations first (BERUF, the user does not have it), then this list (AUSWAHL). For
    occupations the user does not have nothing changes.
  - **Without a header** everything stays as before: all occupations of the person, merged
    persona. The quiz mode takes the first occupation then (like every trainee route). That is no
    conflict: the app sends the header as soon as the occupations are loaded.
- **Daily briefing and live data stay across occupations.** `dataContext.ts` ("Was steht heute
  an", progress, calendar, reports, notifications) reads the data of the person over ALL of their
  occupations, with or without a choice: the day is not split by occupation. It is a decision of
  02.11.2026, not an omission. Only the knowledge search, the persona and the quiz follow the tab.
- **Navigation** (`src/lib/hai/navigation/*`) offers targets of ALL occupations of the person, the
  chosen occupation is looked at first: "Weiter lernen" takes an open step of the chosen occupation
  and only then of the others, "Enabler 3" means the enabler 3 of the chosen occupation and only
  falls back to the others when the chosen one has no such enabler. Nothing the person may see is
  hidden by it.
- **Off-topic filter**: the block list stays the base. Per occupation, `offtopic_exceptions`
  are words that keep a message out of the filter (procurement, travel costs, hospitality).
  Without code help (`code_help` false) code words no longer count as code help.
- **scenarioText**: the chat route no longer copies it from the request into the system
  prompt. The database holds no scenario text yet (the enabler has a description and a PDF
  link only), so the context stays empty until a server source exists. The prompt builder
  strips heading markers, line separators and invisible characters from scenario text, the
  quiz topic (one line, 80 characters), the conversation summary and the cross session
  memory. FIAE output is byte-identical except for such unsafe input.
- **Enabler and course ids** of the request are checked on their own: both must be well
  formed and belong to a catalog of the person, otherwise ids and titles are dropped.
- The catalog title is used as occupation name only if it passes the settings alphabet,
  otherwise the neutral phrase "deinem Ausbildungsberuf" is used.
- Markers of other occupations are the code, the branding short name and `occupation_name` /
  `field_name` of the catalogs the user may not use (not the title). The match is folded
  (NFKC, no marks, no invisible characters).

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
| `offtopic_exceptions` | up to 60 lower case words, 4 to 30 characters |
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

- Without a choice in the app a person with several occupations gets one merged persona for all of
  them (the base is the first catalog) and the exception words of all of them. With a choice the
  persona is the one of the chosen occupation alone.
- A question about the other own occupation is recognized by its names (code, short name, names in
  the settings, "Fachinformatik" for FIAE). A question that names it only indirectly goes to the
  model, but the search then reads the chosen occupation only, so no content of the other one
  appears.
- The classifier works on words. A question about another occupation without naming it
  cannot be recognized; the index search is filtered by occupation anyway (PR 118).
