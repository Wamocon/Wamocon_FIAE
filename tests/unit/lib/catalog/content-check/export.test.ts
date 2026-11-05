import {
  csvField,
  reportFileName,
  reportToCsv,
  reportToJson,
  type CsvLabels,
} from '@/lib/catalog/content-check/export';
import type { ContentCheckReport } from '@/lib/catalog/content-check/types';

const labels: CsvLabels = {
  headers: ['S', 'Q', 'K', 'R', 'Z', 'D', 'E', 'O'],
  severity: { error: 'Fehler', warning: 'Warnung', info: 'Hinweis' },
  source: { script: 'Skript', ki: 'KI', plan: 'Plan' },
  refType: {
    catalog: 'Ausbildung',
    course: 'Komponente',
    enabler: 'Enabler',
    useCase: 'Use Case',
    quiz: 'Quiz',
    question: 'Frage',
    document: 'Dokument',
    learningField: 'Lernfeld',
  },
  category: c => c.toUpperCase(),
};

const report: ContentCheckReport = {
  catalogId: 'x',
  catalogCode: 'KfBM 2/1',
  generatedAt: '2026-11-03T10:00:00.000Z',
  findings: [
    {
      rule: 'a.b',
      severity: 'warning',
      source: 'ki',
      category: 'text',
      summary: 'Ein "Satz"; mit Semikolon',
      refs: [],
    },
  ],
  counts: { error: 0, warning: 1, info: 0 },
  ran: { script: true, ki: true, plan: false },
  notes: [],
};

describe('csv export', () => {
  it('quotes every field and doubles quotes', () => {
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField('Ein "Satz"')).toBe('"Ein ""Satz"""');
    expect(csvField('')).toBe('""');
  });

  it('guards a field that starts like a formula', () => {
    for (const start of ['=1+1', '+49', '-1', '@x', '\tx', '\rx']) {
      expect(csvField(start)).toBe(`"'${start}"`);
    }
    expect(csvField('normal = ok')).toBe('"normal = ok"');
  });

  it('writes a byte order mark, semicolons and CRLF', () => {
    const csv = reportToCsv(report, labels);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(lines[0]).toBe('"S";"Q";"K";"R";"Z";"D";"E";"O"');
    expect(lines[1]).toBe(
      '"Warnung";"KI";"TEXT";"a.b";"Ein ""Satz""; mit Semikolon";"";"";""'
    );
  });

  it('a report without findings is only the header', () => {
    const csv = reportToCsv({ ...report, findings: [] }, labels);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '"S";"Q";"K";"R";"Z";"D";"E";"O"',
      '',
    ]);
  });
});

describe('file names and json', () => {
  it('keeps letters, digits and hyphens only', () => {
    expect(reportFileName(report, 'csv')).toBe(
      'inhaltspruefung-KfBM21-2026-11-03.csv'
    );
    expect(
      reportFileName({ catalogCode: '../../x', generatedAt: 'kaputt' }, 'json')
    ).toBe('inhaltspruefung-x-bericht.json');
    expect(
      reportFileName({ catalogCode: '///', generatedAt: '2026-01-02' }, 'json')
    ).toBe('inhaltspruefung-katalog-2026-01-02.json');
  });

  it('the json is the report', () => {
    expect(JSON.parse(reportToJson(report))).toEqual(report);
  });
});
