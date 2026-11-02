import { isSubmissionNoticeType } from '@/lib/notifications/submissionNotice';

type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

export type NotificationLike = {
  type: string;
  title: string;
  message: string | null;
  /** Name of the person who caused it, from the profile of actorId. */
  actorName?: string | null;
  context?: Record<string, unknown> | null;
  createdAt: string;
};

const DIFFICULTY_KEY: Record<string, string> = {
  LOW: 'enablerPage.difficultyLow',
  MEDIUM: 'enablerPage.difficultyMedium',
  HIGH: 'enablerPage.difficultyHigh',
};

const asText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * Title and message of a notification in the language of the reader.
 * The submissions of a trainee are built from the type and the facts of the
 * row (name, subject, level), so an older row with an English or nameless
 * text reads like a new one. Every other type keeps the stored text.
 */
export function formatNotification(
  n: NotificationLike,
  t: Translate
): { title: string; message: string | null } {
  if (!isSubmissionNoticeType(n.type)) {
    return { title: n.title, message: n.message };
  }
  const ctx = n.context ?? {};
  const name =
    asText(n.actorName) ||
    asText(ctx.traineeName) ||
    t('notifications.someTrainee');
  // Older rows only carry the title of the subject after the first colon of
  // the text (the sentence before it has none, the title itself may have one)
  const stored = n.message ?? '';
  const subject =
    asText(ctx.subjectTitle) ||
    (stored.includes(': ') ? stored.slice(stored.indexOf(': ') + 2) : '');
  const difficulty = asText(ctx.difficulty);
  const level = difficulty
    ? DIFFICULTY_KEY[difficulty]
      ? t(DIFFICULTY_KEY[difficulty])
      : difficulty
    : '';
  return {
    title: t(`notifications.type.${n.type}.title`),
    message: t(`notifications.type.${n.type}.message`, {
      name,
      subject,
      level,
    }),
  };
}

/** Newest first. The unread state is shown by the row, it does not sort. */
export function sortNewestFirst<T extends { createdAt: string }>(
  items: T[]
): T[] {
  return [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}
