/**
 * Page context of the HAI ("Aktuelle Seite des Users"): what the browser says
 * about the page the person is on, so that "diese Seite", "hier", "diese
 * Datei" or "der erste Eintrag" can be understood.
 *
 * Shared by the browser (collector) and the server (validation, prompt). Pure
 * module without server imports.
 *
 * The text of the page is NOT trusted. It comes from the browser, so it can be
 * forged, and it can hold text that other people wrote (names, titles). The
 * server never reads a right or an instruction from it: it is data to resolve
 * references, nothing else (docs/hai-ui-kontext.md).
 *
 * @module lib/hai/pageContext/shared
 */

/** The fixed list of page kinds. */
export const PAGE_KINDS = [
  'dashboard',
  'enabler',
  'use_case',
  'course',
  'lernfeld',
  'quiz',
  'calendar',
  'reports',
  'school',
  'evaluations',
  'profile',
  'trainer_trainees',
  'trainer_reviews',
  'content',
  'admin',
  'other',
] as const;

export type PageKind = (typeof PAGE_KINDS)[number];

export function isPageKind(value: unknown): value is PageKind {
  return (
    typeof value === 'string' &&
    (PAGE_KINDS as readonly string[]).includes(value)
  );
}

/** What the browser sends in `context.page`. */
export interface PageContextInput {
  path: string;
  kind: PageKind;
  title: string;
  ids: string[];
  visibleLabels: string[];
}

export const PAGE_CONTEXT_LIMITS = Object.freeze({
  /** Longest path, in characters. */
  path: 200,
  /** Longest title (h1), in characters. */
  title: 120,
  /** Most labels. */
  labels: 25,
  /** Longest label, in characters. */
  label: 80,
  /** All labels together, in characters. */
  labelsTotal: 1500,
  /** Most ids. */
  ids: 5,
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPageUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Path characters that may reach the server: letters, digits, / _ - [ ] */
const PATH_RE = /^\/[A-Za-z0-9/_\-[\]]*$/;

/** True for a path the server accepts as "the page of the user". */
export function isPlausiblePagePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length <= PAGE_CONTEXT_LIMITS.path &&
    PATH_RE.test(path)
  );
}

/**
 * The kind of a page, from its path (the routes of src/app). The server derives
 * the kind itself and compares it with the one of the browser.
 */
export function pageKindForPath(path: string): PageKind {
  const segments = path.split('?')[0].split('/').filter(Boolean);
  const [area, section, , third] = segments;
  if (area !== 'trainee' && area !== 'trainer') return 'other';

  if (section === 'dashboard') return 'dashboard';
  if (section === 'enablers') {
    // /enablers/<id>/quiz, /enablers/<id>/quizzes/...
    return third === 'quiz' || third === 'quizzes' ? 'quiz' : 'enabler';
  }
  if (section === 'use-cases') return 'use_case';
  if (section === 'courses' || section === 'modules') return 'course';
  if (section === 'lernfelder') return 'lernfeld';
  if (section === 'quizzes' || section === 'quiz-management') return 'quiz';
  if (section === 'calendar') return 'calendar';
  if (section === 'activity-reports') return 'reports';
  if (section === 'school') return 'school';
  if (section === 'evaluations') return 'evaluations';
  if (section === 'profile') return 'profile';
  if (area === 'trainer' && section === 'trainees') return 'trainer_trainees';
  if (area === 'trainer' && section === 'reviews') return 'trainer_reviews';
  if (area === 'trainer' && section === 'content-management') return 'content';
  if (area === 'trainer' && section === 'admin') return 'admin';
  return 'other';
}

/** The uuids in a path and in a query string (no other value), in order, no duplicates. */
export function uuidsFromLocation(path: string, search = ''): string[] {
  const found: string[] = [];
  const add = (value: string) => {
    const lower = value.toLowerCase();
    if (isPageUuid(value) && !found.includes(lower)) found.push(lower);
  };
  for (const segment of path.split('?')[0].split('/')) add(segment);
  try {
    const params = new URLSearchParams(search);
    params.forEach(value => add(value));
  } catch {
    // an unreadable query adds nothing
  }
  return found.slice(0, PAGE_CONTEXT_LIMITS.ids);
}

/** Extensions that make a label a file name (files come from the database). */
export const FILE_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'csv',
  'txt',
  'zip',
  'png',
  'jpg',
  'jpeg',
  'md',
] as const;

const FILE_LABEL_RE = new RegExp(
  `\\.(?:${FILE_EXTENSIONS.join('|')})\\s*$`,
  'i'
);

/** True for a label that is a file name. */
export function looksLikeFileName(label: string): boolean {
  return FILE_LABEL_RE.test(label.trim());
}
