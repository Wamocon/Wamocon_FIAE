/**
 * @jest-environment node
 */
import {
  facetsOf,
  filterRows,
  filterToParams,
  matchesStatus,
  pageRows,
  parseFilter,
  sortRows,
} from '@/lib/content-upload/review/filter';
import {
  STATUS_FILTERS,
  type ReviewRowDto,
} from '@/lib/content-upload/review/types';

let counter = 0;
function row(
  overrides: Partial<ReviewRowDto> & {
    band?: 'high' | 'medium' | 'low' | 'conflict' | null;
    docType?: string | null;
    component?: string | null;
  } = {}
): ReviewRowDto {
  counter += 1;
  const {
    band = 'high',
    docType = 'quiz',
    component = 'K1',
    ...rest
  } = overrides;
  const name = rest.fileName ?? `datei${String(counter).padStart(3, '0')}.docx`;
  return {
    id: `id-${counter}`,
    fileName: name,
    relPath: rest.relPath ?? `ordner/${name}`,
    ext: 'docx',
    sizeBytes: 1000,
    pageCount: null,
    status: 'proposed_rules',
    statusCode: null,
    clientMtimeMs: null,
    proposal:
      band === null
        ? null
        : {
            source: 'path_content',
            docType,
            componentCode: component,
            enablerCode: 'K1-a',
            quizLevel: null,
            band,
            confidence: 0.99,
            reasons: [],
            isNew: false,
          },
    effective: {
      docType,
      componentCode: component,
      enablerCode: component ? `${component}-a` : null,
      quizLevel: null,
    },
    decision: null,
    derived: null,
    duplicate: null,
    copyOfId: null,
    ...rest,
  };
}

const decided = (action: 'accept' | 'reject' | 'defer') =>
  ({
    action,
    dupChoice: null,
    decidedAt: '2026-10-28T10:00:00.000Z',
    docType: 'quiz',
    componentCode: 'K1',
    enablerCode: 'K1-a',
    quizLevel: null,
  }) as ReviewRowDto['decision'];

describe('filterRows', () => {
  const rows = [
    row({
      band: 'high',
      docType: 'quiz',
      component: 'K1',
      fileName: 'A_Quiz.docx',
    }),
    row({
      band: 'medium',
      docType: 'enabler',
      component: 'K12',
      fileName: 'B_Text.docx',
    }),
    row({
      band: 'low',
      docType: null,
      component: null,
      status: 'unclear',
      fileName: 'C_lose.docx',
    }),
    row({
      band: 'conflict',
      docType: 'scenario',
      component: 'K6.1',
      fileName: 'D_Szenario.docx',
    }),
    row({
      band: null,
      status: 'failed',
      docType: null,
      component: null,
      fileName: 'E_kaputt.docx',
    }),
    row({
      band: 'high',
      docType: 'quiz',
      component: 'K1',
      fileName: 'F_Quiz.docx',
      decision: decided('accept'),
    }),
    row({
      band: 'high',
      docType: 'quiz',
      component: 'K1',
      fileName: 'G_Quiz.docx',
      decision: decided('reject'),
    }),
    row({
      band: 'high',
      docType: 'quiz',
      component: 'K1',
      fileName: 'H_Quiz.docx',
      decision: decided('defer'),
      duplicate: {
        key: 'quiz:1a:low',
        size: 2,
        suggested: false,
        ambiguous: true,
      },
    }),
    row({
      band: 'high',
      status: 'merged',
      fileName: 'I_Kopie.docx',
      copyOfId: 'x',
    }),
  ];

  it('returns all rows without a filter', () => {
    expect(filterRows(rows, {})).toHaveLength(rows.length);
  });

  it.each([
    ['high', 4],
    ['medium', 1],
    ['low', 1],
    ['conflict', 1],
  ] as const)('filters by the band %s', (band, count) => {
    expect(filterRows(rows, { band })).toHaveLength(count);
  });

  it('a file without a proposal has no band and is found by no band filter', () => {
    for (const band of ['high', 'medium', 'low', 'conflict'] as const) {
      expect(filterRows(rows, { band }).map(r => r.fileName)).not.toContain(
        'E_kaputt.docx'
      );
    }
  });

  it('filters by the type and the component of what counts now', () => {
    expect(
      filterRows(rows, { docType: 'enabler' }).map(r => r.fileName)
    ).toEqual(['B_Text.docx']);
    expect(
      filterRows(rows, { component: 'K6.1' }).map(r => r.fileName)
    ).toEqual(['D_Szenario.docx']);
    expect(filterRows(rows, { docType: 'quiz', component: 'K1' })).toHaveLength(
      5
    );
  });

  it('uses the decision before the proposal for the type and the component', () => {
    const corrected = row({
      docType: 'quiz',
      component: 'K1',
      decision: {
        ...decided('accept')!,
        docType: 'scenario',
        componentCode: 'K12',
      },
      effective: {
        docType: 'scenario',
        componentCode: 'K12',
        enablerCode: 'K12-a',
        quizLevel: null,
      },
    });
    expect(
      filterRows([corrected], { docType: 'scenario', component: 'K12' })
    ).toHaveLength(1);
    expect(filterRows([corrected], { docType: 'quiz' })).toHaveLength(0);
  });

  it.each([
    ['open', ['A_Quiz.docx', 'B_Text.docx', 'C_lose.docx', 'D_Szenario.docx']],
    ['accepted', ['F_Quiz.docx']],
    ['rejected', ['G_Quiz.docx']],
    ['deferred', ['H_Quiz.docx']],
    ['problems', ['E_kaputt.docx']],
    ['skipped', ['I_Kopie.docx']],
  ] as const)('filters by the status %s', (status, names) => {
    expect(filterRows(rows, { status }).map(r => r.fileName)).toEqual(names);
  });

  it('knows every status of the list of filters', () => {
    for (const status of STATUS_FILTERS) {
      expect(typeof matchesStatus(rows[0], status)).toBe('boolean');
    }
  });

  it('finds the files that are versions of another one', () => {
    expect(filterRows(rows, { duplicates: true }).map(r => r.fileName)).toEqual(
      ['H_Quiz.docx']
    );
  });

  it('searches the name and the path without regard to the case, also in combination', () => {
    expect(
      filterRows(rows, { query: 'szenario' }).map(r => r.fileName)
    ).toEqual(['D_Szenario.docx']);
    expect(
      filterRows(rows, { query: 'ORDNER/F_' }).map(r => r.fileName)
    ).toEqual(['F_Quiz.docx']);
    expect(
      filterRows(rows, { query: 'quiz', band: 'high', status: 'open' }).map(
        r => r.fileName
      )
    ).toEqual(['A_Quiz.docx']);
    expect(filterRows(rows, { query: '   ' })).toHaveLength(rows.length);
  });

  it('treats the text of the search as plain text, not as a pattern', () => {
    expect(filterRows(rows, { query: '.*' })).toHaveLength(0);
    expect(filterRows(rows, { query: '(' })).toHaveLength(0);
  });
});

describe('sortRows and pageRows', () => {
  const rows = [
    row({ band: 'high', fileName: 'b.docx', relPath: 'z/b.docx' }),
    row({ band: 'conflict', fileName: 'C.docx', relPath: 'y/C.docx' }),
    row({ band: 'low', fileName: 'a.docx', relPath: 'x/a.docx' }),
    row({
      band: null,
      status: 'failed',
      fileName: 'd.docx',
      relPath: 'w/d.docx',
    }),
  ];

  it('sorts by the path by default and is stable for equal paths', () => {
    expect(sortRows(rows).map(r => r.relPath)).toEqual([
      'w/d.docx',
      'x/a.docx',
      'y/C.docx',
      'z/b.docx',
    ]);
  });

  it('sorts by the name without regard to the case', () => {
    expect(sortRows(rows, 'name').map(r => r.fileName)).toEqual([
      'a.docx',
      'b.docx',
      'C.docx',
      'd.docx',
    ]);
  });

  it('sorts by the band with what needs a look first and the files without a proposal last', () => {
    expect(sortRows(rows, 'band').map(r => r.fileName)).toEqual([
      'C.docx',
      'a.docx',
      'b.docx',
      'd.docx',
    ]);
  });

  it('sorts by the status', () => {
    expect(sortRows(rows, 'status')[0].status).toBe('failed');
  });

  it('does not change the order of the input', () => {
    const copy = [...rows];
    sortRows(rows, 'band');
    expect(rows).toEqual(copy);
  });

  it('cuts pages of 50 by default and reports the total', () => {
    const many = Array.from({ length: 120 }, () => row());
    const first = pageRows(many, {});
    expect(first).toMatchObject({
      matching: 120,
      page: 1,
      pageSize: 50,
      pages: 3,
    });
    expect(first.rows).toHaveLength(50);
    expect(pageRows(many, { page: 3 }).rows).toHaveLength(20);
  });

  it('counts the matching rows after the filter, not the whole run', () => {
    const many = [
      ...Array.from({ length: 60 }, () => row({ band: 'high' })),
      row({ band: 'low' }),
    ];
    expect(pageRows(many, { band: 'low' })).toMatchObject({
      matching: 1,
      pages: 1,
    });
  });

  it('shows the last page for a page past the end and page 1 for nonsense', () => {
    const many = Array.from({ length: 120 }, () => row());
    expect(pageRows(many, { page: 99 }).page).toBe(3);
    expect(pageRows(many, { page: -4 }).page).toBe(1);
    expect(pageRows(many, { page: 1.5 }).page).toBe(1);
  });

  it('limits the size of a page to 100 and has one page for no rows', () => {
    const many = Array.from({ length: 150 }, () => row());
    expect(pageRows(many, { pageSize: 5000 }).rows).toHaveLength(100);
    expect(pageRows([], {})).toMatchObject({
      matching: 0,
      page: 1,
      pages: 1,
      rows: [],
    });
  });
});

describe('facetsOf', () => {
  it('lists the components in the order of their numbers and the types that occur', () => {
    const rows = [
      row({ component: 'K12' }),
      row({ component: 'K6.2' }),
      row({ component: 'K6.1', docType: 'enabler' }),
      row({ component: 'K1' }),
      row({ component: null, docType: null, band: 'low' }),
    ];
    expect(facetsOf(rows)).toEqual({
      components: ['K1', 'K6.1', 'K6.2', 'K12'],
      docTypes: ['enabler', 'quiz'],
    });
  });
});

describe('parseFilter and filterToParams', () => {
  const parse = (query: string) => parseFilter(new URLSearchParams(query));

  it('reads the known values', () => {
    expect(
      parse(
        'band=low&type=quiz&component=K6.1&status=open&duplicates=1&q=abc&sort=band&page=2&pageSize=20'
      )
    ).toEqual({
      band: 'low',
      docType: 'quiz',
      component: 'K6.1',
      status: 'open',
      duplicates: true,
      query: 'abc',
      sort: 'band',
      page: 2,
      pageSize: 20,
    });
  });

  it('ignores a value that is not known instead of passing it on', () => {
    expect(
      parse('band=extreme&status=all%20of%20them&sort=random&duplicates=yes')
    ).toEqual({});
    expect(
      parse("type='; drop table x;--&component=" + 'K'.repeat(40))
    ).toEqual({});
  });

  it('cuts the text of the search, drops control characters and ignores an empty one', () => {
    expect(parse(`q=${'a'.repeat(300)}`).query).toHaveLength(100);
    expect(parse('q=a%00b%0Ac').query).toBe('abc');
    expect(parse('q=%20%20')).toEqual({});
  });

  it('clamps the page and the size', () => {
    expect(parse('page=0&pageSize=0')).toEqual({ page: 1, pageSize: 1 });
    expect(parse('page=abc&pageSize=1000000')).toEqual({
      page: 1,
      pageSize: 100,
    });
  });

  it('writes only what differs from the defaults and reads it back', () => {
    expect(filterToParams({}).toString()).toBe('');
    expect(
      filterToParams({
        status: 'all',
        sort: 'path',
        page: 1,
        pageSize: 50,
      }).toString()
    ).toBe('');
    const filter = {
      band: 'conflict' as const,
      docType: 'scenario',
      component: 'K6.1',
      status: 'open' as const,
      duplicates: true,
      query: ' Quiz ',
      sort: 'name' as const,
      page: 3,
      pageSize: 25,
    };
    const params = filterToParams(filter);
    expect(parseFilter(params)).toEqual({ ...filter, query: 'Quiz' });
  });
});
