import {
  ENABLER_SUMMARY_INTRO,
  ENABLER_SUMMARY_MAX,
  ENABLER_SUMMARY_MAX_TOPICS,
  enablerSummaryIntro,
  summarizeEnablerText,
} from '@/lib/content-import/enabler-summary';
import type { Paragraph } from '@/lib/content-import/types';

// Invented enabler texts in the shape of the source: a table of contents with
// page numbers, the teaching text with the main headings as plain lines, the
// subheadings in bold and tables whose cells are paragraphs with a row mark.
const plain = (text: string): Paragraph => ({ text, bold: false });
const bold = (text: string): Paragraph => ({ text, bold: true });
const cell = (
  text: string,
  row = 1,
  cellNo = 1,
  isBold = false
): Paragraph => ({
  text,
  bold: isBold,
  row,
  cell: cellNo,
});
const LEAD =
  'Erfundene Büros brauchen verlässliche Abläufe, damit Termine eingehalten werden. ' +
  'Dazu gehören klare Zuständigkeiten, feste Fristen und eine saubere Ablage der Unterlagen. ' +
  'Der folgende Text erklärt die Grundlagen Schritt für Schritt.';
const TITLE = 'Erfundene Termine planen';

function document(mains: string[], body: Paragraph[]): Paragraph[] {
  return [
    plain('Inhaltsverzeichnis'),
    plain('Überblick\t2'),
    ...mains.map((m, i) => plain(`${m}\t${i + 2}`)),
    plain('Überblick'),
    plain(LEAD),
    ...body,
  ];
}

const lines = (text: string | null) => (text ?? '').split('\n');

describe('enablerSummaryIntro', () => {
  it('is the most frequent FIAE form with the title in quotes', () => {
    expect(enablerSummaryIntro('Termine planen')).toBe(
      'In diesem Modul "Termine planen" werden folgende Inhalte behandelt:'
    );
  });

  it('uses the other FIAE form without a title when there is none or it is too long', () => {
    expect(enablerSummaryIntro(null)).toBe(ENABLER_SUMMARY_INTRO);
    expect(enablerSummaryIntro('  ')).toBe(ENABLER_SUMMARY_INTRO);
    expect(enablerSummaryIntro('x'.repeat(121))).toBe(ENABLER_SUMMARY_INTRO);
    expect(ENABLER_SUMMARY_INTRO).toBe(
      'In dieser Datei werden folgende Themen behandelt:'
    );
  });

  it('does not break the quotes of the line', () => {
    expect(enablerSummaryIntro('Das "Wort"')).toBe(
      'In diesem Modul "Das \'Wort\'" werden folgende Inhalte behandelt:'
    );
  });
});

describe('summarizeEnablerText: the topics', () => {
  const doc = document(
    ['Termine planen', 'Fristen überwachen'],
    [
      plain('Termine planen'),
      plain('Ein erster Absatz Text, der kein Thema ist.'),
      bold('Terminarten'),
      bold('Quelle: Erfundenes Buch, S. 12'),
      bold('Tabelle 1: Terminarten'),
      cell('Termin', 1, 1, true),
      cell('Grund', 1, 2, true),
      bold('Beispiele'),
      bold('Erläuterung'),
      bold('Terminarten'),
      bold('3'),
      plain('Fristen überwachen'),
      bold('Fristen im Alltag'),
      bold('Gesamtquelle des Enablers: Erfundenes Buch'),
      bold('Ein ganzer Satz in Fettschrift, der keine Überschrift ist.'),
      plain('Zeile, die nicht fett ist und kein Thema'),
    ]
  );
  const out = summarizeEnablerText(doc, TITLE);

  it('is the intro line, a blank line and the list, one topic per line with a hyphen', () => {
    expect(lines(out)).toEqual([
      'In diesem Modul "Erfundene Termine planen" werden folgende Inhalte behandelt:',
      '',
      '- Termine planen',
      '- Terminarten',
      '- Fristen überwachen',
      '- Fristen im Alltag',
    ]);
  });

  it('takes main headings and subheadings in the order of the text, each once', () => {
    expect(out).toContain(
      '- Termine planen\n- Terminarten\n- Fristen überwachen'
    );
    expect(out?.match(/Terminarten/g)).toHaveLength(1);
  });

  it('leaves out filler headings, source notes, table captions, page numbers and table cells', () => {
    for (const unwanted of [
      'Überblick',
      'Quelle',
      'Gesamtquelle',
      'Tabelle 1',
      'Beispiele',
      'Erläuterung',
      'Grund',
      'Ein ganzer Satz',
      '\t',
      '- 3',
    ]) {
      expect(out).not.toContain(unwanted);
    }
  });

  it('has the length of a FIAE description and no dash in the running text', () => {
    expect((out as string).length).toBeLessThanOrEqual(ENABLER_SUMMARY_MAX);
    expect(out).not.toMatch(/[–—]/);
  });

  it('is the same every time', () => {
    expect(summarizeEnablerText(doc, TITLE)).toBe(out);
  });
});

describe('summarizeEnablerText: more topics than fit', () => {
  const mains = ['Haupt A', 'Haupt B', 'Haupt C'];
  const subs = Array.from({ length: 30 }, (_, i) => `Unterthema ${i + 1}`);
  const body: Paragraph[] = [];
  mains.forEach((m, i) => {
    body.push(plain(m));
    subs.slice(i * 10, i * 10 + 10).forEach(s => body.push(bold(s)));
  });
  const out = summarizeEnablerText(document(mains, body), TITLE) as string;
  const topics = lines(out).filter(l => l.startsWith('- '));

  it('keeps at most 12 topics', () => {
    expect(topics).toHaveLength(ENABLER_SUMMARY_MAX_TOPICS);
  });

  it('keeps all main headings and spreads the free places over the subheadings', () => {
    for (const m of mains) expect(topics).toContain(`- ${m}`);
    const picked = topics
      .filter(t => t.startsWith('- Unterthema'))
      .map(t => Number(t.replace('- Unterthema ', '')));
    expect(picked).toHaveLength(9);
    // spread over the whole text, not the first nine
    expect(Math.max(...picked)).toBeGreaterThan(25);
    expect(Math.min(...picked)).toBeLessThan(5);
    expect([...picked].sort((a, b) => a - b)).toEqual(picked);
  });

  it('keeps the order of the text', () => {
    const order = topics.map(t => t.slice(2));
    const text = body.map(p => p.text);
    const positions = order.map(t => text.indexOf(t));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('cuts the list down when long headings would exceed the limit, never inside a topic', () => {
    const long = Array.from(
      { length: 20 },
      (_, i) => `Erfundenes Unterthema mit einem recht langen Titel ${i + 1}`
    );
    const result = summarizeEnablerText(
      document(['Haupt'], [plain('Haupt'), ...long.map(bold)]),
      TITLE
    ) as string;
    expect(result.length).toBeLessThanOrEqual(ENABLER_SUMMARY_MAX);
    for (const topic of lines(result).filter(l => l.startsWith('- '))) {
      expect(['Haupt', ...long]).toContain(topic.slice(2));
    }
  });
});

describe('summarizeEnablerText: documents without subheadings', () => {
  it('uses the headings of the table of contents', () => {
    const out = summarizeEnablerText(
      document(['Termine planen', 'Fristen überwachen'], []),
      TITLE
    );
    expect(lines(out).slice(2)).toEqual([
      '- Termine planen',
      '- Fristen überwachen',
    ]);
  });

  it('accepts dotted leaders and numbered headings in the table of contents', () => {
    const out = summarizeEnablerText(
      [
        plain('Inhaltsverzeichnis'),
        plain('1. Termine planen ........ 3'),
        plain('2.1 Fristen überwachen\t4'),
      ],
      TITLE
    );
    expect(lines(out).slice(2)).toEqual([
      '- Termine planen',
      '- Fristen überwachen',
    ]);
  });

  it('takes strings as well as paragraphs', () => {
    expect(
      summarizeEnablerText(['Inhaltsverzeichnis', 'Termine planen\t2'], TITLE)
    ).toContain('- Termine planen');
  });
});

describe('summarizeEnablerText: documents without any heading', () => {
  it('uses the first sentences of the first paragraph of running text', () => {
    const out = summarizeEnablerText(
      [plain('Kurze Zeile ohne Punkt'), plain('Quelle: x'), plain(LEAD)],
      TITLE
    );
    expect(out).toBe(LEAD.split('. ').slice(0, 2).join('. ') + '.');
  });

  it('is its own description when it is short', () => {
    expect(
      summarizeEnablerText(
        [plain('Erfundener Lehrtext.'), plain('Zweiter Absatz.')],
        TITLE
      )
    ).toBe('Erfundener Lehrtext.\n\nZweiter Absatz.');
  });

  it('returns null for an empty document or one with only generic parts', () => {
    expect(summarizeEnablerText([], TITLE)).toBeNull();
    expect(summarizeEnablerText([plain('  '), plain('')], TITLE)).toBeNull();
    expect(
      summarizeEnablerText(
        [plain('Inhaltsverzeichnis'), plain('Überblick\t2')],
        TITLE
      )
    ).toBeNull();
  });
});

describe('summarizeEnablerText: no solution marker', () => {
  it('drops headings and sentences that carry a marker', () => {
    const out = summarizeEnablerText(
      document(
        ['Termine planen', 'Musterlösung: Termine'],
        [
          plain('Termine planen'),
          bold('Richtige Antwort'),
          bold('Lösungsszenario'),
          bold('Fristen im Alltag'),
        ]
      ),
      TITLE
    ) as string;
    expect(out).not.toMatch(/Musterlösung|Richtige Antwort|Lösungsszenario/);
    expect(out).toContain('- Termine planen');
    expect(out).toContain('- Fristen im Alltag');
  });

  it('drops a sentence with a marker from the lead of a document without headings', () => {
    const out = summarizeEnablerText(
      [
        plain(
          'Richtige Antwort: B. Dieser Satz gehört nicht in den Text, so lang er auch ist und bleibt. Erfundene Büros brauchen Abläufe.'
        ),
      ],
      TITLE
    ) as string;
    expect(out).not.toMatch(/Richtige Antwort/);
  });
});

describe('summarizeEnablerText: edge cases', () => {
  it('does not take a bold subheading "Inhalt" for a table of contents', () => {
    const out = summarizeEnablerText(
      [
        bold('Netzwerke'),
        plain('Ein Absatz Text.'),
        bold('Inhalt'),
        bold('Switches'),
      ],
      TITLE
    );
    expect(lines(out).slice(2)).toEqual(['- Netzwerke', '- Switches']);
  });

  it('keeps a number that belongs to the heading and strips a list number', () => {
    const out = summarizeEnablerText(
      [bold('3 Gründe für Cloud'), bold('2.1 Fristen'), bold('4. Ablage')],
      TITLE
    );
    expect(lines(out).slice(2)).toEqual([
      '- 3 Gründe für Cloud',
      '- Fristen',
      '- Ablage',
    ]);
  });

  it('answers a line with a very long run of white space at once', () => {
    const started = Date.now();
    const out = summarizeEnablerText(
      [
        plain('Inhaltsverzeichnis'),
        plain(`Thema${' '.repeat(60000)}x`),
        plain('Termine planen	2'),
        bold('Fristen'),
      ],
      TITLE
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out).toContain('- Fristen');
  });
});
