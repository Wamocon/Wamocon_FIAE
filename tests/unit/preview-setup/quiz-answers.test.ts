/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  achievableRange,
  backfillAnswers,
  correctFor,
  correctForScore,
  planAnswers,
  type PlannedAnswer,
  type QuizQuestion,
} from '../../../scripts/preview/lib/quiz-answers';
import { parseArgs, type Db } from '../../../scripts/preview/lib/test-progress';
import {
  isQuestionGradable,
  quizScore,
  textAnswerMatches,
} from '../../../src/lib/catalog/quiz-grading';

const mcq = (id: string, correct = 1, wrong = 2): QuizQuestion => ({
  id,
  questionType: 'MCQ',
  expectedAnswer: null,
  options: [
    ...Array.from({ length: correct }, (_, i) => ({
      id: `${id}-r${i}`,
      isCorrect: true,
    })),
    ...Array.from({ length: wrong }, (_, i) => ({
      id: `${id}-w${i}`,
      isCorrect: false,
    })),
  ],
});
const text = (id: string, expected: string | null): QuizQuestion => ({
  id,
  questionType: 'TEXT',
  expectedAnswer: expected,
  options: [],
});
const ten = () => Array.from({ length: 10 }, (_, i) => mcq(`q${i}`));

/** The grading of the platform (submit route) applied to answers, as an independent check. */
function grade(questions: QuizQuestion[], answers: PlannedAnswer[]) {
  let right = 0;
  for (const q of questions) {
    if (!isQuestionGradable(q)) continue;
    const a = answers.find(x => x.questionId === q.id);
    if (!a) continue;
    if (q.questionType === 'TEXT') {
      if (textAnswerMatches(a.textAnswer ?? '', q.expectedAnswer ?? ''))
        right++;
    } else if (q.options.find(o => o.id === a.selectedOptionId)?.isCorrect) {
      right++;
    }
  }
  const graded = questions.filter(isQuestionGradable).length;
  return { right, score: quizScore(right, graded) };
}

describe('the plan of the answers of one submission', () => {
  it('answers every question once, with options of that question', () => {
    const qs = [...ten(), text('t1', 'Antwort'), text('t2', null)];
    const plan = planAnswers(qs, 7, 'seed');
    expect(plan.answers.map(a => a.questionId)).toEqual(qs.map(q => q.id));
    for (const a of plan.answers) {
      const q = qs.find(x => x.id === a.questionId)!;
      if (q.questionType === 'TEXT') {
        expect(a.selectedOptionId).toBeNull();
        expect(a.textAnswer).toBeTruthy();
      } else {
        expect(a.textAnswer).toBeNull();
        expect(q.options.map(o => o.id)).toContain(a.selectedOptionId);
      }
    }
  });

  it('gives exactly the asked number of right answers, graded like the platform', () => {
    for (const want of [0, 1, 5, 7, 10]) {
      const plan = planAnswers(ten(), want, 'seed');
      expect(plan.correct).toBe(want);
      expect(grade(ten(), plan.answers)).toEqual({
        right: want,
        score: want * 10,
      });
      expect(plan.score).toBe(want * 10);
    }
  });

  it('derives the score from the right answers, so 10 questions give steps of 10', () => {
    const scores: Array<number | null> = [];
    for (let k = 0; k <= 10; k++) scores.push(planAnswers(ten(), k, 's').score);
    expect(scores).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(planAnswers(ten(), correctFor(68, 10), 's').score).toBe(70);
  });

  it('keeps a seeded quiz passed: the share is raised to the pass mark when rounding would miss it', () => {
    for (let n = 1; n <= 12; n++) {
      for (const pct of [60, 75, 100]) {
        expect(quizScore(correctFor(pct, n), n)!).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it('is deterministic per submission and differs between submissions', () => {
    const a = planAnswers(ten(), 5, 'trainee1|quiz');
    const b = planAnswers(ten(), 5, 'trainee1|quiz');
    const c = planAnswers(ten(), 5, 'trainee2|quiz');
    expect(a).toEqual(b);
    expect(c.answers.map(x => x.correct)).not.toEqual(
      a.answers.map(x => x.correct)
    );
  });

  it('writes the expected text for a right free text answer and a different one for a wrong one', () => {
    const qs = [text('t1', ' Router ')];
    const right = planAnswers(qs, 1, 's');
    expect(textAnswerMatches(right.answers[0].textAnswer!, 'Router')).toBe(
      true
    );
    const wrong = planAnswers(qs, 0, 's');
    expect(textAnswerMatches(wrong.answers[0].textAnswer!, 'Router')).toBe(
      false
    );
    expect(wrong.answers[0].textAnswer).toBeTruthy();
  });

  it('keeps a free text question without expected answer out of the score but answers it', () => {
    const qs = [mcq('a'), mcq('b'), text('t', null)];
    const plan = planAnswers(qs, 1, 's');
    expect(plan.gradable).toBe(2);
    expect(plan.answers.find(a => a.questionId === 't')).toMatchObject({
      correct: null,
    });
    expect(plan.score).toBe(50);
  });

  it('stays inside what the options allow', () => {
    const allRight = mcq('x', 2, 0); // no wrong option: has to be right
    const noneRight = mcq('y', 0, 2); // no right option: has to be wrong
    const qs = [allRight, noneRight, mcq('z')];
    expect(achievableRange(qs)).toEqual({ gradable: 3, min: 1, max: 2 });
    expect(planAnswers(qs, 0, 's').correct).toBe(1);
    expect(planAnswers(qs, 3, 's').correct).toBe(2);
    expect(planAnswers(qs, 3, 's').answers).toHaveLength(3);
  });

  it('has no score for a quiz without a graded question', () => {
    const plan = planAnswers([text('t', null)], 0, 's');
    expect(plan.score).toBeNull();
    expect(plan.answers).toHaveLength(1);
  });
});

describe('the number of right answers for a stored score', () => {
  it('takes the exact one when the formula can give the score', () => {
    expect(correctForScore(70, ten())).toEqual({ correct: 7, exact: true });
    expect(correctForScore(100, ten())).toEqual({ correct: 10, exact: true });
  });

  it('takes the nearest possible one for 68 percent of 10 questions and says it is not exact', () => {
    expect(correctForScore(68, ten())).toEqual({ correct: 7, exact: false });
    // a tie goes to the lower number
    expect(correctForScore(65, ten())).toEqual({ correct: 6, exact: false });
  });
});

interface SubRow {
  id: string;
  quiz_id: string;
  trainee_id: string;
  score: number | null;
}

/** A database with seed submissions, questions per quiz and a log of the statements. */
function fakeWorld(opts: {
  subs: SubRow[];
  questions: Record<string, QuizQuestion[]>;
}) {
  const calls: { query: string; params?: any[] }[] = [];
  const db: Db = {
    unsafe: async (query: string, params?: any[]) => {
      calls.push({ query, params });
      if (query.includes('from public_preview.quiz_submissions s')) {
        return opts.subs;
      }
      if (query.includes('from public_preview.questions q')) {
        const qs = opts.questions[params![0]] ?? [];
        return qs.map(q => ({
          id: q.id,
          question_type: q.questionType,
          expected_answer: q.expectedAnswer,
          options: q.options.map(o => ({ id: o.id, is_correct: o.isCorrect })),
        }));
      }
      return Object.assign([], { count: 1 });
    },
  };
  return { db, calls };
}

describe('adding answers to existing seed submissions', () => {
  const sub = (id: string, score: number | null, quiz = 'qz1'): SubRow => ({
    id,
    quiz_id: quiz,
    trainee_id: 't1',
    score,
  });

  it('selects only seed submissions of the chosen trainees that have no answer', async () => {
    const { db, calls } = fakeWorld({ subs: [], questions: {} });
    await backfillAnswers(db, ['t1', 't2']);
    const q = calls[0];
    expect(q.params).toEqual([['t1', 't2']]);
    expect(q.query).toContain('s.trainee_id = any($1::uuid[])');
    expect(q.query).toContain('s.attempt_number = 1');
    expect(q.query).toContain('not s.is_reviewed');
    expect(q.query).toContain('60 + (abs(hashtext(s.quiz_id::text)) % 41)');
    expect(q.query).toMatch(
      /not exists \(\s*select 1 from public_preview\.quiz_submission_answers a where a\.submission_id = s\.id\)/
    );
  });

  it('does nothing without trainees', async () => {
    const { db, calls } = fakeWorld({ subs: [], questions: {} });
    const r = await backfillAnswers(db, []);
    expect(r).toMatchObject({ submissions: 0, answers: 0 });
    expect(calls).toHaveLength(0);
  });

  it('adds the answers that give the stored score and leaves the score alone', async () => {
    const { db, calls } = fakeWorld({
      subs: [sub('s1', 70)],
      questions: { qz1: ten() },
    });
    const r = await backfillAnswers(db, ['t1']);
    expect(r).toMatchObject({
      submissions: 1,
      answers: 10,
      exact: 1,
      fixed: 0,
    });
    expect(r.deviations).toEqual([]);
    const insert = calls.find(c =>
      c.query.includes('insert into public_preview.quiz_submission_answers')
    )!;
    expect(insert.params![0]).toEqual(Array(10).fill('s1'));
    const chosen: string[] = insert.params![2];
    expect(chosen.filter(id => id.includes('-r'))).toHaveLength(7);
    expect(
      calls.some(c => /update public_preview\.quiz_submissions/.test(c.query))
    ).toBe(false);
  });

  it('reports a stored score the formula cannot give and still does not change it', async () => {
    const { db, calls } = fakeWorld({
      subs: [sub('s1', 68)],
      questions: { qz1: ten() },
    });
    const r = await backfillAnswers(db, ['t1']);
    expect(r.exact).toBe(0);
    expect(r.deviations).toEqual([{ stored: 68, given: 70, questions: 10 }]);
    expect(r.fixed).toBe(0);
    expect(calls.some(c => /\bupdate\b/.test(c.query))).toBe(false);
  });

  it('changes the score only with fixScores, and only when it differs', async () => {
    const { db, calls } = fakeWorld({
      subs: [sub('s1', 68), sub('s2', 70)],
      questions: { qz1: ten() },
    });
    const r = await backfillAnswers(db, ['t1'], { fixScores: true });
    const updates = calls.filter(c => /\bupdate\b/.test(c.query));
    expect(updates).toHaveLength(1);
    expect(updates[0].params).toEqual([['s1'], [70], [68]]);
    expect(updates[0].query).toContain('score is not distinct from');
    expect(r.fixed).toBe(1);
  });

  it('only adds and never deletes', async () => {
    const { db, calls } = fakeWorld({
      subs: [sub('s1', 68), sub('s2', 70, 'qz2')],
      questions: { qz1: ten(), qz2: [mcq('a'), text('t', 'x')] },
    });
    await backfillAnswers(db, ['t1'], { fixScores: true });
    for (const { query } of calls) {
      expect(query).not.toMatch(/\bdelete\b|\btruncate\b|\bdrop\b/i);
      expect(query).toContain('public_preview.');
      expect(query.replace(/public_preview\./g, '')).not.toMatch(/public\./);
    }
    // all answers go in one statement, only into the answers table
    const inserts = calls.filter(c => /^\s*insert into/.test(c.query));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].query).toContain(
      'public_preview.quiz_submission_answers'
    );
    expect(inserts[0].params![0]).toHaveLength(12);
  });

  it('skips a submission whose quiz has no question', async () => {
    const { db, calls } = fakeWorld({
      subs: [sub('s1', 70, 'empty')],
      questions: {},
    });
    const r = await backfillAnswers(db, ['t1']);
    expect(r.submissions).toBe(0);
    expect(calls.some(c => /^\s*insert into/.test(c.query))).toBe(false);
  });

  it('is repeatable: once answers exist the selection is empty and nothing is written', async () => {
    const { db, calls } = fakeWorld({ subs: [], questions: {} });
    const r = await backfillAnswers(db, ['t1']);
    expect(r).toMatchObject({ submissions: 0, answers: 0, fixed: 0 });
    expect(calls).toHaveLength(1);
  });
});

describe('the options of the script that adds answers', () => {
  const base = ['--target', 'preview'];

  it('is a dry run unless --apply is given and takes --fix-scores and --email', () => {
    const r = parseArgs(
      [...base, '--fix-scores', '--email', 'A@x.de'],
      'answers'
    );
    expect(r.ok && r.options).toMatchObject({
      command: 'answers',
      apply: false,
      fixScores: true,
      emails: ['a@x.de'],
    });
    const plain = parseArgs(base, 'answers');
    expect(plain.ok && plain.options.fixScores).toBe(false);
  });

  it('keeps --fix-scores away from the other scripts and their flags away from this one', () => {
    expect(parseArgs([...base, '--fix-scores'], 'seed').ok).toBe(false);
    expect(parseArgs([...base, '--fix-scores'], 'reset').ok).toBe(false);
    expect(parseArgs([...base, '--clear-only'], 'answers').ok).toBe(false);
    expect(parseArgs([...base, '--keep-files'], 'answers').ok).toBe(false);
    expect(
      parseArgs([...base, '--email', 'a@x.de', '--level', 'weit'], 'answers').ok
    ).toBe(false);
    expect(parseArgs(['--fix-scores'], 'answers').ok).toBe(false);
  });
});
