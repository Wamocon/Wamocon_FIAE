// The trainer notice for a trainee submission (scenario, quiz, use case).
//
// The row stores a German text as a fallback for readers that do not know the
// type. The bell shows the translated text of the type instead (see
// formatNotification), built from the same facts that the row keeps in its
// context: the name of the trainee and the title of the subject.

export type SubmissionNoticeType =
  | 'ENABLER_SUBMITTED'
  | 'ENABLER_QUIZ_SUBMITTED'
  | 'LESSON_QUIZ_SUBMITTED'
  | 'USE_CASE_SUBMITTED';

export const SUBMISSION_NOTICE_TYPES: readonly SubmissionNoticeType[] = [
  'ENABLER_SUBMITTED',
  'ENABLER_QUIZ_SUBMITTED',
  'LESSON_QUIZ_SUBMITTED',
  'USE_CASE_SUBMITTED',
];

export function isSubmissionNoticeType(
  type: string
): type is SubmissionNoticeType {
  return (SUBMISSION_NOTICE_TYPES as readonly string[]).includes(type);
}

const DIFFICULTY_DE: Record<string, string> = {
  LOW: 'Niedrig',
  MEDIUM: 'Mittel',
  HIGH: 'Hoch',
};

export type SubmissionNoticeInput = {
  /** Full name of the trainee, empty or null when unknown. */
  traineeName: string | null | undefined;
  /** Title of the lesson or use case. */
  subject: string;
  /** LOW, MEDIUM or HIGH, only for the quiz of a lesson. */
  difficulty?: string | null;
};

/** The German fallback text that is stored with the notification. */
export function submissionNoticeText(
  type: SubmissionNoticeType,
  { traineeName, subject, difficulty }: SubmissionNoticeInput
): { title: string; message: string } {
  const name = traineeName?.trim() || 'Ein Azubi';
  switch (type) {
    case 'ENABLER_SUBMITTED':
      return {
        title: 'Szenario eingereicht',
        message: `${name} hat ein Szenario eingereicht: ${subject}`,
      };
    case 'ENABLER_QUIZ_SUBMITTED':
      return {
        title: 'Mini-Quiz eingereicht',
        message: `${name} hat ein Mini-Quiz abgegeben: ${subject}`,
      };
    case 'LESSON_QUIZ_SUBMITTED': {
      const level = DIFFICULTY_DE[String(difficulty)] ?? String(difficulty);
      return {
        title: 'Themenkreis-Quiz eingereicht',
        message: `${name} hat ein Quiz der Stufe ${level} abgegeben: ${subject}`,
      };
    }
    case 'USE_CASE_SUBMITTED':
      return {
        title: 'Use Case eingereicht',
        message: `${name} hat einen Use Case eingereicht: ${subject}`,
      };
  }
}
