// Invented inputs for the tests of the learning field import. Nothing here is
// taken from a real source file: titles, texts and rows are made up in the style
// of the source (components with a paragraph of the regulation, positions with a
// letter, references of the school year columns).
import { parseMappingSheet } from '@/lib/content-import/learning-fields/mapping-sheet';
import type { ParsedMappingSheet } from '@/lib/content-import/learning-fields/mapping-sheet';
import type { ImportIndex } from '@/lib/content-import/learning-fields/types';
import type { SheetRow } from '@/lib/content-import/learning-fields/xlsx-sheet';

export const row = (
  n: number,
  a: string | null,
  b: string | null,
  c: string | null = null,
  d: string | null = null,
  e: string | null = null
): SheetRow => {
  const cells: Record<string, string> = {};
  if (a) cells.A = a;
  if (b) cells.B = b;
  if (c) cells.C = c;
  if (d) cells.D = d;
  if (e) cells.E = e;
  return { row: n, cells };
};

export const HEADER = row(
  4,
  'Komponente/Themenkomplex',
  'Berufsbildposition',
  'Schuljahr 1',
  'Schuljahr 2',
  'Schuljahr 3'
);

export const block = (
  n: number,
  title: string,
  absatz: number,
  nummer: number
) => `${nummer}. ${title}\r\n(§ 4 Absatz ${absatz} Nummer ${nummer})`;

/** Seven positions in four blocks (K1, K6, K10, K24) of the three sections. */
export const sampleRows = (): SheetRow[] => [
  { row: 2, cells: { B: 'Erfundene Überschrift' } },
  HEADER,
  row(
    5,
    block(1, 'Erfundenes Erstes', 2, 1),
    'a) Position a',
    'LF2,3',
    null,
    'LF 12'
  ),
  row(6, null, 'b)  Position b', 'LF 2'),
  row(
    7,
    block(6, 'Erfundenes Sechstes', 2, 6),
    'a) Position a',
    'LF 3',
    'LF 5, 7'
  ),
  row(8, null, 'd) Position d', 'LF 4', null, 'LF_x0002_ 10'),
  row(9, 'Abschnitt B: Wahl (erfunden)', null),
  row(
    10,
    block(1, 'Erfundener Prozess', 3, 1),
    'a) Position a',
    'nur betr./beh.',
    'nur betr./beh.',
    'nur betr./beh.'
  ),
  row(11, null, 'b) Position b'),
  row(12, 'Abschnitt C: Gemeinsam (erfunden)', null),
  row(
    13,
    block(5, 'Erfundene Organisation', 4, 5),
    'a) Position a',
    'alle Lernfelder',
    'alle Lernfelder',
    'alle Lernfelder'
  ),
];

export const sampleSheet = (): ParsedMappingSheet => {
  const result = parseMappingSheet(sampleRows());
  if (!result.ok) throw new Error(result.error);
  return result.sheet;
};

export const sheetOf = (...rows: SheetRow[]): ParsedMappingSheet => {
  const result = parseMappingSheet([HEADER, ...rows]);
  if (!result.ok) throw new Error(result.error);
  return result.sheet;
};

/** The components and enablers that the invented import holds. */
export const sampleIndex = (): ImportIndex => ({
  components: [
    { code: 'K1', reference: '§ 4 Abs. 2 Nr. 1' },
    { code: 'K6.1', reference: '§ 4 Abs. 2 Nr. 6' },
    { code: 'K6.2', reference: '§ 4 Abs. 2 Nr. 6' },
    { code: 'K10', reference: '§ 4 Abs. 3 Nr. 1' },
    { code: 'K24.1', reference: '§ 4 Abs. 4 Nr. 5' },
    { code: 'K24.2', reference: '§ 4 Abs. 4 Nr. 5' },
  ],
  enablers: ['K1-a', 'K1-b', 'K6.1-a', 'K6.2-d', 'K10-a', 'K24.1-a'],
  excludedNumbers: [18],
});
