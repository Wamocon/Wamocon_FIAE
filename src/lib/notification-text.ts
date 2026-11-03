/**
 * Notifications are stored with a German title and message (the routes write
 * them when the event happens, for example "Der Fragenkomplex "X" wurde
 * aktualisiert."). The bell shows them in the language of the reader: the title
 * comes from the type, the message from a pattern of the stored sentence whose
 * gaps (names of content, dates) are put into the translated sentence. A
 * sentence that no pattern knows is shown as stored, so nothing is lost.
 *
 * Names of content (a quiz, a Themenkreis) exist in German only and stay as
 * they are.
 */

type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

/** Types with a fixed title: the translation key is notifications.type.<TYPE>.title */
const TITLED_TYPES = new Set([
  'ENABLER_CREATED',
  'ENABLER_ACTIVATED',
  'ENABLER_QUIZ_CREATED',
  'ENABLER_FEEDBACK',
  'USE_CASE_CREATED',
  'USE_CASE_ACTIVATED',
  'USE_CASE_FEEDBACK',
  'COURSE_MEMBER_REMOVED',
  'COURSE_UPDATED',
  'COURSE_DELETED',
  'GLOBAL_QUIZ_ASSIGNED',
  'QUIZ_REVIEWED',
  'QUIZ_DELETED',
  'EXAM_SCHEDULED',
  'EXAM_GRADED',
  'BLOCK_SCHEDULED',
  'BLOCK_UPDATED',
  'BLOCK_CANCELLED',
]);

type Pattern = {
  type: string;
  /** The stored German sentence, groups in the order of `names` */
  match: RegExp;
  /** Names of the gaps of the sentence, in the order of the groups */
  names: string[];
  /** Translation key of the sentence */
  key: string;
};

const PATTERNS: Pattern[] = [
  {
    type: 'ENABLER_CREATED',
    match: /^Ein neuer Themenkreis "(.+)" wurde aktiviert\.$/,
    names: ['title'],
    key: 'notifications.message.ENABLER_CREATED',
  },
  {
    type: 'ENABLER_ACTIVATED',
    match: /^Ein Enabler wurde aktiviert: (.+)$/,
    names: ['title'],
    key: 'notifications.message.ENABLER_ACTIVATED',
  },
  {
    type: 'ENABLER_QUIZ_CREATED',
    match:
      /^Ein neues (Leicht|Mittel|Schwer)-Quiz wurde für "(.+)" erstellt\.$/,
    names: ['level', 'title'],
    key: 'notifications.message.ENABLER_QUIZ_CREATED',
  },
  {
    type: 'USE_CASE_CREATED',
    match: /^Ein neuer Use Case "(.+)" wurde aktiviert\.$/,
    names: ['title'],
    key: 'notifications.message.USE_CASE_CREATED',
  },
  {
    type: 'USE_CASE_ACTIVATED',
    match: /^Ein Use Case wurde aktiviert: (.+)$/,
    names: ['title'],
    key: 'notifications.message.USE_CASE_ACTIVATED',
  },
  {
    type: 'ENABLER_FEEDBACK',
    match: /^Status: (PENDING|APPROVED|REJECTED)$/,
    names: ['status'],
    key: 'notifications.message.FEEDBACK',
  },
  {
    type: 'USE_CASE_FEEDBACK',
    match: /^Status: (PENDING|APPROVED|REJECTED)$/,
    names: ['status'],
    key: 'notifications.message.FEEDBACK',
  },
  {
    type: 'COURSE_MEMBER_REMOVED',
    match: /^Du wurdest aus dem Fragenkomplex "(.+)" entfernt\.$/,
    names: ['title'],
    key: 'notifications.message.COURSE_MEMBER_REMOVED',
  },
  {
    type: 'COURSE_UPDATED',
    match: /^Der Fragenkomplex "(.+)" wurde aktualisiert\.$/,
    names: ['title'],
    key: 'notifications.message.COURSE_UPDATED',
  },
  {
    type: 'COURSE_DELETED',
    match: /^Der Fragenkomplex "(.+)" wurde gelöscht\.$/,
    names: ['title'],
    key: 'notifications.message.COURSE_DELETED',
  },
  {
    type: 'GLOBAL_QUIZ_ASSIGNED',
    match: /^Dir wurde ein (?:neues )?Quiz zugewiesen: "(.+)"$/,
    names: ['title'],
    key: 'notifications.message.GLOBAL_QUIZ_ASSIGNED',
  },
  {
    type: 'QUIZ_REVIEWED',
    match: /^Dein Quiz wurde bewertet\. Trainer-Feedback ist verfügbar\.$/,
    names: [],
    key: 'notifications.message.QUIZ_REVIEWED_FEEDBACK',
  },
  {
    type: 'QUIZ_REVIEWED',
    match: /^Dein Quiz wurde bewertet\.$/,
    names: [],
    key: 'notifications.message.QUIZ_REVIEWED',
  },
  {
    // several quizzes reviewed in one step (WMCNL-3001), with the titles
    type: 'QUIZ_REVIEWED',
    match: /^Deine (\d+) Quizze wurden bewertet: (.+)$/,
    names: ['count', 'titles'],
    key: 'notifications.message.QUIZZES_REVIEWED_TITLES',
  },
  {
    type: 'QUIZ_REVIEWED',
    match: /^Deine (\d+) Quizze wurden bewertet\.$/,
    names: ['count'],
    key: 'notifications.message.QUIZZES_REVIEWED',
  },
  {
    type: 'QUIZ_DELETED',
    match: /^Das Quiz "(.+)" wurde entfernt\.$/,
    names: ['title'],
    key: 'notifications.message.QUIZ_DELETED',
  },
  {
    type: 'EXAM_SCHEDULED',
    match: /^Eine Prüfung "(.+)" wurde für den (.+) geplant\.$/,
    names: ['title', 'date'],
    key: 'notifications.message.EXAM_SCHEDULED',
  },
  {
    type: 'EXAM_GRADED',
    match:
      /^Deine Prüfung "(.+)" wurde bewertet: (.+)\/(.+) Punkte \((.+)%\)\.$/,
    names: ['title', 'points', 'max', 'percent'],
    key: 'notifications.message.EXAM_GRADED',
  },
  {
    type: 'BLOCK_SCHEDULED',
    match: /^Ein neuer Block "(.+)" wurde für (.+) – (.+) geplant\.$/,
    names: ['title', 'from', 'to'],
    key: 'notifications.message.BLOCK_SCHEDULED',
  },
  {
    type: 'BLOCK_UPDATED',
    match: /^Der Block "(.+)" wurde aktualisiert\.$/,
    names: ['title'],
    key: 'notifications.message.BLOCK_UPDATED',
  },
  {
    type: 'BLOCK_CANCELLED',
    match: /^Der Block "(.+)" wurde storniert\.$/,
    names: ['title'],
    key: 'notifications.message.BLOCK_CANCELLED',
  },
];

/** Level word and status word of a stored sentence, translated by key. */
const WORD_KEYS: Record<string, string> = {
  Leicht: 'notifications.level.LOW',
  Mittel: 'notifications.level.MEDIUM',
  Schwer: 'notifications.level.HIGH',
  PENDING: 'notifications.status.PENDING',
  APPROVED: 'notifications.status.APPROVED',
  REJECTED: 'notifications.status.REJECTED',
};

/**
 * Title and message of a notification in the language of the reader. Falls
 * back to the stored text for a type or a sentence that is not known.
 */
export function notificationText(
  t: Translate,
  n: { type: string; title: string; message: string | null }
): { title: string; message: string | null } {
  const title = TITLED_TYPES.has(n.type)
    ? t(`notifications.type.${n.type}.title`)
    : n.title;
  let message = n.message;
  if (n.message) {
    for (const p of PATTERNS) {
      if (p.type !== n.type) continue;
      const found = p.match.exec(n.message);
      if (!found) continue;
      const data: Record<string, string> = {};
      p.names.forEach((name, i) => {
        const raw = found[i + 1];
        data[name] =
          name === 'level' || name === 'status' ? t(WORD_KEYS[raw]) : raw;
      });
      message = t(p.key, data);
      break;
    }
  }
  return { title, message };
}
