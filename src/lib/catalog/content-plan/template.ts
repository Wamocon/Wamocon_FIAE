import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type { ContentPlan } from '@/lib/catalog/content-plan/types';

/**
 * The template of the plan document: an Excel file and a JSON file with example
 * rows and an explanation of every column. The readers (read-structured.ts)
 * read exactly this form, and a test makes the round trip: template, read, same
 * plan. The example is invented and recognised on upload (EXAMPLE_TEMPLATE), so
 * an unchanged template is never taken for a real plan without a warning.
 */

export const TABLE_TITLES = {
  totals: 'Gesamt',
  components: 'Komponenten',
  learningFields: 'Lernfelder',
  relations: 'Beziehungen',
  notes: 'Hinweise',
} as const;

/** The example of the template: invented, small and consistent in itself. */
export const EXAMPLE_PLAN: ContentPlan = {
  totals: {
    components: 2,
    enablers: 9,
    scenarios: 9,
    useCases: 9,
    lessonQuizzes: 27,
    globalQuizzes: 2,
    learningFields: 2,
    questionsPerQuiz: 10,
    hours: 160,
  },
  components: [
    {
      code: 'BSP-1',
      title: 'Beispielkomponente Grundlagen',
      phase: 1,
      kind: 'pflicht',
      hours: 80,
      weeks: 2,
      enablers: 5,
      scenarios: 5,
      useCases: 5,
      quizzes: 15,
      globalQuiz: true,
      order: 1,
      learningFields: ['LF-A'],
    },
    {
      code: 'BSP-2',
      title: 'Beispielkomponente Vertiefung',
      phase: 1,
      kind: 'wahl',
      hours: 80,
      weeks: 2,
      enablers: 4,
      scenarios: 4,
      useCases: 4,
      quizzes: 12,
      globalQuiz: true,
      order: 2,
      learningFields: ['LF-B'],
    },
  ],
  learningFields: [
    { code: 'LF-A', title: 'Beispiel-Lernfeld A', hours: 60 },
    { code: 'LF-B', title: 'Beispiel-Lernfeld B', hours: 80 },
  ],
  relations: [
    { type: 'component_learning_field', from: 'BSP-1', to: 'LF-A' },
    { type: 'enabler_learning_field', from: 'BSP-1-a', to: 'LF-A' },
    { type: 'use_case_enabler', from: 'BSP-UC-1', to: 'BSP-1-a' },
  ],
  notes: ['Beispielhinweis: Diese Zeilen sind erfunden.'],
};

/** The explanation of the columns, shared by the Excel and the JSON template. */
const TOTAL_ROWS: [
  label: string,
  key: keyof NonNullable<ContentPlan['totals']>,
  help: string,
][] = [
  [
    'Komponenten',
    'components',
    'Anzahl der Komponenten (Kurse) der Ausbildung',
  ],
  ['Enabler', 'enablers', 'Anzahl aller Enabler'],
  ['Szenarien', 'scenarios', 'Anzahl aller Szenarien'],
  ['Use Cases', 'useCases', 'Anzahl aller Use Cases'],
  ['Lektionsquizze', 'lessonQuizzes', 'Anzahl der Quizze an den Enablern'],
  ['Global-Quizze', 'globalQuizzes', 'Anzahl der Global-Quizze'],
  ['Lernfelder', 'learningFields', 'Anzahl der Lernfelder'],
  [
    'Fragen je Quiz',
    'questionsPerQuiz',
    'Fragen in einem Quiz (ganze Zahl, 1 bis 200)',
  ],
  ['Stunden gesamt', 'hours', 'Stunden der gesamten Ausbildung'],
];

const COMPONENT_HEADER = [
  'Code',
  'Titel',
  'Phase',
  'Art',
  'Stunden',
  'Wochen',
  'Enabler',
  'Szenarien',
  'Use Cases',
  'Quizze',
  'Global-Quiz',
  'Reihenfolge',
  'Lernfelder',
];
const LEARNING_FIELD_HEADER = ['Code', 'Titel', 'Stunden'];
const RELATION_HEADER = ['Art', 'Von', 'Nach'];

const RELATION_LABEL = {
  component_learning_field: 'Komponente-Lernfeld',
  enabler_learning_field: 'Enabler-Lernfeld',
  use_case_enabler: 'UseCase-Enabler',
} as const;

const GUIDE: string[][] = [
  ['Plan-Dokument: Vorlage'],
  [''],
  [
    'Alles in diesem Dokument ist freiwillig. Es ergänzt die manuelle Eingabe der Soll-Zahlen und ersetzt sie nie: Eine manuell eingetragene Zahl gilt immer vor dem Plan.',
  ],
  [
    'Was nicht ausgefüllt ist, gilt als "nicht angegeben" (nie als null). Lasse Zellen leer, wenn du etwas nicht weißt.',
  ],
  [
    'Die Beispielzeilen in den Blättern sind erfunden. Überschreibe oder lösche sie. Eine Zeile, die mit # beginnt, wird nicht gelesen.',
  ],
  [''],
  ['Blatt', 'Spalte', 'Erklärung'],
  [
    'Gesamt',
    'Kennzahl, Wert',
    'Gesamtzahlen der Ausbildung, eine Kennzahl je Zeile (ganze Zahlen, bei Stunden auch Dezimalzahlen)',
  ],
  [
    'Komponenten',
    'Code',
    'Kennung der Komponente, zum Beispiel K6.1 (Code oder Titel muss stehen)',
  ],
  ['Komponenten', 'Titel', 'Bezeichnung der Komponente'],
  ['Komponenten', 'Phase', '1 oder 2 (leer bei integrativen Komponenten)'],
  ['Komponenten', 'Art', 'pflicht, wahl oder integrativ'],
  ['Komponenten', 'Stunden', 'Zeitrichtwert in Stunden'],
  ['Komponenten', 'Wochen', 'Zeitrichtwert in Wochen'],
  ['Komponenten', 'Enabler', 'Anzahl der Enabler der Komponente'],
  ['Komponenten', 'Szenarien', 'Anzahl der Szenarien der Komponente'],
  ['Komponenten', 'Use Cases', 'Anzahl der Use Cases der Komponente'],
  ['Komponenten', 'Quizze', 'Anzahl der Quizze an den Enablern der Komponente'],
  [
    'Komponenten',
    'Global-Quiz',
    'ja oder nein: Hat die Komponente ein Global-Quiz?',
  ],
  ['Komponenten', 'Reihenfolge', 'Position in der Ausbildung (ganze Zahl)'],
  [
    'Komponenten',
    'Lernfelder',
    'Codes der zugeordneten Lernfelder, durch Komma getrennt',
  ],
  [
    'Lernfelder',
    'Code, Titel, Stunden',
    'Lernfeld mit Zeitrichtwert in Stunden',
  ],
  [
    'Beziehungen',
    'Art',
    'Komponente-Lernfeld, Enabler-Lernfeld oder UseCase-Enabler',
  ],
  [
    'Beziehungen',
    'Von, Nach',
    'Die Codes der beiden Seiten, zum Beispiel K6.1 und LF-3',
  ],
  ['Hinweise', 'Text', 'Freie Hinweise zur Ausbildung, ein Hinweis je Zeile'],
];

const cells = (plan: ContentPlan) => {
  const t = plan.totals ?? {};
  const totals: (string | number)[][] = [
    ['Kennzahl', 'Wert', 'Erklärung'],
    ...TOTAL_ROWS.map(([label, key, help]) => [label, t[key] ?? '', help]),
  ];
  const components: (string | number | boolean)[][] = [
    COMPONENT_HEADER,
    ...(plan.components ?? []).map(c => [
      c.code ?? '',
      c.title ?? '',
      c.phase ?? '',
      c.kind ?? '',
      c.hours ?? '',
      c.weeks ?? '',
      c.enablers ?? '',
      c.scenarios ?? '',
      c.useCases ?? '',
      c.quizzes ?? '',
      c.globalQuiz === undefined ? '' : c.globalQuiz ? 'ja' : 'nein',
      c.order ?? '',
      (c.learningFields ?? []).join(', '),
    ]),
  ];
  const learningFields = [
    LEARNING_FIELD_HEADER,
    ...(plan.learningFields ?? []).map(l => [
      l.code ?? '',
      l.title ?? '',
      l.hours ?? '',
    ]),
  ];
  const relations = [
    RELATION_HEADER,
    ...(plan.relations ?? []).map(r => [RELATION_LABEL[r.type], r.from, r.to]),
  ];
  const notes = [['Hinweis'], ...(plan.notes ?? []).map(n => [n])];
  return { totals, components, learningFields, relations, notes };
};

/**
 * SheetJS writes a default content type for .bin parts that names a macro
 * workbook. The safe reader of the content upload refuses a workbook type that
 * allows macros, so the line is removed (the file has no .bin part at all).
 */
async function withoutMacroContentType(data: Uint8Array): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  const file = zip.file('[Content_Types].xml');
  if (file) {
    const xml = await file.async('string');
    zip.file(
      '[Content_Types].xml',
      xml.replace(/<Default Extension="bin"[^>]*\/>/g, '')
    );
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** The Excel template with the example, the guide and one sheet per table. */
export async function buildTemplateXlsx(
  plan: ContentPlan = EXAMPLE_PLAN
): Promise<Buffer> {
  const sheets = cells(plan);
  const workbook = XLSX.utils.book_new();
  const add = (
    name: string,
    rows: (string | number | boolean)[][],
    widths: number[]
  ) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = widths.map(wch => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  };
  add('Anleitung', GUIDE, [16, 22, 110]);
  add(TABLE_TITLES.totals, sheets.totals, [22, 12, 60]);
  add(
    TABLE_TITLES.components,
    sheets.components,
    [12, 36, 8, 12, 10, 10, 10, 11, 11, 10, 13, 13, 22]
  );
  add(TABLE_TITLES.learningFields, sheets.learningFields, [12, 36, 10]);
  add(TABLE_TITLES.relations, sheets.relations, [24, 18, 18]);
  add(TABLE_TITLES.notes, sheets.notes, [100]);
  const raw = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return withoutMacroContentType(raw as Uint8Array);
}

/** The JSON template: the plan model plus an explanation under "_anleitung". */
export function buildTemplateJson(plan: ContentPlan = EXAMPLE_PLAN): string {
  return `${JSON.stringify(
    {
      _anleitung: {
        hinweis:
          'Alles ist freiwillig und ergänzt die manuelle Eingabe, ersetzt sie nie. Was fehlt, gilt als nicht angegeben (nie als null). Schlüssel mit führendem Unterstrich werden nicht gelesen. Die Beispielwerte sind erfunden, bitte überschreiben oder löschen.',
        totals:
          'Gesamtzahlen: components, enablers, scenarios, useCases, lessonQuizzes, globalQuizzes, learningFields (ganze Zahlen), questionsPerQuiz (1 bis 200), hours (Stunden gesamt)',
        components:
          'Je Komponente: code oder title (eines muss stehen), phase (1 oder 2), kind (pflicht, wahl, integrativ), hours, weeks, enablers, scenarios, useCases, quizzes, globalQuiz (true oder false), order, learningFields (Liste von Codes)',
        learningFields:
          'Je Lernfeld: code oder title, hours (Zeitrichtwert in Stunden)',
        relations:
          'Je Beziehung: type (component_learning_field, enabler_learning_field, use_case_enabler), from und to als Codes',
        notes: 'Liste freier Hinweise (Text)',
      },
      ...plan,
    },
    null,
    2
  )}\n`;
}
