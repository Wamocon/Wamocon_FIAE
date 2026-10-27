import {
  buildLearningFieldPlan,
  renderLearningFieldSummary,
  validateLearningFieldPlan,
} from '@/lib/content-import/learning-fields/plan';
import type { TitleSet } from '@/lib/content-import/learning-fields/titles';
import type { LearningFieldPlan } from '@/lib/content-import/learning-fields/types';

import { block, row, sampleIndex, sampleSheet, sheetOf } from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const build = (
  sheet = sampleSheet(),
  index = sampleIndex(),
  titles: TitleSet | null = null
) =>
  buildLearningFieldPlan(sheet, index, {
    now: NOW,
    titles,
    official: false,
  });

const codes = (plan: LearningFieldPlan) =>
  plan.skipped.map(s => [s.row, s.column, s.code]);

describe('buildLearningFieldPlan: learning fields', () => {
  it('lists LF1 to LF13 with school year, order and no hours', () => {
    const plan = build();
    expect(plan.version).toBe(1);
    expect(plan.catalog).toBe('KFBM');
    expect(plan.generatedAt).toBe('2026-10-27T10:00:00.000Z');
    expect(plan.learningFields).toHaveLength(13);
    expect(
      plan.learningFields.map(f => [f.code, f.trainingYear, f.orderIndex])
    ).toEqual([
      ['LF1', 1, 1],
      ['LF2', 1, 2],
      ['LF3', 1, 3],
      ['LF4', 1, 4],
      ['LF5', 2, 5],
      ['LF6', 2, 6],
      ['LF7', 2, 7],
      ['LF8', 2, 8],
      ['LF9', 3, 9],
      ['LF10', 3, 10],
      ['LF11', 3, 11],
      ['LF12', 3, 12],
      ['LF13', 3, 13],
    ]);
    expect(plan.learningFields.every(f => f.hoursBudget === null)).toBe(true);
  });

  it('writes a provisional placeholder title when no source names the title', () => {
    const plan = build();
    expect(plan.learningFields[0]).toMatchObject({
      title: 'Lernfeld 1',
      titleSource: 'placeholder',
      titleProvisional: true,
    });
    expect(plan.open).toEqual(
      expect.arrayContaining(['HOURS_BUDGET', 'TITLES_PROVISIONAL'])
    );
  });

  it('takes titles from the source list (provisional) or from the owner file', () => {
    const csv: TitleSet = {
      titles: { 1: 'Alpha', 13: 'Omega' },
      years: { 1: 1, 13: 3 },
      source: 'csv',
      warnings: [
        'LF1: 2 different titles in the source list, the most frequent one is used.',
      ],
    };
    const fromCsv = build(sampleSheet(), sampleIndex(), csv);
    expect(fromCsv.learningFields[0]).toMatchObject({
      title: 'Alpha',
      titleSource: 'csv',
      titleProvisional: true,
    });
    expect(fromCsv.learningFields[1].titleSource).toBe('placeholder');
    expect(fromCsv.learningFields[12].title).toBe('Omega');
    expect(fromCsv.warnings).toContain(csv.warnings[0]);

    const all: TitleSet = {
      titles: Object.fromEntries(
        Array.from({ length: 13 }, (_v, i) => [i + 1, `Titel ${i + 1}`])
      ),
      years: {},
      source: 'json',
      warnings: [],
    };
    const fromJson = build(sampleSheet(), sampleIndex(), all);
    expect(fromJson.learningFields.every(f => !f.titleProvisional)).toBe(true);
    expect(fromJson.open).not.toContain('TITLES_PROVISIONAL');
    expect(fromJson.stats.learningFields).toEqual({
      total: 13,
      withProvisionalTitle: 0,
      withPlaceholderTitle: 0,
      withHours: 0,
    });
  });

  it('warns when the school year of the source list differs from the assignment', () => {
    const titles: TitleSet = {
      titles: { 5: 'Fünf' },
      years: { 5: 3 },
      source: 'csv',
      warnings: [],
    };
    const plan = build(sampleSheet(), sampleIndex(), titles);
    expect(plan.warnings).toContain(
      'LF5: the source list names school year 3, the assignment is school year 2.'
    );
    expect(plan.learningFields[4].trainingYear).toBe(2);
  });
});

describe('buildLearningFieldPlan: mappings', () => {
  it('maps each position to the enabler of the import, per school year', () => {
    const plan = build();
    const of = (enabler: string) =>
      plan.mappings
        .filter(m => m.enablerCode === enabler)
        .map(m => [m.learningFieldCode, m.schoolYear, m.row, m.column]);
    expect(of('K1-a')).toEqual([
      ['LF2', 1, 5, 'C'],
      ['LF3', 1, 5, 'C'],
      ['LF12', 3, 5, 'E'],
    ]);
    expect(of('K1-b')).toEqual([['LF2', 1, 6, 'C']]);
    // the split component: letter a belongs to K6.1, letter d to K6.2
    expect(of('K6.1-a')).toEqual([
      ['LF3', 1, 7, 'C'],
      ['LF5', 2, 7, 'D'],
      ['LF7', 2, 7, 'D'],
    ]);
    expect(of('K6.2-d')).toEqual([
      ['LF4', 1, 8, 'C'],
      ['LF10', 3, 8, 'E'],
    ]);
    expect(plan.mappings.find(m => m.enablerCode === 'K6.2-d')).toMatchObject({
      componentCode: 'K6.2',
    });
  });

  it('reads "alle Lernfelder" as all learning fields of the school year of the column', () => {
    const plan = build();
    const all = plan.mappings.filter(m => m.enablerCode === 'K24.1-a');
    expect(all.map(m => m.learningFieldCode)).toEqual(
      Array.from({ length: 13 }, (_v, i) => `LF${i + 1}`)
    );
    expect(all.map(m => m.schoolYear)).toEqual([
      1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 3,
    ]);
    expect(plan.open).toContain('ALL_LEARNING_FIELDS');
  });

  it('keeps "alle Lernfelder" of one column to the learning fields of that year', () => {
    const plan = build(
      sheetOf(
        row(
          5,
          block(1, 'Erfunden', 2, 1),
          'a) x',
          null,
          'alle Lernfelder',
          null
        )
      )
    );
    expect(plan.mappings.map(m => m.learningFieldCode)).toEqual([
      'LF5',
      'LF6',
      'LF7',
      'LF8',
    ]);
  });

  it('notes positions that have no learning field on purpose', () => {
    const plan = build();
    expect(plan.notes).toEqual([
      {
        row: 10,
        code: 'COMPANY_ONLY',
        enablerCode: 'K10-a',
        componentCode: 'K10',
      },
    ]);
    const empty = build(
      sheetOf(
        row(
          5,
          block(1, 'Erfunden', 2, 1),
          'a) x',
          null,
          null,
          'nur betrieblich'
        ),
        row(6, null, 'b) y')
      )
    );
    expect(empty.notes.map(n => [n.row, n.code])).toEqual([
      [5, 'COMPANY_ONLY'],
      [6, 'NO_REFERENCE'],
    ]);
  });

  it('counts positions, mappings and skips', () => {
    const plan = build();
    expect(plan.stats.blocks).toBe(4);
    expect(plan.stats.positions).toBe(7);
    expect(plan.stats.positionStatus).toEqual({
      mapped: 5,
      companyOnly: 1,
      noReference: 0,
      skipped: 1,
    });
    expect(plan.stats.mappings).toBe(22);
    expect(plan.stats.mappingsBySchoolYear).toEqual({ 1: 9, 2: 6, 3: 7 });
    expect(plan.stats.mappingsByLearningField.LF2).toBe(3);
    expect(plan.stats.enablersMapped).toBe(5);
    expect(plan.stats.componentsMapped).toBe(4);
    expect(plan.stats.skippedByCode).toEqual({ ENABLER_NOT_IN_IMPORT: 1 });
    expect(plan.stats.notesByCode).toEqual({ COMPANY_ONLY: 1 });
    expect(plan.stats.sheet).toEqual({
      headerRow: 4,
      firstDataRow: 5,
      lastRow: 13,
      sectionRows: 2,
      blankRows: 0,
    });
    expect(plan.source).toEqual({
      sheet: '',
      headerRow: 4,
      firstDataRow: 5,
      lastRow: 13,
    });
    // every position is accounted for
    const status = plan.stats.positionStatus;
    expect(
      status.mapped + status.companyOnly + status.noReference + status.skipped
    ).toBe(plan.stats.positions);
  });
});

describe('buildLearningFieldPlan: rows that are skipped, never guessed', () => {
  it('skips a position whose letter has no enabler in the import', () => {
    const plan = build();
    expect(plan.skipped).toEqual([
      {
        row: 11,
        column: null,
        code: 'ENABLER_NOT_IN_IMPORT',
        enablerCode: null,
        componentCode: 'K10',
        learningField: null,
        pairs: 0,
        reason:
          'The import has no enabler for this position (letter b of K10).',
      },
    ]);
  });

  it('skips a component without a counterpart in the import and K18', () => {
    const plan = build(
      sheetOf(
        row(5, block(7, 'Nicht im Import', 2, 7), 'a) x', 'LF 4'),
        row(6, 'Abschnitt B: x', null),
        row(7, block(9, 'Ausgeschlossen', 3, 9), 'a) x', 'LF 4', 'LF 8'),
        row(8, null, 'b) y', 'nur betr./beh.')
      )
    );
    expect(codes(plan)).toEqual([
      [5, null, 'COMPONENT_NOT_IN_IMPORT'],
      [7, null, 'COMPONENT_EXCLUDED'],
      [8, null, 'COMPONENT_EXCLUDED'],
    ]);
    expect(plan.skipped[0]).toMatchObject({ componentCode: null, pairs: 1 });
    expect(plan.skipped[1]).toMatchObject({ pairs: 2 });
    expect(plan.stats.pairsSkipped).toBe(3);
    expect(plan.mappings).toEqual([]);
  });

  it('skips a block whose paragraph differs from the paragraph of the import component', () => {
    const index = sampleIndex();
    index.components[0] = { code: 'K1', reference: '§ 4 Abs. 2 Nr. 9' };
    const plan = build(sampleSheet(), index);
    expect(
      plan.skipped.filter(s => s.code === 'REFERENCE_MISMATCH').map(s => s.row)
    ).toEqual([5, 6]);
    expect(plan.mappings.some(m => m.componentCode === 'K1')).toBe(false);
  });

  it('accepts a component without a paragraph in the import', () => {
    const index = sampleIndex();
    index.components[0] = { code: 'K1', reference: null };
    expect(
      build(sampleSheet(), index).mappings.some(m => m.componentCode === 'K1')
    ).toBe(true);
  });

  it('passes on the problems of a block, a missing letter and a repeated letter', () => {
    const plan = build(
      sheetOf(
        row(
          5,
          block(1, 'Zahl weicht ab', 2, 1).replace('1.', '2.'),
          'a) x',
          'LF 2'
        ),
        row(6, block(1, 'Gut', 2, 1), 'a) erste', 'LF 2'),
        row(7, null, 'ohne Buchstabe', 'LF 3'),
        row(8, null, 'a) zweite', 'LF 4'),
        row(9, null, 'b) fein', 'LF 4'),
        row(10, null, null, 'LF 4')
      )
    );
    // a repeated letter is ambiguous: both rows are skipped
    expect(codes(plan)).toEqual([
      [5, null, 'NUMBER_MISMATCH'],
      [6, null, 'DUPLICATE_LETTER'],
      [7, null, 'NO_LETTER'],
      [8, null, 'DUPLICATE_LETTER'],
      [10, null, 'ORPHAN_REFERENCE'],
    ]);
    expect(plan.mappings.map(m => [m.enablerCode, m.row])).toEqual([
      ['K1-b', 9],
    ]);
  });

  it('skips a position outside any block', () => {
    const plan = build(sheetOf(row(5, null, 'a) ohne Block', 'LF 2')));
    expect(codes(plan)).toEqual([[5, null, 'BLOCK_UNKNOWN']]);
  });

  it('skips a position whose letter fits two components of a split', () => {
    const index = sampleIndex();
    index.enablers.push('K6.1-d');
    const plan = build(sampleSheet(), index);
    expect(plan.skipped.find(s => s.row === 8)).toMatchObject({
      code: 'ENABLER_AMBIGUOUS',
      componentCode: null,
      pairs: 2,
    });
  });

  it('skips single cells and numbers: other years, outside 1 to 13, unreadable', () => {
    const plan = build(
      sheetOf(
        row(
          5,
          block(1, 'Erfunden', 2, 1),
          'a) x',
          'LF 6, 3',
          'LF 14, 5',
          'LF 2-4'
        ),
        row(6, null, 'b) y', 'LF 12', 'LF 1')
      )
    );
    expect(
      plan.skipped.map(s => [s.row, s.column, s.code, s.learningField, s.pairs])
    ).toEqual([
      [5, 'C', 'YEAR_MISMATCH', 'LF6', 1],
      [5, 'D', 'LF_OUT_OF_RANGE', 'LF14', 0],
      [5, 'E', 'UNPARSEABLE_REFERENCE', null, 0],
      [6, 'C', 'YEAR_MISMATCH', 'LF12', 1],
      [6, 'D', 'YEAR_MISMATCH', 'LF1', 1],
    ]);
    expect(
      plan.mappings.map(m => [m.enablerCode, m.learningFieldCode])
    ).toEqual([
      ['K1-a', 'LF3'],
      ['K1-a', 'LF5'],
    ]);
    // a row with one good number is mapped, the others are listed
    expect(plan.stats.positionStatus.mapped).toBe(1);
    expect(plan.stats.positionStatus.skipped).toBe(1);
  });

  it('handles an empty sheet', () => {
    const plan = build(sheetOf());
    expect(plan.mappings).toEqual([]);
    expect(plan.stats.positions).toBe(0);
    expect(plan.learningFields).toHaveLength(13);
  });
});

describe('renderLearningFieldSummary', () => {
  it('names numbers, codes and rows, no cell text, no dashes', () => {
    const text = renderLearningFieldSummary(build());
    expect(text).toContain('# Plan der Lernfelder');
    expect(text).toContain('| LF1 | 1 | Platzhalter (vorläufig) | offen | 1 |');
    expect(text).toContain('ENABLER_NOT_IN_IMPORT');
    expect(text).toContain('| 11 |');
    expect(text).not.toMatch(/[–—]/);
    expect(text).not.toContain('Erfunden');
    expect(text).not.toContain('Position a');
  });

  it('lists many skips only up to a limit', () => {
    const rows = Array.from({ length: 5 }, (_v, i) =>
      row(5 + i, null, `a) x${i}`, 'LF 2')
    );
    const text = renderLearningFieldSummary(build(sheetOf(...rows)), {
      maxSkips: 2,
    });
    expect(text).toContain('und 3 weitere');
  });
});

describe('validateLearningFieldPlan', () => {
  const problems = (change: (plan: LearningFieldPlan) => void) => {
    const plan = JSON.parse(JSON.stringify(build())) as LearningFieldPlan;
    change(plan);
    return validateLearningFieldPlan(plan);
  };

  it('accepts a plan from the builder, also after a round trip through JSON', () => {
    expect(
      validateLearningFieldPlan(JSON.parse(JSON.stringify(build())))
    ).toEqual([]);
  });

  it('refuses what is not a plan', () => {
    expect(validateLearningFieldPlan(null)).toEqual([
      'The plan is not an object.',
    ]);
    expect(validateLearningFieldPlan({ version: 2 })).toContain(
      'The plan version must be 1.'
    );
  });

  it('refuses another catalog', () => {
    expect(
      problems(p => {
        p.catalog = 'FIAE';
      })
    ).toContain('The plan catalog must be KFBM.');
  });

  it('refuses a learning field list that is not LF1 to LF13 in order', () => {
    expect(
      problems(p => {
        p.learningFields.pop();
      })
    ).toContain('The plan must list the 13 learning fields.');
    expect(
      problems(p => {
        p.learningFields[1].code = 'LF1';
      })
    ).toContain('The learning field code LF1 is listed twice.');
    expect(
      problems(p => {
        p.learningFields[0].trainingYear = 2;
      })
    ).toContain('LF1: the school year must be 1.');
    expect(
      problems(p => {
        p.learningFields[0].orderIndex = 5;
      })
    ).toContain('LF1: the order must be 1.');
    expect(
      problems(p => {
        p.learningFields[0].title = ' ';
      })
    ).toContain('LF1: the title must be a text of 1 to 200 characters.');
    expect(
      problems(p => {
        p.learningFields[0].hoursBudget = -1;
      })
    ).toContain('LF1: the hours must be empty or a whole number of 0 or more.');
    expect(
      problems(p => {
        p.learningFields[0].code = 'LF-1';
      })
    ).toContain('The learning field code LF-1 is not LF1 to LF13.');
  });

  it('refuses mappings that do not fit', () => {
    expect(
      problems(p => {
        p.mappings[0].learningFieldCode = 'LF14';
      })
    ).toContain('Mapping 1: the learning field LF14 is not in the plan.');
    expect(
      problems(p => {
        p.mappings[0].enablerCode = 'K1a';
      })
    ).toContain('Mapping 1: the enabler code K1a is not a code like K6.2-d.');
    expect(
      problems(p => {
        p.mappings[0].schoolYear = 2;
      })
    ).toContain('Mapping 1: the school year 2 does not fit LF2.');
    expect(
      problems(p => {
        p.mappings.push({ ...p.mappings[0] });
      })
    ).toContain('Mapping 23: K1-a and LF2 are listed twice.');
    expect(
      problems(p => {
        (p as unknown as { mappings: unknown }).mappings = 'x';
      })
    ).toContain(
      'The plan needs the lists learningFields, mappings and skipped.'
    );
  });

  it('refuses codes that are not in the canonical form and fields that are not codes', () => {
    expect(
      problems(p => {
        p.learningFields[0].code = 'LF01';
      })
    ).toContain('The learning field code LF01 is not LF1 to LF13.');
    expect(
      problems(p => {
        p.mappings[0].componentCode = 'x| y';
        p.mappings[0].row = 1.5;
      })
    ).toEqual(
      expect.arrayContaining([
        'Mapping 1: the component code x| y is not a code like K6.2.',
        'Mapping 1: the row must be a whole number.',
      ])
    );
    expect(
      problems(p => {
        p.skipped[0].enablerCode = '| x |\n';
        p.skipped[0].row = Number.NaN;
      })
    ).toEqual(
      expect.arrayContaining([
        'Skip 1: enablerCode is not a code.',
        'Skip 1: the row must be a whole number.',
      ])
    );
  });

  it('refuses a skip list with an unknown code', () => {
    expect(
      problems(p => {
        p.skipped[0].code = 'NOPE' as never;
      })
    ).toContain('Skip 1: the code NOPE is not known.');
  });
});
