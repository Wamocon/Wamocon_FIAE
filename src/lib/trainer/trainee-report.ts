/**
 * The PDF report of one trainee (button "Export" on the detail page).
 *
 * It holds the same figures as the detail page (the overview of the trainee:
 * one progress value, one count of completed enablers) and an overview of the
 * modules per course, the lesson quizzes per course, the use cases, the
 * summaries and the global quizzes.
 *
 * Two steps: buildTraineeReport turns the overview into plain blocks (title,
 * facts, figures, headings, tables: pure, no PDF library, tested on its own),
 * renderTraineeReportPdf draws them in the look of the platform (KFB-1178): the
 * logo and the name of the platform in the header, the crimson of the app as
 * accent colour, tables with a header row that repeats on every page, the date
 * and the page number in the footer. The text of the labels comes from the
 * caller (the translation system), nothing is hard wired here.
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
  /** Name of the occupation (the chosen tab), shown when known. */
  occupation?: string | null;
}

/** A table cell: text, or text with a progress bar or a tone for a status. */
export type ReportCell =
  | string
  | { text: string; pct?: number; tone?: 'good' | 'bad' };

export interface ReportColumn {
  header: string;
  /** Share of the table width (relative weight). */
  weight: number;
  align?: 'left' | 'right';
}

export type ReportBlock =
  | { kind: 'title'; text: string; subtitle?: string }
  | { kind: 'facts'; items: Array<{ label: string; value: string }> }
  | {
      kind: 'kpis';
      items: Array<{ label: string; value: string; pct?: number }>;
    }
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'table'; columns: ReportColumn[]; rows: ReportCell[][] };

const worked = (q: {
  lastScore: number | null;
  attemptNumber: number | null;
}) => (q.attemptNumber ?? 0) > 0 || typeof q.lastScore === 'number';

const mean = (values: number[]) =>
  values.length
    ? Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
    : null;

/** "Gesamtfortschritt:" and "Gesamtfortschritt" are the same label. */
const label = (text: string) => text.replace(/\s*:\s*$/, '');

const statusTone = (status: string | null | undefined) => {
  const value = String(status ?? '').toUpperCase();
  return value === 'APPROVED'
    ? 'good'
    : value === 'REJECTED'
      ? 'bad'
      : undefined;
};

export function buildTraineeReport(input: {
  trainee: ReportTrainee;
  overview: ReportOverview;
  t: Translate;
  locale: string;
  now?: Date;
}): ReportBlock[] {
  const { trainee, overview, t, locale } = input;
  const dash = '—';
  const blocks: ReportBlock[] = [];
  const { stats } = overview;
  const unknownCourse = t('trainee.detail.unknownCourse');

  // Title and the facts about the trainee. The id of the trainee is not shown.
  blocks.push({
    kind: 'title',
    text: t('trainee.detail.pdfReportTitle'),
    subtitle: trainee.fullName,
  });
  const facts = [
    { label: label(t('trainee.detail.pdfTrainee')), value: trainee.fullName },
  ];
  if (trainee.occupation) {
    facts.push({
      label: t('trainee.detail.pdfOccupation'),
      value: trainee.occupation,
    });
  }
  facts.push(
    {
      label: label(t('trainee.detail.trainingStart')),
      value: formatReportDate(trainee.startDate, locale),
    },
    {
      label: label(t('trainee.detail.durationYears')),
      value: trainee.durationLabel,
    },
    {
      label: t('trainee.detail.pdfCreatedOn'),
      value: formatReportDate(input.now ?? new Date(), locale),
    }
  );
  blocks.push({ kind: 'facts', items: facts });

  // Quick figures: the same as the detail page
  const scores = overview.enablerQuizzes
    .map(q => q.lastScore)
    .filter((v): v is number => typeof v === 'number');
  const average = mean(scores);
  blocks.push({ kind: 'heading', text: t('trainee.detail.pdfQuickStats') });
  blocks.push({
    kind: 'kpis',
    items: [
      {
        label: label(t('trainee.detail.pdfOverallProgress')),
        value: `${stats.progressPct}%`,
        pct: stats.progressPct,
      },
      {
        label: label(t('trainee.detail.pdfModulesCompleted')),
        value: `${stats.completedEnablers}/${stats.totalEnablers}`,
      },
      {
        label: label(t('trainee.detail.pdfAverage')),
        value: average === null ? dash : `${average}%`,
      },
    ],
  });

  // Modules per course
  const activeEnablers = overview.enablers.filter(e => e.isActive);
  const courseGroups = groupByCourse(activeEnablers, unknownCourse);
  blocks.push({ kind: 'heading', text: t('trainee.detail.modules') });
  if (courseGroups.length === 0) {
    blocks.push({ kind: 'text', text: t('trainee.detail.noEnablers') });
  } else {
    blocks.push({
      kind: 'table',
      columns: [
        { header: t('trainee.detail.pdfColCourse'), weight: 4.5 },
        {
          header: t('trainee.detail.pdfColCompleted'),
          weight: 2.8,
          align: 'right',
        },
        {
          header: t('trainee.detail.pdfColRework'),
          weight: 2.8,
          align: 'right',
        },
        { header: t('trainee.detail.pdfColProgress'), weight: 3 },
      ],
      rows: courseGroups.map(group => {
        const done = group.items.filter(e => e.completed).length;
        const total = group.items.length;
        const rework = group.items.filter(
          e => e.summaryStatus === 'REJECTED'
        ).length;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        return [
          courseHeading(group, courseGroups),
          `${done}/${total}`,
          String(rework),
          { text: `${pct}%`, pct },
        ];
      }),
    });
  }

  // Lesson quizzes per course (678 single quizzes would fill 15 pages)
  blocks.push({ kind: 'heading', text: t('trainee.detail.lessonQuizzes') });
  const quizGroups = groupByCourse(overview.enablerQuizzes, unknownCourse);
  if (quizGroups.length === 0) {
    blocks.push({ kind: 'text', text: t('trainee.detail.noEnablerQuizzes') });
  } else {
    blocks.push({
      kind: 'table',
      columns: [
        { header: t('trainee.detail.pdfColCourse'), weight: 5 },
        { header: t('trainee.detail.pdfColWorked'), weight: 2, align: 'right' },
        {
          header: label(t('trainee.detail.pdfAverage')),
          weight: 2,
          align: 'right',
        },
      ],
      rows: quizGroups.map(group => {
        const done = group.items.filter(worked).length;
        const groupAverage = mean(
          group.items
            .map(q => q.lastScore)
            .filter((v): v is number => typeof v === 'number')
        );
        return [
          courseHeading(group, quizGroups),
          `${done}/${group.items.length}`,
          groupAverage === null ? dash : `${groupAverage}%`,
        ];
      }),
    });
  }

  // Use cases: the ones that were handed in, with their status
  const submittedUseCases = overview.useCases.filter(u => u.status);
  blocks.push({ kind: 'heading', text: t('trainee.detail.useCases') });
  blocks.push({
    kind: 'text',
    text: t('trainee.detail.pdfSubmittedLine', {
      submitted: submittedUseCases.length,
      total: overview.useCases.length,
    }),
  });
  if (submittedUseCases.length > 0) {
    blocks.push({
      kind: 'table',
      columns: [
        { header: t('trainee.detail.pdfColTitle'), weight: 6 },
        { header: t('trainee.detail.pdfColStatus'), weight: 3 },
      ],
      rows: submittedUseCases.map(u => [
        u.title,
        {
          text: t(submissionStatusTextKey(u.status)),
          tone: statusTone(u.status),
        },
      ]),
    });
  }

  // Summaries (with reflection) of the themes
  const summaries = overview.summaries ?? [];
  blocks.push({ kind: 'heading', text: t('trainee.detail.summaries') });
  blocks.push({
    kind: 'text',
    text: t('trainee.detail.pdfSubmittedLine', {
      submitted: summaries.length,
      total: activeEnablers.length,
    }),
  });
  if (summaries.length > 0) {
    blocks.push({
      kind: 'table',
      columns: [
        { header: t('trainee.detail.pdfColTitle'), weight: 6 },
        { header: t('trainee.detail.pdfColStatus'), weight: 3 },
      ],
      rows: summaries.map(s => [
        s.enablerTitle,
        {
          text: t(submissionStatusTextKey(s.status)),
          tone: statusTone(s.status),
        },
      ]),
    });
  }

  // Global quizzes
  const globals = overview.globalQuizzes.filter(q => q.isActive);
  blocks.push({ kind: 'heading', text: t('trainee.detail.globalQuizzes') });
  if (globals.length === 0) {
    blocks.push({ kind: 'text', text: t('trainee.detail.noGlobalQuizzes') });
  } else {
    blocks.push({
      kind: 'table',
      columns: [
        { header: t('trainee.detail.pdfColTitle'), weight: 6 },
        { header: t('trainee.detail.pdfColResult'), weight: 3, align: 'right' },
      ],
      rows: globals.map(q => [
        q.title,
        typeof q.lastScore === 'number'
          ? `${q.lastScore}%`
          : t('trainee.detail.notSubmitted'),
      ]),
    });
  }

  return blocks;
}

export interface ReportPdfOptions {
  /** Text of the page number, for example "Seite 1 von 3". */
  pageLabel: (page: number, pages: number) => string;
  /** Name of the platform in the header and the footer. */
  brand: { name: string; subtitle: string };
  /** Text in the footer after the name of the platform, for example the date. */
  footerNote?: string;
  /** PNG of the logo (bytes) or the address to load it from. Optional. */
  logo?: Uint8Array | string | null;
}

async function loadLogo(
  logo: Uint8Array | string | null | undefined
): Promise<Uint8Array | null> {
  if (!logo) return null;
  if (typeof logo !== 'string') return logo;
  try {
    const response = await fetch(logo);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Draws the blocks on A4 pages. The look follows the platform: the crimson of
 * the app (globals.css, light theme accent) as the one accent colour, onyx and
 * grey for text, cards and tables. Header: logo and platform name on the first
 * page, a slim running header on the others. Footer on every page: platform,
 * date, page number. Text the standard font cannot encode (a symbol, an emoji)
 * is replaced by a question mark instead of making the export fail.
 */
export async function renderTraineeReportPdf(
  blocks: ReportBlock[],
  options: ReportPdfOptions
): Promise<Uint8Array> {
  // loaded on demand to keep the bundle small and to stay off the server
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  type Font = typeof regular;

  const hex = (value: string) =>
    rgb(
      parseInt(value.slice(1, 3), 16) / 255,
      parseInt(value.slice(3, 5), 16) / 255,
      parseInt(value.slice(5, 7), 16) / 255
    );
  // The palette of the platform (src/app/globals.css)
  const CRIMSON = hex('#e61919');
  const ONYX = hex('#0a0a0a');
  const CHARCOAL = hex('#141414');
  const TEXT = hex('#1a1a1a');
  const MUTED = hex('#666666');
  const BORDER = hex('#d9d9d9');
  const ZEBRA = hex('#f5f5f5');
  const CARD = hex('#fafafa');
  const GOOD = hex('#15803d');
  const WHITE = hex('#ffffff');

  const PAGE_WIDTH = 595;
  const PAGE_HEIGHT = 842;
  const LEFT = 50;
  const RIGHT = PAGE_WIDTH - 50;
  const WIDTH = RIGHT - LEFT;
  const BAR = 8;
  const BOTTOM = 72;
  const FOLLOWING_TOP = PAGE_HEIGHT - 62;

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

  const wrap = (text: string, font: Font, size: number, width: number) => {
    const words = clean(text).split(' ').filter(Boolean);
    const rows: string[] = [];
    let row = '';
    for (const word of words) {
      const candidate = row ? `${row} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        row = candidate;
        continue;
      }
      if (row) rows.push(row);
      // a single word wider than the line is cut
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (
          cut > 1 &&
          font.widthOfTextAtSize(rest.slice(0, cut), size) > width
        ) {
          cut -= 1;
        }
        rows.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      row = rest;
    }
    if (row) rows.push(row);
    return rows.length ? rows : [''];
  };

  const logoBytes = await loadLogo(options.logo);
  let logo: Awaited<ReturnType<typeof pdf.embedPng>> | null = null;
  if (logoBytes) {
    try {
      logo = await pdf.embedPng(logoBytes);
    } catch {
      logo = null;
    }
  }

  const brandName = clean(options.brand.name);
  const brandSubtitle = clean(options.brand.subtitle);
  const titleBlock = blocks.find(b => b.kind === 'title');
  const runningTitle =
    titleBlock && titleBlock.kind === 'title'
      ? clean([titleBlock.text, titleBlock.subtitle].filter(Boolean).join(': '))
      : '';

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = 0;

  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    thickness = 0.75
  ) =>
    page.drawLine({
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      thickness,
      color: BORDER,
    });

  // First page: logo, crimson bar, name of the platform
  const drawFirstHeader = () => {
    if (logo) {
      // the logo file has a wide white margin: the mark itself is about two
      // thirds of the width, it is centred on the right of the header
      const width = 170;
      const height = (logo.height / logo.width) * width;
      page.drawImage(logo, {
        x: RIGHT - 55 - width / 2,
        y: PAGE_HEIGHT - 58 - height / 2,
        width,
        height,
      });
    }
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - BAR,
      width: PAGE_WIDTH,
      height: BAR,
      color: CRIMSON,
    });
    page.drawRectangle({
      x: LEFT,
      y: PAGE_HEIGHT - 76,
      width: 38,
      height: 38,
      color: CRIMSON,
    });
    const nameSize = 11;
    page.drawText(brandName, {
      x: LEFT + 19 - bold.widthOfTextAtSize(brandName, nameSize) / 2,
      y: PAGE_HEIGHT - 61,
      size: nameSize,
      font: bold,
      color: WHITE,
    });
    page.drawText(brandSubtitle, {
      x: LEFT + 48,
      y: PAGE_HEIGHT - 56,
      size: 13,
      font: bold,
      color: ONYX,
    });
    line(LEFT, PAGE_HEIGHT - 94, RIGHT, PAGE_HEIGHT - 94);
    y = PAGE_HEIGHT - 94;
  };

  // Following pages: slim running header
  const drawRunningHeader = () => {
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - BAR,
      width: PAGE_WIDTH,
      height: BAR,
      color: CRIMSON,
    });
    page.drawText(`${brandName} ${brandSubtitle}`, {
      x: LEFT,
      y: PAGE_HEIGHT - 32,
      size: 8.5,
      font: bold,
      color: ONYX,
    });
    const right = runningTitle;
    page.drawText(right, {
      x: RIGHT - regular.widthOfTextAtSize(right, 8.5),
      y: PAGE_HEIGHT - 32,
      size: 8.5,
      font: regular,
      color: MUTED,
    });
    line(LEFT, PAGE_HEIGHT - 42, RIGHT, PAGE_HEIGHT - 42);
    y = FOLLOWING_TOP;
  };

  drawFirstHeader();

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawRunningHeader();
  };
  const ensure = (height: number) => {
    if (y - height < BOTTOM) newPage();
  };

  const drawTable = (columns: ReportColumn[], rows: ReportCell[][]): void => {
    const PAD_X = 7;
    const PAD_Y = 5;
    const FONT = 9.5;
    const GAP = 12;
    const BAR_TEXT = 34;
    const total = columns.reduce((sum, c) => sum + c.weight, 0);
    const widths = columns.map(c => (c.weight / total) * WIDTH);
    const xs = widths.map((_, i) =>
      widths.slice(0, i).reduce((sum, w) => sum + w, LEFT)
    );

    const cellOf = (cell: ReportCell) =>
      typeof cell === 'string' ? { text: cell } : cell;
    const cellLines = (cell: ReportCell, col: number, font: Font) => {
      const c = cellOf(cell);
      const room = widths[col] - 2 * PAD_X;
      return c.pct !== undefined
        ? [clean(c.text)]
        : wrap(c.text, font, FONT, room);
    };
    const heightOf = (cells: ReportCell[], font: Font) =>
      Math.max(
        20,
        2 * PAD_Y +
          GAP *
            Math.max(...cells.map((cell, i) => cellLines(cell, i, font).length))
      );

    const drawRow = (
      cells: ReportCell[],
      height: number,
      kind: 'header' | 'even' | 'odd'
    ) => {
      const top = y;
      if (kind === 'header') {
        page.drawRectangle({
          x: LEFT,
          y: top - height,
          width: WIDTH,
          height,
          color: CHARCOAL,
        });
      } else if (kind === 'odd') {
        page.drawRectangle({
          x: LEFT,
          y: top - height,
          width: WIDTH,
          height,
          color: ZEBRA,
        });
      }
      cells.forEach((cell, i) => {
        const c = cellOf(cell);
        const font = kind === 'header' || c.tone ? bold : regular;
        const color =
          kind === 'header'
            ? WHITE
            : c.tone === 'good'
              ? GOOD
              : c.tone === 'bad'
                ? CRIMSON
                : TEXT;
        const baseline = top - PAD_Y - 8;
        if (c.pct !== undefined && kind !== 'header') {
          const barWidth = widths[i] - 2 * PAD_X - BAR_TEXT;
          page.drawRectangle({
            x: xs[i] + PAD_X,
            y: baseline - 1,
            width: barWidth,
            height: 6,
            color: BORDER,
          });
          page.drawRectangle({
            x: xs[i] + PAD_X,
            y: baseline - 1,
            width: Math.max(0, (barWidth * Math.min(100, c.pct)) / 100),
            height: 6,
            color: CRIMSON,
          });
          const label = clean(c.text);
          page.drawText(label, {
            x:
              xs[i] +
              widths[i] -
              PAD_X -
              regular.widthOfTextAtSize(label, FONT),
            y: baseline,
            size: FONT,
            font: regular,
            color,
          });
          return;
        }
        const textRows = cellLines(cell, i, font);
        textRows.forEach((row, n) => {
          const x =
            columns[i].align === 'right'
              ? xs[i] + widths[i] - PAD_X - font.widthOfTextAtSize(row, FONT)
              : xs[i] + PAD_X;
          page.drawText(row, {
            x,
            y: baseline - n * GAP,
            size: FONT,
            font,
            color,
          });
        });
      });
      if (kind !== 'header') line(LEFT, top - height, RIGHT, top - height, 0.5);
      y = top - height;
    };

    const headerCells: ReportCell[] = columns.map(c => c.header);
    const headerHeight = heightOf(headerCells, bold);
    const drawHeader = () => drawRow(headerCells, headerHeight, 'header');

    rows.forEach((cells, index) => {
      const height = heightOf(cells, regular);
      if (index === 0) {
        // the header row is never alone at the bottom of a page
        ensure(headerHeight + height);
        drawHeader();
      } else if (y - height < BOTTOM) {
        newPage();
        drawHeader();
      }
      drawRow(cells, height, index % 2 === 0 ? 'even' : 'odd');
    });
    y -= 10;
  };

  for (const block of blocks) {
    switch (block.kind) {
      case 'title': {
        y -= 36;
        page.drawText(clean(block.text), {
          x: LEFT,
          y,
          size: 24,
          font: bold,
          color: ONYX,
        });
        y -= 14;
        page.drawRectangle({
          x: LEFT,
          y,
          width: 44,
          height: 3,
          color: CRIMSON,
        });
        if (block.subtitle) {
          y -= 24;
          for (const row of wrap(block.subtitle, bold, 14, WIDTH)) {
            page.drawText(row, {
              x: LEFT,
              y,
              size: 14,
              font: bold,
              color: TEXT,
            });
            y -= 18;
          }
        }
        y -= 6;
        break;
      }
      case 'facts': {
        const PAD = 14;
        const colGap = 20;
        const colWidth = (WIDTH - 2 * PAD - colGap) / 2;
        const rows: (typeof block.items)[] = [];
        for (let i = 0; i < block.items.length; i += 2) {
          rows.push(block.items.slice(i, i + 2));
        }
        const prepared = rows.map(items => {
          const wrapped = items.map(item =>
            wrap(item.value, bold, 11, colWidth)
          );
          return {
            items,
            wrapped,
            height: 14 + 14 * Math.max(...wrapped.map(w => w.length)) + 8,
          };
        });
        const cardHeight =
          prepared.reduce((sum, r) => sum + r.height, 0) + 2 * 8;
        ensure(cardHeight + 10);
        y -= 8;
        page.drawRectangle({
          x: LEFT,
          y: y - cardHeight,
          width: WIDTH,
          height: cardHeight,
          color: CARD,
          borderColor: BORDER,
          borderWidth: 0.75,
        });
        page.drawRectangle({
          x: LEFT,
          y: y - cardHeight,
          width: 3,
          height: cardHeight,
          color: CRIMSON,
        });
        let top = y - 8;
        for (const row of prepared) {
          row.items.forEach((item, col) => {
            const x = LEFT + PAD + col * (colWidth + colGap);
            page.drawText(clean(item.label).toUpperCase(), {
              x,
              y: top - 12,
              size: 7.5,
              font: bold,
              color: MUTED,
            });
            row.wrapped[col].forEach((text, n) => {
              page.drawText(text, {
                x,
                y: top - 26 - n * 14,
                size: 11,
                font: bold,
                color: TEXT,
              });
            });
          });
          top -= row.height;
        }
        y -= cardHeight + 8;
        break;
      }
      case 'heading': {
        // a heading is never the last line of a page
        ensure(90);
        y -= 22;
        page.drawRectangle({
          x: LEFT,
          y: y - 3,
          width: 3,
          height: 15,
          color: CRIMSON,
        });
        page.drawText(clean(block.text), {
          x: LEFT + 10,
          y,
          size: 13,
          font: bold,
          color: ONYX,
        });
        y -= 10;
        break;
      }
      case 'text': {
        const rows = wrap(block.text, regular, 10, WIDTH);
        ensure(rows.length * 14 + 8);
        y -= 4;
        for (const row of rows) {
          y -= 14;
          page.drawText(row, {
            x: LEFT,
            y,
            size: 10,
            font: regular,
            color: MUTED,
          });
        }
        y -= 6;
        break;
      }
      case 'kpis': {
        const count = block.items.length;
        const gap = 12;
        const tileWidth = (WIDTH - gap * (count - 1)) / count;
        const tileHeight = 70;
        ensure(tileHeight + 10);
        y -= 8;
        block.items.forEach((item, i) => {
          const x = LEFT + i * (tileWidth + gap);
          page.drawRectangle({
            x,
            y: y - tileHeight,
            width: tileWidth,
            height: tileHeight,
            color: CARD,
            borderColor: BORDER,
            borderWidth: 0.75,
          });
          page.drawRectangle({
            x,
            y: y - tileHeight,
            width: 3,
            height: tileHeight,
            color: CRIMSON,
          });
          page.drawText(clean(item.value), {
            x: x + 14,
            y: y - 31,
            size: 22,
            font: bold,
            color: CRIMSON,
          });
          const labelRow = wrap(item.label, regular, 8.5, tileWidth - 28)[0];
          page.drawText(labelRow, {
            x: x + 14,
            y: y - 47,
            size: 8.5,
            font: regular,
            color: MUTED,
          });
          if (item.pct !== undefined) {
            const barWidth = tileWidth - 28;
            page.drawRectangle({
              x: x + 14,
              y: y - 62,
              width: barWidth,
              height: 5,
              color: BORDER,
            });
            page.drawRectangle({
              x: x + 14,
              y: y - 62,
              width: Math.max(0, (barWidth * Math.min(100, item.pct)) / 100),
              height: 5,
              color: CRIMSON,
            });
          }
        });
        y -= tileHeight + 6;
        break;
      }
      case 'table': {
        y -= 6;
        drawTable(block.columns, block.rows);
        break;
      }
    }
  }

  // Footer on every page: platform, date, page number
  const pages = pdf.getPages();
  const footerLeft = clean(
    [`${options.brand.name} ${options.brand.subtitle}`, options.footerNote]
      .filter(Boolean)
      .join('  |  ')
  );
  pages.forEach((p, index) => {
    p.drawLine({
      start: { x: LEFT, y: 52 },
      end: { x: RIGHT, y: 52 },
      thickness: 0.75,
      color: BORDER,
    });
    p.drawText(footerLeft, {
      x: LEFT,
      y: 38,
      size: 8,
      font: regular,
      color: MUTED,
    });
    const pageText = clean(options.pageLabel(index + 1, pages.length));
    p.drawText(pageText, {
      x: RIGHT - bold.widthOfTextAtSize(pageText, 8),
      y: 38,
      size: 8,
      font: bold,
      color: TEXT,
    });
  });

  pdf.setTitle(runningTitle || brandName);
  pdf.setCreator(`${brandName} ${brandSubtitle}`);
  pdf.setProducer(`${brandName} ${brandSubtitle}`);

  return pdf.save();
}
