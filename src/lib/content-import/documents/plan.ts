// The plan of the PDF import: every PDF of the source folder with its slot (enabler
// code and kind) and the reason when it is not imported. Pure functions, no file access
// and no database. The plan holds names, codes, sizes and hashes, never a text of a file.
//
// A file is imported only when
//  - its path follows the pattern of its folder (classify.ts),
//  - it is a readable PDF: magic bytes %PDF-, not empty, not larger than MAX_PDF_BYTES,
//  - the first heading of its first page names the same enabler as its file name (and a
//    scenario names itself a scenario),
//  - no other file claims the same slot (enabler code and kind).
// Everything else is reported with a fixed reason and left out. Nothing is guessed.

import { classifyPdfPath, headingId } from './classify';
import {
  PDF_KINDS,
  type DocumentPlan,
  type PdfKind,
  type PdfStatus,
  type PlanCounts,
  type PlanItem,
  type ScannedPdf,
} from './types';

/** The largest PDF that is taken (the bucket limit of the content buckets). */
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

const STATUSES: readonly PdfStatus[] = [
  'ok',
  'ignored',
  'misnamed',
  'annotated',
  'heading-mismatch',
  'heading-missing',
  'unreadable',
  'duplicate',
];

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function readProblem(file: ScannedPdf): string | null {
  if (file.readError) return 'The file could not be read.';
  if (!(file.size > 0)) return 'The file is empty.';
  if (file.size > MAX_PDF_BYTES) return 'The file is larger than the limit.';
  if (file.magicOk !== true) return 'The file does not start with %PDF-.';
  return null;
}

export function buildDocumentPlan(files: readonly ScannedPdf[]): DocumentPlan {
  const items: PlanItem[] = [];
  for (const file of [...files].sort((a, b) => compare(a.rel, b.rel))) {
    const path = classifyPdfPath(file.rel);
    const item: PlanItem = {
      rel: file.rel,
      kind: path.kind,
      componentCode: path.componentCode,
      enablerCode: path.status === 'ok' ? path.enablerCode : null,
      status: path.status,
      reason: path.reason,
      size: file.size,
      sha256: file.sha256 ?? null,
      pageCount: file.pageCount ?? null,
      headingKey: null,
    };
    items.push(item);
    if (path.status !== 'ok') continue;

    const problem = readProblem(file);
    if (problem) {
      item.status = 'unreadable';
      item.reason = problem;
      continue;
    }
    const heading = headingId(file.headText);
    if (!heading) {
      item.status = 'heading-missing';
      item.reason = 'The first page shows no enabler id in its heading.';
      continue;
    }
    item.headingKey = `${heading.number}${heading.split !== null ? `.${heading.split}` : ''}${heading.letter}`;
    const id = path.nameId as NonNullable<typeof path.nameId>;
    const componentSplit = /^\d+\.(\d)/.exec(path.enablerKey ?? '')?.[1];
    const split = componentSplit ? Number(componentSplit) : null;
    const sameSlot =
      heading.number === id.number &&
      heading.letter === id.letter &&
      (heading.split === null || heading.split === split);
    // A scenario may carry the word in its heading or not (2f) Titel). Any other kind must not.
    const wrongKind = heading.scenario && path.kind !== 'scenario';
    if (!sameSlot || wrongKind) {
      item.status = 'heading-mismatch';
      item.reason =
        'The heading names another enabler or another kind than the file name.';
    }
  }

  // two files in one slot: neither is taken
  const bySlot = new Map<string, PlanItem[]>();
  for (const item of items) {
    if (item.status !== 'ok') continue;
    const key = `${item.enablerCode}|${item.kind}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), item]);
  }
  for (const group of bySlot.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      item.status = 'duplicate';
      item.reason = 'Another file claims the same slot, it needs a decision.';
    }
  }
  return { version: 1, items };
}

export function countPlan(plan: DocumentPlan): PlanCounts {
  const byKind = Object.fromEntries(PDF_KINDS.map(k => [k, 0])) as Record<
    PdfKind,
    number
  >;
  const byStatus: Record<string, number> = {};
  for (const item of plan.items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    if (item.kind && item.status === 'ok') byKind[item.kind] += 1;
  }
  return { total: plan.items.length, byKind, byStatus };
}

/** Problems of a plan that was read from a file (empty = valid). */
export function validateDocumentPlan(plan: DocumentPlan): string[] {
  const problems: string[] = [];
  if (!plan || plan.version !== 1) {
    problems.push('The plan has an unknown version.');
  }
  if (!Array.isArray(plan?.items)) {
    problems.push('The plan has no list of items.');
    return problems;
  }
  plan.items.forEach((item, index) => {
    if (typeof item.rel !== 'string' || item.rel === '') {
      problems.push(`Item ${index} has no path.`);
    }
    if (!STATUSES.includes(item.status)) {
      problems.push(`Item ${index} has an unknown status.`);
    }
    if (item.status === 'ok' && (!item.kind || !item.enablerCode)) {
      problems.push(`Item ${index} is ok but has no slot.`);
    }
  });
  return problems;
}

/** Markdown summary: counts and the files with a problem (names only, no content). */
export function renderPlanSummary(plan: DocumentPlan): string {
  const counts = countPlan(plan);
  const lines = [
    '# PDF import plan (KfBM)',
    '',
    `Files: ${counts.total}`,
    '',
    '| Kind | Files to import |',
    '| --- | --- |',
    ...PDF_KINDS.map(kind => `| ${kind} | ${counts.byKind[kind]} |`),
    '',
    `By status: ${Object.entries(counts.byStatus)
      .sort(([a], [b]) => compare(a, b))
      .map(([status, n]) => `${status} ${n}`)
      .join(', ')}`,
    '',
  ];
  const problems = plan.items.filter(
    i => i.status !== 'ok' && i.status !== 'ignored'
  );
  if (problems.length > 0) {
    lines.push('## Files that are not imported', '');
    for (const item of problems) {
      lines.push(`- ${item.status}: ${item.rel} (${item.reason ?? ''})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
