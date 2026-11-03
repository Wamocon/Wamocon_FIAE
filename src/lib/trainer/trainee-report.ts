/**
 * The PDF report of one trainee (button "Export" on the detail page).
 *
 * It holds the same figures as the detail page (the overview of the trainee:
 * one progress value, one count of completed enablers) and an overview of the
 * modules per course, the lesson quizzes per course, the use cases, the
 * summaries and the global quizzes.
 *
 * Two steps: buildTraineeReport turns the overview into plain lines (pure, no
 * PDF library, tested on its own), renderTraineeReportPdf draws the lines
 * (word wrap, page breaks, page numbers). The text of the labels comes from
 * the caller (the translation system), nothing is hard wired here.
 */

import {
  formatReportDate,
  groupByCourse,
  courseHeading,
  submissionStatusTextKey,
} from '@/lib/trainer/trainee-detail-view';

type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

export interface ReportOverview {
  stats: {
    progressPct: number;
    completedEnablers: number;
    totalEnablers: number;
  };
  enablers: Array<{
    isActive: boolean;
    completed: boolean;
    courseId?: string;
    courseTitle?: string;
    courseCode?: string | null;
    summaryStatus?: string | null;
  }>;
  useCases: Array<{
    title: string;
    status: string | null;
    isActive: boolean;
    courseId?: string;
    courseTitle?: string;
  }>;
  enablerQuizzes: Array<{
    courseId?: string;
    courseTitle?: string;
    courseCode?: string | null;
    lastScore: number | null;
    attemptNumber: number | null;
  }>;
  summaries?: Array<{
    enablerTitle: string;
    courseTitle?: string;
    status: string;
    attemptNumber?: number | null;
    submittedAt?: string | null;
  }>;
  globalQuizzes: Array<{
    title: string;
    isActive: boolean;
    lastScore: number | null;
    attemptNumber: number | null;
  }>;
}

export interface ReportTrainee {
  fullName: string;
  startDate?: string | null;
  durationLabel: string;
}

export type ReportLine =
  | { kind: 'title'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'item'; text: string }
  | { kind: 'gap' };

const worked = (q: {
  lastScore: number | null;
  attemptNumber: number | null;
}) => (q.attemptNumber ?? 0) > 0 || typeof q.lastScore === 'number';

const mean = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;

export function buildTraineeReport(input: {
  trainee: ReportTrainee;
  overview: ReportOverview;
  t: Translate;
  locale: string;
  now?: Date;
}): ReportLine[] {
  const { trainee, overview, t, locale } = input;
  const dash = '—';
  const lines: ReportLine[] = [];
  const { stats } = overview;

  lines.push({
    kind: 'title',
    text: `${t('trainee.detail.pdfTrainee')} ${trainee.fullName}`,
  });
  lines.push({
    kind: 'text',
    text: `${t('trainee.detail.pdfCreatedOn')} ${formatReportDate(input.now ?? new Date(), locale)}`,
  });
  lines.push({ kind: 'gap' });
  lines.push({
    kind: 'text',
    text: `${t('trainee.detail.trainingStart')}: ${formatReportDate(trainee.startDate, locale)}`,
  });
  lines.push({
    kind: 'text',
    text: `${t('trainee.detail.durationYears')}: ${trainee.durationLabel}`,
  });

  // Quick figures: the same as the detail page
  const scores = overview.enablerQuizzes
    .map(q => q.lastScore)
    .filter((v): v is number => typeof v === 'number');
  const average = mean(scores);
  lines.push({ kind: 'gap' });
  lines.push({ kind: 'heading', text: t('trainee.detail.pdfQuickStats') });
  lines.push({
    kind: 'text',
    text: `${t('trainee.detail.pdfOverallProgress')} ${stats.progressPct}%`,
  });
  lines.push({
    kind: 'text',
    text: `${t('trainee.detail.pdfModulesCompleted')} ${stats.completedEnablers}/${stats.totalEnablers}`,
  });
  lines.push({
    kind: 'text',
    text: `${t('trainee.detail.pdfAverage')} ${average === null ? dash : `${average}%`}`,
  });

  // Modules per course
  const activeEnablers = overview.enablers.filter(e => e.isActive);
  const courseGroups = groupByCourse(
    activeEnablers,
    t('trainee.detail.unknownCourse')
  );
  lines.push({ kind: 'gap' });
  lines.push({ kind: 'heading', text: t('trainee.detail.modules') });
  if (courseGroups.length === 0) {
    lines.push({ kind: 'text', text: t('trainee.detail.noEnablers') });
  }
  for (const group of courseGroups) {
    const done = group.items.filter(e => e.completed).length;
    const total = group.items.length;
    const needRework = group.items.filter(
      e => e.summaryStatus === 'REJECTED'
    ).length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    lines.push({
      kind: 'item',
      text: t('trainee.detail.pdfCourseLine', {
        title: courseHeading(group, courseGroups),
        done,
        total,
        pct,
      }),
    });
    if (needRework > 0) {
      lines.push({
        kind: 'text',
        text: t('trainee.detail.pdfReworkLine', { count: needRework }),
      });
    }
  }

  // Lesson quizzes per course (678 single quizzes would fill 15 pages)
  lines.push({ kind: 'gap' });
  lines.push({ kind: 'heading', text: t('trainee.detail.lessonQuizzes') });
  const quizGroups = groupByCourse(
    overview.enablerQuizzes,
    t('trainee.detail.unknownCourse')
  );
  if (quizGroups.length === 0) {
    lines.push({ kind: 'text', text: t('trainee.detail.noEnablerQuizzes') });
  }
  for (const group of quizGroups) {
    const done = group.items.filter(worked).length;
    const groupScores = group.items
      .map(q => q.lastScore)
      .filter((v): v is number => typeof v === 'number');
    const groupAverage = mean(groupScores);
    lines.push({
      kind: 'item',
      text: t('trainee.detail.pdfQuizLine', {
        title: courseHeading(group, quizGroups),
        done,
        total: group.items.length,
        average: groupAverage === null ? dash : `${groupAverage}%`,
      }),
    });
  }

  // Use cases: the ones that were handed in, with their status
  const submittedUseCases = overview.useCases.filter(u => u.status);
  lines.push({ kind: 'gap' });
  lines.push({ kind: 'heading', text: t('trainee.detail.useCases') });
  lines.push({
    kind: 'text',
    text: t('trainee.detail.pdfSubmittedLine', {
      submitted: submittedUseCases.length,
      total: overview.useCases.length,
    }),
  });
  for (const u of submittedUseCases) {
    lines.push({
      kind: 'item',
      text: `${u.title}: ${t(submissionStatusTextKey(u.status))}`,
    });
  }

  // Summaries (with reflection) of the themes
  const summaries = overview.summaries ?? [];
  lines.push({ kind: 'gap' });
  lines.push({ kind: 'heading', text: t('trainee.detail.summaries') });
  lines.push({
    kind: 'text',
    text: t('trainee.detail.pdfSubmittedLine', {
      submitted: summaries.length,
      total: activeEnablers.length,
    }),
  });
  for (const s of summaries) {
    lines.push({
      kind: 'item',
      text: `${s.enablerTitle}: ${t(submissionStatusTextKey(s.status))}`,
    });
  }

  // Global quizzes
  const globals = overview.globalQuizzes.filter(q => q.isActive);
  lines.push({ kind: 'gap' });
  lines.push({ kind: 'heading', text: t('trainee.detail.globalQuizzes') });
  if (globals.length === 0) {
    lines.push({ kind: 'text', text: t('trainee.detail.noGlobalQuizzes') });
  }
  for (const q of globals) {
    const result =
      typeof q.lastScore === 'number'
        ? `${q.lastScore}%`
        : t('trainee.detail.notSubmitted');
    lines.push({ kind: 'item', text: `${q.title}: ${result}` });
  }

  return lines;
}

/**
 * Draws the lines on A4 pages with a page number at the bottom. Text the
 * standard font cannot encode (a symbol, an emoji) is replaced by a question
 * mark instead of making the export fail.
 */
export async function renderTraineeReportPdf(
  lines: ReportLine[],
  pageLabel: (page: number, pages: number) => string
): Promise<Uint8Array> {
  // loaded on demand to keep the bundle small and to stay off the server
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const LEFT = 50;
  const RIGHT = 50;
  const TOP = 800;
  const BOTTOM = 60;
  const maxWidth = PAGE_WIDTH - LEFT - RIGHT;

  const encodable = new Map<string, boolean>();
  const canEncode = (char: string) => {
    let known = encodable.get(char);
    if (known === undefined) {
      try {
        regular.encodeText(char);
        known = true;
      } catch {
        known = false;
      }
      encodable.set(char, known);
    }
    return known;
  };
  const clean = (text: string) =>
    Array.from(text.replace(/\s+/g, ' '))
      .map(char => (canEncode(char) ? char : '?'))
      .join('');

  const wrap = (
    text: string,
    font: typeof regular,
    size: number,
    indent: number
  ) => {
    const words = clean(text).split(' ').filter(Boolean);
    const rows: string[] = [];
    let row = '';
    for (const word of words) {
      const candidate = row ? `${row} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth - indent) {
        row = candidate;
        continue;
      }
      if (row) rows.push(row);
      // a single word wider than the line is cut
      let rest = word;
      while (
        font.widthOfTextAtSize(rest, size) > maxWidth - indent &&
        rest.length > 1
      ) {
        let cut = rest.length - 1;
        while (
          cut > 1 &&
          font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth - indent
        ) {
          cut -= 1;
        }
        rows.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      row = rest;
    }
    if (row) rows.push(row);
    return rows;
  };

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = TOP;
  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = TOP;
  };

  for (const line of lines) {
    if (line.kind === 'gap') {
      y -= 10;
      continue;
    }
    const style =
      line.kind === 'title'
        ? { font: bold, size: 18, gap: 24, indent: 0, prefix: '' }
        : line.kind === 'heading'
          ? { font: bold, size: 13, gap: 19, indent: 0, prefix: '' }
          : line.kind === 'item'
            ? { font: regular, size: 11, gap: 15, indent: 12, prefix: '- ' }
            : { font: regular, size: 11, gap: 15, indent: 0, prefix: '' };
    const rows = wrap(
      `${style.prefix}${line.text}`,
      style.font,
      style.size,
      style.indent
    );
    // a heading is never the last line of a page
    const needed =
      rows.length * style.gap + (line.kind === 'heading' ? 2 * style.gap : 0);
    if (y - needed < BOTTOM) newPage();
    for (const row of rows) {
      page.drawText(row, {
        x: LEFT + style.indent,
        y,
        size: style.size,
        font: style.font,
      });
      y -= style.gap;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    const label = clean(pageLabel(index + 1, pages.length));
    const width = regular.widthOfTextAtSize(label, 9);
    p.drawText(label, {
      x: (PAGE_WIDTH - width) / 2,
      y: 30,
      size: 9,
      font: regular,
    });
  });

  return pdf.save();
}
