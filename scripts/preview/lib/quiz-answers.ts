/**
 * Single answers of the seeded quiz submissions (Preview, schema public_preview).
 *
 * A real submission (src/app/api/trainee/quizzes/[quizId]/submit/route.ts) stores one
 * row in quiz_submission_answers for every question of the quiz: the chosen option of a
 * choice question, the typed text of a free text question. Right or wrong is not stored,
 * it follows from the option (options.is_correct) or from the expected answer, and the
 * score is quizScore(right, graded) of src/lib/catalog/quiz-grading.ts. The seed builds
 * exactly this form: the number of right answers comes first, the score is derived from
 * it (never the other way round, 10 questions only allow steps of 10 percent).
 *
 * Two jobs share this file:
 *   plan      pure: which question is answered right or wrong, with which option or text
 *   backfill  adds answers to existing seed submissions that have none (additive only)
 *
 * Nothing here deletes or overwrites a row. The score of a submission is only touched
 * when the caller asks for it (fixScores).
 */
import {
  isQuestionGradable,
  isTextQuestion,
  quizScore,
  textAnswerMatches,
} from '../../../src/lib/catalog/quiz-grading';
import { PASS_THRESHOLD } from '../../../src/lib/catalog/progression';

const SCHEMA = 'public_preview';

interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe: (query: string, params?: any[]) => PromiseLike<any>;
}

export interface QuizOption {
  id: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  id: string;
  questionType: string | null;
  expectedAnswer: string | null;
  options: QuizOption[];
}

export interface PlannedAnswer {
  questionId: string;
  selectedOptionId: string | null;
  textAnswer: string | null;
  /** true right, false wrong, null not graded (free text without expected answer) */
  correct: boolean | null;
}

export interface AnswerPlan {
  answers: PlannedAnswer[];
  /** Questions that count for the percentage (same rule as the platform). */
  gradable: number;
  /** Right answers of the plan (inside the range the questions allow). */
  correct: number;
  /** Platform formula: quizScore(correct, gradable), null without a graded question. */
  score: number | null;
}

/** Small stable hash (FNV-1a), so a choice is the same on every run. */
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const isMcq = (q: QuizQuestion) => !isTextQuestion(q);
const canBeRight = (q: QuizQuestion) =>
  isMcq(q) ? q.options.some(o => o.isCorrect) : isQuestionGradable(q);
const canBeWrong = (q: QuizQuestion) =>
  isMcq(q) ? q.options.length === 0 || q.options.some(o => !o.isCorrect) : true;

/**
 * How many right answers the questions of a quiz allow: a graded question without a
 * wrong option must be right, one without a right option must be wrong.
 */
export function achievableRange(questions: readonly QuizQuestion[]): {
  gradable: number;
  min: number;
  max: number;
} {
  const graded = questions.filter(isQuestionGradable);
  return {
    gradable: graded.length,
    min: graded.filter(q => canBeRight(q) && !canBeWrong(q)).length,
    max: graded.filter(canBeRight).length,
  };
}

/** The share of right answers asked for (percent) as a number of right answers. */
export function correctFor(percent: number, gradable: number): number {
  let k = Math.min(gradable, Math.round((percent / 100) * gradable));
  // a seeded quiz counts as passed (the order of work needs it)
  while (k < gradable && (quizScore(k, gradable) ?? 0) < PASS_THRESHOLD) k++;
  return k;
}

/**
 * The number of right answers that gives the stored score: the exact one when the
 * formula can produce it, else the nearest possible one (the lower one on a tie).
 */
export function correctForScore(
  score: number | null,
  questions: readonly QuizQuestion[]
): { correct: number; exact: boolean } {
  const { gradable, min, max } = achievableRange(questions);
  if (gradable === 0 || score == null) return { correct: min, exact: false };
  let best = min;
  let bestGap = Infinity;
  for (let k = min; k <= max; k++) {
    const gap = Math.abs((quizScore(k, gradable) ?? 0) - score);
    if (gap < bestGap) {
      best = k;
      bestGap = gap;
    }
  }
  return { correct: best, exact: bestGap === 0 };
}

/**
 * The answers of one submission with `wantCorrect` right ones (clamped into the range
 * the questions allow). `seed` makes the choice of questions and options stable per
 * submission.
 */
export function planAnswers(
  questions: readonly QuizQuestion[],
  wantCorrect: number,
  seed: string
): AnswerPlan {
  const { gradable, min, max } = achievableRange(questions);
  const target = Math.min(max, Math.max(min, wantCorrect));
  const graded = questions.filter(isQuestionGradable);
  const forced = graded.filter(q => canBeRight(q) && !canBeWrong(q));
  const flexible = graded
    .filter(q => canBeRight(q) && canBeWrong(q))
    .sort(
      (a, b) =>
        stableHash(`${seed}|${a.id}`) - stableHash(`${seed}|${b.id}`) ||
        a.id.localeCompare(b.id)
    );
  const right = new Set<string>([
    ...forced.map(q => q.id),
    ...flexible.slice(0, target - forced.length).map(q => q.id),
  ]);

  const answers: PlannedAnswer[] = [];
  for (const q of questions) {
    const pick = <T>(list: readonly T[]) =>
      list[stableHash(`${seed}|${q.id}|pick`) % list.length];
    if (!isQuestionGradable(q)) {
      // a free text question without an expected answer: answered, never graded
      answers.push({
        questionId: q.id,
        selectedOptionId: null,
        textAnswer: 'Testantwort: Begründung in eigenen Worten.',
        correct: null,
      });
      continue;
    }
    const wantRight = right.has(q.id);
    if (isMcq(q)) {
      const pool = q.options.filter(o => o.isCorrect === wantRight);
      if (pool.length === 0) continue; // a question without options stays unanswered
      answers.push({
        questionId: q.id,
        selectedOptionId: pick(pool).id,
        textAnswer: null,
        correct: wantRight,
      });
      continue;
    }
    const expected = q.expectedAnswer ?? '';
    let text = wantRight ? expected : 'Testantwort: falsche Antwort.';
    if (!wantRight && textAnswerMatches(text, expected)) text = `${text} (x)`;
    answers.push({
      questionId: q.id,
      selectedOptionId: null,
      textAnswer: text,
      correct: wantRight,
    });
  }

  const correct = answers.filter(a => a.correct === true).length;
  return { answers, gradable, correct, score: quizScore(correct, gradable) };
}

/** Questions of a quiz with their options, in the order the trainee sees them. */
export async function loadQuizQuestions(
  db: Db,
  quizId: string
): Promise<QuizQuestion[]> {
  const rows = await db.unsafe(
    `select q.id, q.question_type::text as question_type, q.expected_answer,
            coalesce(
              json_agg(json_build_object('id', o.id, 'is_correct', o.is_correct)
                       order by o.order_index nulls last, o.id)
                filter (where o.id is not null),
              '[]'::json) as options
       from ${SCHEMA}.questions q
       left join ${SCHEMA}.options o on o.question_id = q.id
      where q.quiz_id = $1
      group by q.id
      order by q.order_index nulls last, q.id`,
    [quizId]
  );
  return rows.map((r: any) => {
    const opts =
      typeof r.options === 'string' ? JSON.parse(r.options) : r.options;
    return {
      id: r.id,
      questionType: r.question_type,
      expectedAnswer: r.expected_answer,
      options: (opts ?? []).map((o: any) => ({
        id: o.id,
        isCorrect: !!o.is_correct,
      })),
    };
  });
}

/** Writes the answers of a plan for one submission. Returns the number of rows. */
export async function insertAnswers(
  db: Db,
  submissionId: string,
  answers: readonly PlannedAnswer[]
): Promise<number> {
  if (answers.length === 0) return 0;
  await db.unsafe(
    `insert into ${SCHEMA}.quiz_submission_answers
       (submission_id, question_id, selected_option_id, text_answer)
     select $1::uuid, x.question_id, x.selected_option_id, x.text_answer
       from unnest($2::uuid[], $3::uuid[], $4::text[])
            as x(question_id, selected_option_id, text_answer)`,
    [
      submissionId,
      answers.map(a => a.questionId),
      answers.map(a => a.selectedOptionId),
      answers.map(a => a.textAnswer),
    ]
  );
  return answers.length;
}

export interface BackfillSummary {
  /** Seed submissions without any answer that were found. */
  submissions: number;
  /** Answer rows added. */
  answers: number;
  /** Submissions whose stored score the formula can reproduce. */
  exact: number;
  /** Stored score that no number of right answers gives, with the score the answers give. */
  deviations: {
    stored: number | null;
    given: number | null;
    questions: number;
  }[];
  /** Scores changed (only with fixScores). */
  fixed: number;
}

/**
 * Adds answers to the seed submissions of the trainees that have none. A submission is
 * a seed submission when it belongs to one of the chosen trainees (the same scope the
 * reset empties), is the first attempt, is not reviewed and carries exactly the score
 * the seed gave (60 + hash of the quiz modulo 41). A hand-made submission always has
 * answers, so it is never touched. The score stays as it is unless fixScores is set.
 */
export async function backfillAnswers(
  db: Db,
  traineeIds: readonly string[],
  options: { fixScores?: boolean } = {}
): Promise<BackfillSummary> {
  const summary: BackfillSummary = {
    submissions: 0,
    answers: 0,
    exact: 0,
    deviations: [],
    fixed: 0,
  };
  if (traineeIds.length === 0) return summary;

  const subs = await db.unsafe(
    `select s.id, s.quiz_id, s.trainee_id, s.score
       from ${SCHEMA}.quiz_submissions s
      where s.trainee_id = any($1::uuid[])
        and s.attempt_number = 1
        and not s.is_reviewed
        and s.score = 60 + (abs(hashtext(s.quiz_id::text)) % 41)
        and not exists (
          select 1 from ${SCHEMA}.quiz_submission_answers a where a.submission_id = s.id)
      order by s.id`,
    [traineeIds]
  );

  const cache = new Map<string, QuizQuestion[]>();
  for (const sub of subs) {
    let questions = cache.get(sub.quiz_id);
    if (!questions) {
      questions = await loadQuizQuestions(db, sub.quiz_id);
      cache.set(sub.quiz_id, questions);
    }
    if (questions.length === 0) continue; // nothing to answer

    const stored: number | null = sub.score ?? null;
    const { correct, exact } = correctForScore(stored, questions);
    const plan = planAnswers(
      questions,
      correct,
      `${sub.trainee_id}|${sub.quiz_id}`
    );

    summary.submissions += 1;
    summary.answers += await insertAnswers(db, sub.id, plan.answers);
    if (exact) {
      summary.exact += 1;
    } else {
      summary.deviations.push({
        stored,
        given: plan.score,
        questions: plan.gradable,
      });
      if (options.fixScores) {
        const res = await db.unsafe(
          `update ${SCHEMA}.quiz_submissions set score = $1
            where id = $2 and score is not distinct from $3`,
          [plan.score, sub.id, stored]
        );
        summary.fixed += Number(res.count ?? 0);
      }
    }
  }
  return summary;
}
