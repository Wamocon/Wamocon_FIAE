/**
 * Index text of a quiz, split into the part that trainees may see (the
 * questions) and the part that they may not (answers, explanations, expected
 * answers). Pure module, shared by scripts/reindex-gemini.ts and the embed
 * route.
 *
 * The split happens here, BEFORE the writers chunk by size. Every chunk of the
 * answers text is written as 'trainer', every chunk of the questions text as
 * 'all'. The questions text carries no marker of a correct option (the check
 * mark or cross), no explanation and no expected answer, so no chunk of it can
 * hold the tail of an answer.
 *
 * @module lib/hai/quizIndexText
 */

export interface QuizOptionInput {
  text: string | null;
  isCorrect: boolean | null;
  explanation: string | null;
}

export interface QuizQuestionInput {
  orderIndex: number | null;
  text: string;
  type: string | null;
  expectedAnswer: string | null;
  options: QuizOptionInput[];
}

export interface QuizTexts {
  /** Questions and the options as the trainee sees them. Always set. */
  questions: string;
  /** Answers part, or null if the quiz has no answer content at all. */
  answers: string | null;
}

/** Marker of a correct option and of a wrong one in the answers text. */
export const CORRECT_MARKER = '✓';
export const WRONG_MARKER = '✗';

function questionLine(question: QuizQuestionInput): string {
  const type = question.type ? ` (${question.type})` : '';
  return `Frage ${question.orderIndex ?? ''}: ${question.text}${type}`;
}

function visibleOptions(question: QuizQuestionInput): QuizOptionInput[] {
  return (question.options ?? []).filter(option => option && option.text);
}

/**
 * @param heading first line of both texts, for example "Quiz: Titel (leicht)"
 */
export function buildQuizTexts(
  heading: string,
  questions: QuizQuestionInput[]
): QuizTexts {
  const questionParts: string[] = [heading];
  const answerParts: string[] = [`${heading} (Antworten)`];
  let hasAnswers = false;

  for (const question of questions) {
    questionParts.push(`\n${questionLine(question)}`);
    answerParts.push(`\n${questionLine(question)}`);

    const options = visibleOptions(question);
    for (const option of options) {
      // the trainee sees the option text, never whether it is correct
      questionParts.push(`  - ${option.text}`);
    }

    if (question.expectedAnswer) {
      answerParts.push(`  Erwartete Antwort: ${question.expectedAnswer}`);
      hasAnswers = true;
    }
    for (const option of options) {
      const marker = option.isCorrect ? CORRECT_MARKER : WRONG_MARKER;
      answerParts.push(`  ${marker} ${option.text}`);
      hasAnswers = true;
      if (option.explanation) {
        answerParts.push(`    Erklärung: ${option.explanation}`);
      }
    }
  }

  return {
    questions: questionParts.filter(Boolean).join('\n'),
    answers: hasAnswers ? answerParts.filter(Boolean).join('\n') : null,
  };
}
