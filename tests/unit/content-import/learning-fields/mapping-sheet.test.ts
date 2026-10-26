import {
  parseMappingSheet,
  parseReference,
} from '@/lib/content-import/learning-fields/mapping-sheet';
import type { SheetRow } from '@/lib/content-import/learning-fields/xlsx-sheet';

const cell = (
  row: number,
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
  return { row, cells };
};

const HEADER = cell(
  4,
  'Komponente/Themenkomplex',
  'Berufsbildposition',
  'Schuljahr 1',
  'Schuljahr 2',
  'Schuljahr 3'
);

/** Invented rows in the style of the source: no original text. */
const sample = (): SheetRow[] => [
  { row: 2, cells: { B: 'Erfundene Überschrift' } },
  HEADER,
  cell(
    5,
    '1. nformationsmanagement erfunden \r\n(§ 4 Absatz 2 Nummer 1) ',
    'a) erste Position mit Silben\r\ntrennung',
    'LF2,3',
    null,
    'LF 12'
  ),
  cell(6, null, 'b)  zweite Position', 'LF 2'),
  cell(
    7,
    '6. Erfundene Bearbeitung\r\n(§ 4 Absatz 2 Nummer 6)',
    'a) Position a',
    'LF 3',
    'LF 5, 7'
  ),
  cell(8, null, 'd) Position d', 'LF 4', null, 'LF_x0002_ 10'),
  cell(9, 'Abschnitt B: Wahl (erfunden)', null),
  cell(
    10,
    '1. Erfundener Prozess\r\n(§ 4 Absatz 3 Nummer 1)',
    'a) wahl a',
    'nur betr./beh.',
    'nur betr./beh.',
    'nur betr./beh.'
  ),
  cell(11, null, 'b) wahl b', null, null, null),
  cell(12, 'Abschnitt C: Gemeinsam (erfunden)', null),
  cell(
    13,
    '5. Erfundene Organisation\r\n(§ 4 Absatz 4 Nummer 5)',
    'a) gemeinsam a',
    'alle Lernfelder',
    'alle Lernfelder',
    'alle Lernfelder'
  ),
];

describe('parseReference', () => {
  it('reads the paragraph of the regulation in both spellings', () => {
    expect(parseReference('(§ 4 Absatz 2 Nummer 1)')).toEqual({
      absatz: 2,
      nummer: 1,
      text: '§ 4 Abs. 2 Nr. 1',
    });
    expect(parseReference('§ 4 Abs. 3 Nr. 10')).toEqual({
      absatz: 3,
      nummer: 10,
      text: '§ 4 Abs. 3 Nr. 10',
    });
    expect(parseReference('§4 Abs.4 Nr.6')?.text).toBe('§ 4 Abs. 4 Nr. 6');
    expect(parseReference('ohne Verweis')).toBeNull();
  });
});

describe('parseMappingSheet', () => {
  it('finds the header and reads blocks and positions with the K numbers', () => {
    const result = parseMappingSheet(sample());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { sheet } = result;
    expect(sheet.headerRow).toBe(4);
    expect(sheet.firstRow).toBe(5);
    expect(sheet.lastRow).toBe(13);
    expect(
      sheet.blocks.map(b => [b.row, b.section, b.componentNumber, b.issues])
    ).toEqual([
      [5, 'A', 1, []],
      [7, 'A', 6, []],
      [10, 'B', 10, []],
      [13, 'C', 24, []],
    ]);
    expect(sheet.sectionRows).toEqual([9, 12]);
    expect(sheet.positions.map(p => [p.row, p.blockIndex, p.letter])).toEqual([
      [5, 0, 'a'],
      [6, 0, 'b'],
      [7, 1, 'a'],
      [8, 1, 'd'],
      [10, 2, 'a'],
      [11, 2, 'b'],
      [13, 3, 'a'],
    ]);
    expect(sheet.positions[0].years).toEqual({
      1: { kind: 'numbers', numbers: [2, 3], invalid: [] },
      2: { kind: 'empty' },
      3: { kind: 'numbers', numbers: [12], invalid: [] },
    });
    expect(sheet.positions[2].years[2]).toEqual({
      kind: 'numbers',
      numbers: [5, 7],
      invalid: [],
    });
    expect(sheet.positions[3].years[3]).toEqual({
      kind: 'numbers',
      numbers: [10],
      invalid: [],
    });
    expect(sheet.positions[4].years[1]).toEqual({ kind: 'company-only' });
    expect(sheet.positions[6].years[2]).toEqual({ kind: 'all' });
  });

  it('numbers the sections A, B and C as K1 to K9, K10 to K19 and K20 to K25', () => {
    const rows: SheetRow[] = [
      HEADER,
      cell(5, '9. A9\r\n(§ 4 Absatz 2 Nummer 9)', 'a) x'),
      cell(6, 'Abschnitt B: x', null),
      cell(7, '10. B10\r\n(§ 4 Absatz 3 Nummer 10)', 'a) x'),
      cell(8, 'Abschnitt C: x', null),
      cell(9, '1. C1\r\n(§ 4 Absatz 4 Nummer 1)', 'a) x'),
      cell(10, '6. C6\r\n(§ 4 Absatz 4 Nummer 6)', 'a) x'),
    ];
    const result = parseMappingSheet(rows);
    expect(
      result.ok && result.sheet.blocks.map(b => b.componentNumber)
    ).toEqual([9, 19, 20, 25]);
  });

  it('falls back to the section row and the number when a block has no paragraph', () => {
    const rows: SheetRow[] = [
      HEADER,
      cell(5, '3. Erfundener Titel ohne Verweis', 'a) x'),
      cell(6, 'Abschnitt B: x', null),
      cell(7, '2. Wahl ohne Verweis', 'a) x'),
    ];
    const result = parseMappingSheet(rows);
    expect(
      result.ok && result.sheet.blocks.map(b => b.componentNumber)
    ).toEqual([3, 11]);
  });

  it('marks blocks whose number, paragraph and section do not agree', () => {
    const rows: SheetRow[] = [
      HEADER,
      cell(
        5,
        '2. Zahl und Verweis weichen ab\r\n(§ 4 Absatz 2 Nummer 3)',
        'a) x'
      ),
      cell(6, '3. Abschnitt weicht ab\r\n(§ 4 Absatz 3 Nummer 3)', 'a) x'),
      cell(7, '12. Außerhalb\r\n(§ 4 Absatz 2 Nummer 12)', 'a) x'),
      cell(8, 'Titel ohne Nummer und Verweis', 'a) x'),
      cell(9, '99. Nummer ohne Verweis', 'a) x'),
    ];
    const result = parseMappingSheet(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheet.blocks.map(b => [b.componentNumber, b.issues])).toEqual(
      [
        [null, ['NUMBER_MISMATCH']],
        [null, ['SECTION_MISMATCH']],
        [null, ['NUMBER_OUT_OF_RANGE']],
        [null, ['BLOCK_UNKNOWN']],
        [null, ['NUMBER_OUT_OF_RANGE']],
      ]
    );
  });

  it('keeps positions without a letter, without a block and orphan references', () => {
    const rows: SheetRow[] = [
      HEADER,
      cell(5, null, 'a) vor dem ersten Block', 'LF 2'),
      cell(6, 'Abschnitt A: x', null),
      cell(7, null, 'b) nach einer Abschnittszeile', 'LF 2'),
      cell(8, '1. Block\r\n(§ 4 Absatz 2 Nummer 1)', 'ohne Buchstabe', 'LF 2'),
      cell(9, null, null, 'LF 3'),
      cell(10, null, null, null),
      cell(11, null, 'A) Großbuchstabe', 'LF 4'),
      cell(12, null, 'a ) mit Leerzeichen', 'LF 4'),
    ];
    const result = parseMappingSheet(rows);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.sheet.positions.map(p => [p.row, p.blockIndex, p.letter])
    ).toEqual([
      [5, null, 'a'],
      [7, null, 'b'],
      [8, 0, null],
      [11, 0, 'a'],
      [12, 0, 'a'],
    ]);
    expect(result.sheet.orphanRows).toEqual([9]);
  });

  it('reports a sheet without the school year header', () => {
    const result = parseMappingSheet([
      cell(2, 'Titel', null),
      cell(3, 'A', 'B', 'Jahr 1', 'Jahr 2', 'Jahr 3'),
    ]);
    expect(result).toEqual({
      ok: false,
      error:
        'The header row (Schuljahr 1 to 3 in the columns C to E) was not found.',
    });
  });

  it('copes with an empty data area', () => {
    const result = parseMappingSheet([HEADER]);
    expect(result.ok && result.sheet.positions).toEqual([]);
    expect(result.ok && result.sheet.lastRow).toBe(4);
  });
});
