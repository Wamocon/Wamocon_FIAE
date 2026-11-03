/**
 * Small pure helpers of the trainer page "Auszubildende, Detail"
 * (src/components/trainer/TraineeDetail.tsx), kept apart so they can be tested
 * without the page: the filter of the enablers, the grouping by course, the
 * texts of the status values, the check of the name and the way a failed
 * "share" is answered.
 */

/** The one vocabulary of the enabler filter and of the badge on the card. */
export type EnablerFilter =
  | 'all'
  | 'completed'
  | 'open'
  | 'locked'
  | 'inactive';

export const ENABLER_FILTERS: readonly EnablerFilter[] = [
  'all',
  'completed',
  'open',
  'locked',
  'inactive',
];

export interface FilterableEnabler {
  completed: boolean;
  isActive: boolean;
  state?: 'locked' | 'open' | 'completed' | null;
}

/**
 * Filter and badge say the same: "Abgeschlossen", "Offen" and "Gesperrt" are the
 * states of the order of work (the words of the badge), "Inaktiv" is an enabler
 * that is switched off in the course. An enabler counts as completed when the
 * trainee passed its quizzes (the figure next to the course), whatever the
 * order says about it.
 */
export function matchesEnablerFilter(
  enabler: FilterableEnabler,
  filter: EnablerFilter
): boolean {
  switch (filter) {
    case 'completed':
      return enabler.isActive && enabler.completed;
    case 'open':
      return enabler.isActive && enabler.state === 'open';
    case 'locked':
      return enabler.isActive && enabler.state === 'locked';
    case 'inactive':
      return !enabler.isActive;
    default:
      return true;
  }
}

export interface CourseGroup<T> {
  /** The id of the course, the key of the group. */
  key: string;
  title: string;
  code: string | null;
  items: T[];
}

/**
 * The items grouped by course in the order they arrive (the server sends them
 * in the order of the training plan). The key is the id of the course, not the
 * title: two courses with the same title are two groups, never one list with
 * two open enablers.
 */
export function groupByCourse<
  T extends {
    courseId?: string | null;
    courseTitle?: string | null;
    courseCode?: string | null;
  },
>(items: readonly T[], unknownTitle: string): CourseGroup<T>[] {
  const groups = new Map<string, CourseGroup<T>>();
  for (const item of items) {
    const title = item.courseTitle || unknownTitle;
    const key = item.courseId ? String(item.courseId) : `title:${title}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, title, code: item.courseCode ?? null, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values());
}

/**
 * The heading of a course group: the title, with the code of the component
 * behind it when another group has the same title (so the two stay apart).
 */
export function courseHeading(
  group: Pick<CourseGroup<unknown>, 'title' | 'code'>,
  all: ReadonlyArray<Pick<CourseGroup<unknown>, 'title'>>
): string {
  const sameTitle = all.filter(other => other.title === group.title).length;
  return sameTitle > 1 && group.code
    ? `${group.title} (${group.code})`
    : group.title;
}

/** Text key of a quiz level (the words the trainee sees, not LOW, MEDIUM, HIGH). */
export function difficultyTextKey(
  difficulty: string | null | undefined
): string {
  switch (String(difficulty ?? '').toUpperCase()) {
    case 'LOW':
      return 'enablerPage.difficultyLow';
    case 'MEDIUM':
      return 'enablerPage.difficultyMedium';
    case 'HIGH':
      return 'enablerPage.difficultyHigh';
    default:
      return 'trainee.detail.difficultyUnknown';
  }
}

/**
 * Text key of the status of a hand-in (use case or summary). A rejected one is
 * "Überarbeitung erforderlich", the words the trainee sees.
 */
export function submissionStatusTextKey(
  status: string | null | undefined
): string {
  switch (String(status ?? '').toUpperCase()) {
    case 'APPROVED':
      return 'trainee.detail.status.approved';
    case 'REJECTED':
      return 'trainee.detail.status.rejected';
    case 'PENDING':
      return 'trainee.detail.status.pending';
    default:
      return 'trainee.detail.notSubmitted';
  }
}

export const FULL_NAME_MAX = 120;

/** What is wrong with a name the trainer typed, null when nothing. */
export function nameProblem(name: string): 'empty' | 'tooLong' | null {
  const trimmed = name.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > FULL_NAME_MAX) return 'tooLong';
  return null;
}

/** Whether a picture address can be saved: empty (remove) or http(s). */
export function isWebAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** The initials of a name for the picture when there is none (at most two). */
export function initialsOf(name: string | null | undefined): string {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '';
  const first = Array.from(parts[0])[0] ?? '';
  const last =
    parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

export type ShareFailure = 'cancelled' | 'denied' | 'other';

/**
 * What a failed navigator.share() means. The browser reports a refusal as a
 * NotAllowedError with the text "Permission denied" (no user gesture left after
 * the PDF was made, a policy of the page, or a browser without file sharing),
 * and the closing of the share sheet as an AbortError. The first is no reason
 * to show a red English text, the second no reason to show anything.
 */
export function classifyShareFailure(error: unknown): ShareFailure {
  const name =
    typeof error === 'object' && error && 'name' in error
      ? String((error as { name?: unknown }).name)
      : '';
  if (name === 'AbortError') return 'cancelled';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message)
      : '';
  if (/permission denied|not allowed/i.test(message)) return 'denied';
  return 'other';
}

/** Short date for a report line, "—" without a valid date. */
export function formatReportDate(
  value: string | Date | null | undefined,
  locale: string
): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
