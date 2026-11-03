/**
 * @jest-environment node
 */
import de from '@/locales/de.json';
import {
  buildTraineeReport,
  renderTraineeReportPdf,
  type ReportOverview,
} from '@/lib/trainer/trainee-report';

// WMCNL-2986: the PDF export shows the figures of the detail page and an
// overview of the modules, the quizzes and the hand-ins.

const strings = de as Record<string, string>;
const t = (key: string, data?: Record<string, string | number>) => {
  let text = strings[key] ?? key;
  for (const [name, value] of Object.entries(data ?? {})) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
};

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

const lines = buildTraineeReport({
  trainee: {
    fullName: 'Leon Moretz',
    startDate: '2025-09-01T00:00:00.000Z',
    durationLabel: '3 Jahre (Regelausbildungszeit)',
  },
  overview,
  t,
  locale: 'de-DE',
  now: new Date('2026-11-02T10:00:00Z'),
});
const text = lines.map(l => ('text' in l ? l.text : '')).join('\n');

describe('report content', () => {
  it('carries the figures of the detail page, not 0 percent and dashes', () => {
    expect(text).toContain('Auszubildender: Leon Moretz');
    expect(text).toContain('Gesamtfortschritt: 46%');
    expect(text).toContain('Module abgeschlossen: 105/226');
    expect(text).toContain('Start der Ausbildung: 01.09.2025');
    expect(text).toContain('Durchschnitt: 80%');
  });

  it('shows no technical id of the trainee', () => {
    expect(text).not.toMatch(/\bID:/);
  });

  it('gives the modules per course and names the summaries to rework', () => {
    expect(text).toContain(
      'Informationsmanagement anwenden: 1 von 2 abgeschlossen (50 %)'
    );
    expect(text).toContain('Überarbeitung erforderlich bei 1 Zusammenfassung');
  });

  it('gives the quizzes per course, the use cases, the summaries and the global quizzes', () => {
    expect(text).toContain(
      'Informationsmanagement anwenden: 1 von 2 Quizzen bearbeitet, Durchschnitt 80%'
    );
    expect(text).toContain('1 von 2 eingereicht');
    expect(text).toContain('Telefonat führen: Genehmigt');
    expect(text).not.toContain('Angebot schreiben');
    expect(text).toContain(
      'Betriebliche Kommunikationssysteme: Überarbeitung erforderlich'
    );
    expect(text).toContain('Abschlusstest: 70%');
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
    const emptyText = empty.map(l => ('text' in l ? l.text : '')).join('\n');
    expect(emptyText).toContain('Start der Ausbildung: —');
    expect(emptyText).toContain('Durchschnitt: —');
    expect(emptyText).toContain('Keine Themenkreise gefunden.');
  });
});

describe('PDF rendering', () => {
  it('draws a real document with more than the header, numbered pages', async () => {
    const bytes = await renderTraineeReportPdf(
      lines,
      (page, pages) => `Seite ${page} von ${pages}`
    );
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('breaks long lists onto further pages and survives characters the font cannot draw', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      kind: 'item' as const,
      text: `Eintrag ${i} mit Symbol → und Emoji 😀 und einem sehr langen Wort ${'x'.repeat(200)}`,
    }));
    const bytes = await renderTraineeReportPdf(
      [{ kind: 'title', text: 'Titel' }, ...many],
      (page, pages) => `Seite ${page} von ${pages}`
    );
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});
