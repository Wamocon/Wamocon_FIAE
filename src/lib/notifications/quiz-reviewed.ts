import { and, eq, inArray } from 'drizzle-orm';
import db from '@/db';
import { quizSubmissions, quizzes } from '@/db/migrations/schemas/schema';

/** Where the trainee sees the result and the feedback of a reviewed quiz. */
export const QUIZ_REVIEWED_LINK = '/trainee/trainer-feedback';

/**
 * The text of the notification "Quiz bewertet": it names the quiz and the
 * result, so the trainee knows which of the quizzes it is about (before it said
 * only "Dein Quiz wurde bewertet"). The result is the percentage of the
 * submission, left out when the submission has none.
 */
export function quizReviewedMessage(input: {
  quizTitle?: string | null;
  score?: number | string | null;
  hasFeedback?: boolean;
}): string {
  const title = (input.quizTitle ?? '').trim();
  const score =
    input.score === null || input.score === undefined || input.score === ''
      ? null
      : Number(input.score);
  const result =
    score !== null && Number.isFinite(score)
      ? ` (Ergebnis: ${Math.round(score)} %)`
      : '';
  const subject = title ? `Dein Quiz „${title}“` : 'Dein Quiz';
  const feedback = input.hasFeedback ? ' Trainer-Feedback ist verfügbar.' : '';
  return `${subject} wurde bewertet${result}.${feedback}`;
}

/** Room for the quiz titles in the text of a bundled notification. */
export const BUNDLED_TITLES_MAX_CHARS = 160;

/**
 * The text of the one notification a trainee gets when a trainer marks several
 * of their quizzes as reviewed in one step (WMCNL-3001): "Deine 5 Quizze wurden
 * bewertet: „A“, „B“ …". The titles are named as far as they fit
 * (BUNDLED_TITLES_MAX_CHARS), a quiz handed in twice is named once, and the
 * ellipsis says that more titles exist than are named. The bell knows
 * the sentence (src/lib/notification-text.ts). For exactly one quiz use
 * quizReviewedMessage, the text stays what it was.
 */
export function quizzesReviewedMessage(
  count: number,
  titles: Array<string | null | undefined>
): string {
  const head = `Deine ${count} Quizze wurden bewertet`;
  const unique: string[] = [];
  for (const title of titles) {
    const text = (title ?? '').trim();
    if (text && !unique.includes(text)) unique.push(text);
  }
  if (unique.length === 0) return `${head}.`;
  const named: string[] = [];
  let length = 0;
  for (const title of unique) {
    const part = `„${title}“`;
    const next = length + (named.length ? 2 : 0) + part.length;
    if (named.length > 0 && next > BUNDLED_TITLES_MAX_CHARS) break;
    named.push(part);
    length = next;
  }
  // a single title longer than the room is cut, so the text stays short
  if (length > BUNDLED_TITLES_MAX_CHARS) {
    named[0] = `${named[0].slice(0, BUNDLED_TITLES_MAX_CHARS - 2)}…“`;
  }
  const more = named.length < unique.length;
  return `${head}: ${named.join(', ')}${more ? ' …' : ''}`;
}

type NotificationRow = {
  type?: string | null;
  message?: string | null;
  linkUrl?: string | null;
  context?: unknown;
};

const contextOf = (row: NotificationRow): Record<string, unknown> =>
  row.context && typeof row.context === 'object'
    ? (row.context as Record<string, unknown>)
    : {};

/**
 * Notifications "Quiz bewertet" that were created before the quiz was named
 * carry only the id of the submission in their context. This gives them the
 * quiz and the result at the time of reading, from the submission of the
 * person themself (the submission has to belong to `userId`). Rows that name
 * the quiz already, and rows of another type, come back unchanged. A lookup
 * that fails leaves the rows as they are: the list must never fail for this.
 */
export async function enrichQuizReviewedNotifications<
  T extends NotificationRow,
>(rows: T[], userId: string): Promise<T[]> {
  const submissionIdOf = (row: T): string | null => {
    if (row.type !== 'QUIZ_REVIEWED') return null;
    const context = contextOf(row);
    if (context.quizTitle) return null;
    return typeof context.submissionId === 'string'
      ? context.submissionId
      : null;
  };
  const ids = Array.from(
    new Set(rows.map(submissionIdOf).filter((id): id is string => !!id))
  );
  if (ids.length === 0) return rows;

  try {
    const found = await db
      .select({
        id: quizSubmissions.id,
        score: quizSubmissions.score,
        quizTitle: quizzes.title,
      })
      .from(quizSubmissions)
      .innerJoin(quizzes, eq(quizSubmissions.quizId, quizzes.id))
      .where(
        and(
          inArray(quizSubmissions.id, ids as any),
          eq(quizSubmissions.traineeId, userId as any)
        )
      );
    const byId = new Map(found.map(f => [String(f.id), f] as const));
    return rows.map(row => {
      const id = submissionIdOf(row);
      const submission = id ? byId.get(id) : undefined;
      if (!submission) return row;
      return {
        ...row,
        message: quizReviewedMessage({
          quizTitle: submission.quizTitle,
          score: submission.score,
          hasFeedback: /Feedback/i.test(row.message ?? ''),
        }),
        // the old link led to the list of quizzes, the result is on the page
        // of the feedback
        linkUrl:
          row.linkUrl === '/trainee/quizzes' ? QUIZ_REVIEWED_LINK : row.linkUrl,
      };
    });
  } catch (error) {
    console.warn('Could not name the quiz of a notification', error);
    return rows;
  }
}
