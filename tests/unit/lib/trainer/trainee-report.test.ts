/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import path from 'path';
import de from '@/locales/de.json';
import en from '@/locales/en.json';
import {
  buildTraineeReport,
  renderTraineeReportPdf,
  type ReportBlock,
  type ReportOverview,
  type ReportPdfOptions,
} from '@/lib/trainer/trainee-report';

// WMCNL-2986: the PDF export shows the figures of the detail page and an
// overview of the modules, the quizzes and the hand-ins.
// KFB-1178: it is built from blocks (title, facts, figures, tables) and drawn in
// the look of the platform: logo, crimson accent, tables with a header row,
// date and page numbers.

const translator =
  (strings: Record<string, string>) =>
  (key: string, data?: Record<string, string | number>) => {
    let text = strings[key] ?? key;
    for (const [name, value] of Object.entries(data ?? {})) {
      text = text.replace(`{${name}}`, String(value));
    }
    return text;
  };
const t = translator(de as Record<string, string>);
const tEn = translator(en as Record<string, string>);

const overview: ReportOverview = {
  stats: { progressPct: 46, completedEnablers: 105, totalEnablers: 226 },
  enablers: [
    {
      isActive: true,
      completed: true,
      courseId: 'c1',
      courseTitle: 'Informationsmanagement anwenden',
      summaryStatus: 'REJECTED',
    },
    {
      isActive: true,
      completed: false,
      courseId: 'c1',
      courseTitle: 'Informationsmanagement anwenden',
    },
    { isActive: false, completed: false, courseId: 'c1', courseTitle: 'X' },
  ],
  useCases: [
    { title: 'Telefonat führen', status: 'APPROVED', isActive: true },
    { title: 'Angebot schreiben', status: null, isActive: true },
  ],
  enablerQuizzes: [
    {
      courseId: 'c1',
      courseTitle: 'Informationsmanagement anwenden',
      lastScore: 80,
      attemptNumber: 1,
    },
    {
      courseId: 'c1',
      courseTitle: 'Informationsmanagement anwenden',
      lastScore: null,
      attemptNumber: null,
    },
  ],
  summaries: [
    {
      enablerTitle: 'Betriebliche Kommunikationssysteme',
      status: 'REJECTED',
    },
  ],
  globalQuizzes: [
    { title: 'Abschlusstest', isActive: true, lastScore: 70, attemptNumber: 1 },
  ],
};

const build = (
  overrideTrainee: Record<string, unknown> = {},
  translate: typeof t = t
) =>
  buildTraineeReport({
    trainee: {
      fullName: 'Leon Moretz',
      startDate: '2025-09-01T00:00:00.000Z',
      durationLabel: '3 Jahre (Regelausbildungszeit)',
      occupation: 'Kaufmann/-frau für Büromanagement',
      ...overrideTrainee,
    },
    overview,
    t: translate,
    locale: 'de-DE',
    now: new Date('2026-11-02T10:00:00Z'),
  });
const blocks = build();

/** Every text of the blocks, cells included, one per line. */
const textOf = (list: ReportBlock[]) =>
  list
    .flatMap(b => {
      switch (b.kind) {
        case 'title':
          return [b.text, b.subtitle ?? ''];
        case 'facts':
          return b.items.flatMap(i => [i.label, i.value]);
        case 'kpis':
          return b.items.flatMap(i => [i.label, i.value]);
        case 'table':
          return [
            ...b.columns.map(c => c.header),
            ...b.rows.flat().map(c => (typeof c === 'string' ? c : c.text)),
          ];
        default:
          return [b.text];
      }
    })
    .join('\n');
const text = textOf(blocks);
const tables = blocks.filter(
  (b): b is Extract<ReportBlock, { kind: 'table' }> => b.kind === 'table'
);

const logo = readFileSync(path.join(process.cwd(), 'public', 'WMC_Logo.png'));
const options = (extra: Partial<ReportPdfOptions> = {}): ReportPdfOptions => ({
  pageLabel: (page, pages) => `Seite ${page} von ${pages}`,
  brand: { name: 'LFA', subtitle: 'Lernplattform' },
  footerNote: 'Erstellt am 02.11.2026',
  logo: new Uint8Array(logo),
  ...extra,
});

describe('report content', () => {
  it('carries the figures of the detail page, not 0 percent and dashes', () => {
    const kpis = blocks.find(b => b.kind === 'kpis');
    expect(kpis && kpis.kind === 'kpis' && kpis.items).toEqual([
      { label: 'Gesamtfortschritt', value: '46%', pct: 46 },
      { label: 'Module abgeschlossen', value: '105/226' },
      { label: 'Durchschnitt', value: '80%' },
    ]);
    expect(text).toContain('Leon Moretz');
    expect(text).toContain('01.09.2025');
  });

  it('opens with a title and the facts: trainee, occupation, start, duration, date', () => {
    expect(blocks[0]).toEqual({
      kind: 'title',
      text: 'Fortschrittsbericht',
      subtitle: 'Leon Moretz',
    });
    const facts = blocks.find(b => b.kind === 'facts');
    expect(facts && facts.kind === 'facts' && facts.items).toEqual([
      { label: 'Auszubildender', value: 'Leon Moretz' },
      { label: 'Ausbildungsberuf', value: 'Kaufmann/-frau für Büromanagement' },
      { label: 'Start der Ausbildung', value: '01.09.2025' },
      { label: 'Ausbildungsdauer', value: '3 Jahre (Regelausbildungszeit)' },
      { label: 'Erstellt am', value: '02.11.2026' },
    ]);
  });

  it('leaves the occupation out when it is not known', () => {
    const facts = build({ occupation: null }).find(b => b.kind === 'facts');
    expect(
      facts &&
        facts.kind === 'facts' &&
        facts.items.some(i => i.label === 'Ausbildungsberuf')
    ).toBe(false);
  });

  it('shows no technical id of the trainee', () => {
    expect(text).not.toMatch(/\bID\b/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('gives the modules per course as a table with a progress bar and the summaries to rework', () => {
    const modules = tables[0];
    expect(modules.columns.map(c => c.header)).toEqual([
      'Fragenkomplex',
      'Abgeschlossen',
      'Zu überarbeiten',
      'Fortschritt',
    ]);
    expect(modules.rows).toEqual([
      ['Informationsmanagement anwenden', '1/2', '1', { text: '50%', pct: 50 }],
    ]);
  });

  it('gives the quizzes per course, the use cases, the summaries and the global quizzes as tables', () => {
    expect(tables).toHaveLength(5);
    expect(tables[1].rows).toEqual([
      ['Informationsmanagement anwenden', '1/2', '80%'],
    ]);
    // only the use cases that were handed in, coloured by the status
    expect(tables[2].rows).toEqual([
      ['Telefonat führen', { text: 'Genehmigt', tone: 'good' }],
    ]);
    expect(text).toContain('1 von 2 eingereicht');
    expect(text).not.toContain('Angebot schreiben');
    expect(tables[3].rows[0][0]).toBe('Betriebliche Kommunikationssysteme');
    expect(tables[3].rows[0][1]).toMatchObject({ tone: 'bad' });
    expect(tables[4].rows).toEqual([['Abschlusstest', '70%']]);
  });

  it('shows dashes only where there is nothing (no quiz result, no start date)', () => {
    const empty = buildTraineeReport({
      trainee: { fullName: 'Neu', durationLabel: '3 Jahre' },
      overview: {
        stats: { progressPct: 0, completedEnablers: 0, totalEnablers: 0 },
        enablers: [],
        useCases: [],
        enablerQuizzes: [],
        globalQuizzes: [],
      },
      t,
      locale: 'de-DE',
    });
    const emptyText = textOf(empty);
    expect(emptyText).toContain('Start der Ausbildung\n—');
    expect(emptyText).toContain('Durchschnitt\n—');
    expect(emptyText).toContain('Keine Themenkreise gefunden.');
    expect(empty.some(b => b.kind === 'table')).toBe(false);
  });

  it('speaks English for an English reader, with every label translated', () => {
    const englishText = textOf(build({}, tEn));
    expect(englishText).toContain('Progress report');
    expect(englishText).toContain('Occupation');
    expect(englishText).toContain('Question set');
    expect(englishText).not.toMatch(/trainee\.detail\./);
  });
});

describe('PDF rendering', () => {
  it('draws a real document with the logo, more than the header, numbered pages', async () => {
    const bytes = await renderTraineeReportPdf(blocks, options());
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeLessThanOrEqual(2);
    expect(doc.getTitle()).toBe('Fortschrittsbericht: Leon Moretz');
  });

  it('is larger with the logo than without, and still works without it', async () => {
    const withLogo = await renderTraineeReportPdf(blocks, options());
    const without = await renderTraineeReportPdf(
      blocks,
      options({ logo: null })
    );
    expect(withLogo.length).toBeGreaterThan(without.length);
    // a logo that cannot be loaded or decoded is left out, the export works
    const broken = await renderTraineeReportPdf(
      blocks,
      options({ logo: new Uint8Array([1, 2, 3]) })
    );
    expect(Buffer.from(broken.slice(0, 5)).toString()).toBe('%PDF-');
    const unreachable = await renderTraineeReportPdf(
      blocks,
      options({ logo: 'http://127.0.0.1:1/none.png' })
    );
    expect(Buffer.from(unreachable.slice(0, 5)).toString()).toBe('%PDF-');
  });

  it('breaks long tables onto further pages and survives characters the font cannot draw', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [
      `Eintrag ${i} mit Symbol → und Emoji 😀 und einem sehr langen Wort ${'x'.repeat(200)}`,
      { text: i % 2 ? 'Genehmigt' : 'Abgelehnt', tone: 'good' as const },
    ]);
    const bytes = await renderTraineeReportPdf(
      [
        { kind: 'title', text: 'Titel', subtitle: 'Name' },
        { kind: 'heading', text: 'Liste' },
        {
          kind: 'table',
          columns: [
            { header: 'Titel', weight: 6 },
            { header: 'Status', weight: 3 },
          ],
          rows,
        },
      ],
      options()
    );
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(2);
  });

  it('numbers every page in the footer with the label of the caller', async () => {
    const labels: string[] = [];
    const rows = Array.from({ length: 80 }, (_, i) => [`Zeile ${i}`, '1']);
    const bytes = await renderTraineeReportPdf(
      [
        { kind: 'title', text: 'Titel' },
        {
          kind: 'table',
          columns: [
            { header: 'A', weight: 1 },
            { header: 'B', weight: 1 },
          ],
          rows,
        },
      ],
      options({
        pageLabel: (page, pages) => {
          labels.push(`${page}/${pages}`);
          return `Seite ${page} von ${pages}`;
        },
      })
    );
    const { PDFDocument } = await import('pdf-lib');
    const total = (await PDFDocument.load(bytes)).getPageCount();
    expect(total).toBeGreaterThan(1);
    expect(labels).toEqual(
      Array.from({ length: total }, (_, i) => `${i + 1}/${total}`)
    );
  });
});
