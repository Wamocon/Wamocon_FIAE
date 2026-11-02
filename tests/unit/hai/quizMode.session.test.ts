/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  buildSummary,
  initialQuizState,
  quizReducer,
  toQuizStartScope,
  toggleSelection,
  type QuizAction,
  type QuizSessionState,
} from '@/lib/hai/quizMode/session';
import type { QuizQuestionPublic } from '@/lib/hai/quizMode/logic';

// Behavior under test: src/lib/hai/quizMode/session.ts, the state of one quiz
// session in the browser. The server keeps no state: the history of the asked
// questions lives here and travels with the next request.

const question = (
  id: string,
  enablerId = 'e1',
  enablerTitle = 'SQL Grundlagen'
): QuizQuestionPublic => ({
  id,
  text: `Frage ${id}`,
  multiple: false,
  options: [
    { id: `${id}-a`, text: 'A' },
    { id: `${id}-b`, text: 'B' },
  ],
  enablerId,
  enablerTitle,
  courseTitle: null,
  enablerHref: `/trainee/enablers/${enablerId}`,
});

const run = (actions: QuizAction[], from?: QuizSessionState) =>
  actions.reduce(quizReducer, from ?? initialQuizState());

const feedback = (correct: boolean) => ({
  correct,
  selectedOptionIds: ['x'],
  correctOptionIds: ['y'],
  explanation: null,
  solutionWithheld: false,
  correctCount: null,
});

describe('quizReducer', () => {
  it('starts loading with an empty history and the given scope', () => {
    const state = run([
      { type: 'start', scope: { enablerId: 'e1', topic: null } },
    ]);
    expect(state.phase).toBe('loading');
    expect(state.scope).toEqual({ enablerId: 'e1', topic: null });
    expect(state.asked).toEqual([]);
    expect(state.attempts).toEqual([]);
  });

  it('shows a question and puts it into the history once', () => {
    const q = question('q1');
    const state = run([
      { type: 'question', question: q, total: 5, remaining: 5 },
      { type: 'question', question: q, total: 5, remaining: 5 },
    ]);
    expect(state.phase).toBe('question');
    expect(state.asked).toEqual(['q1']);
    expect(state.total).toBe(5);
  });

  it('records an attempt with the enabler and keeps the question for the feedback', () => {
    const state = run([
      { type: 'question', question: question('q1'), total: 2, remaining: 2 },
      { type: 'checking' },
      { type: 'answered', feedback: feedback(false) },
    ]);
    expect(state.phase).toBe('feedback');
    expect(state.question?.id).toBe('q1');
    expect(state.attempts).toEqual([
      {
        questionId: 'q1',
        enablerId: 'e1',
        enablerTitle: 'SQL Grundlagen',
        enablerHref: '/trainee/enablers/e1',
        correct: false,
        solutionWithheld: false,
      },
    ]);
  });

  it('remembers in the attempt that the solution was withheld', () => {
    const state = run([
      { type: 'start', scope: { enablerId: null, topic: null } },
      { type: 'question', question: question(), total: 3, remaining: 3 },
      { type: 'checking' },
      {
        type: 'answered',
        feedback: {
          correct: false,
          selectedOptionIds: ['x'],
          correctOptionIds: [],
          explanation: null,
          solutionWithheld: true,
          correctCount: null,
        },
      },
    ]);
    expect(state.attempts[0].solutionWithheld).toBe(true);
    expect(state.feedback?.correctOptionIds).toEqual([]);
  });

  it('only moves to checking from a question on screen', () => {
    expect(run([{ type: 'checking' }]).phase).toBe('loading');
  });

  it('ignores an answer without a question', () => {
    const state = run([{ type: 'answered', feedback: feedback(true) }]);
    expect(state.attempts).toEqual([]);
    expect(state.phase).toBe('loading');
  });

  it('collects a history over several questions', () => {
    const state = run([
      { type: 'question', question: question('q1'), total: 3, remaining: 3 },
      { type: 'answered', feedback: feedback(true) },
      { type: 'loading' },
      { type: 'question', question: question('q2'), total: 3, remaining: 2 },
      { type: 'answered', feedback: feedback(false) },
    ]);
    expect(state.asked).toEqual(['q1', 'q2']);
    expect(state.attempts.map(a => a.correct)).toEqual([true, false]);
  });

  it('ends in the summary when nothing is left after some attempts', () => {
    const state = run([
      { type: 'question', question: question('q1'), total: 1, remaining: 1 },
      { type: 'answered', feedback: feedback(true) },
      { type: 'empty', reason: 'exhausted', total: 1 },
    ]);
    expect(state.phase).toBe('summary');
    expect(state.reason).toBe('exhausted');
    expect(state.question).toBeNull();
  });

  it('shows the empty notice when there was nothing to ask from the start', () => {
    const state = run([{ type: 'empty', reason: 'no_topic_match' }]);
    expect(state.phase).toBe('empty');
    expect(state.reason).toBe('no_topic_match');
  });

  it('finish shows the summary and drops the open question', () => {
    const state = run([
      { type: 'question', question: question('q1'), total: 1, remaining: 1 },
      { type: 'finish' },
    ]);
    expect(state.phase).toBe('summary');
    expect(state.question).toBeNull();
  });

  it('restart keeps the scope and starts the history again', () => {
    const state = run([
      { type: 'start', scope: { enablerId: null, topic: 'SQL' } },
      { type: 'question', question: question('q1'), total: 1, remaining: 1 },
      { type: 'answered', feedback: feedback(true) },
      { type: 'restart' },
    ]);
    expect(state.scope.topic).toBe('SQL');
    expect(state.asked).toEqual([]);
    expect(state.attempts).toEqual([]);
    expect(state.phase).toBe('loading');
  });

  it('keeps the question when the check fails, and shows the error', () => {
    const state = run([
      { type: 'question', question: question('q1'), total: 1, remaining: 1 },
      { type: 'checking' },
      { type: 'answerFailed', errorKey: 'network' },
    ]);
    expect(state.phase).toBe('question');
    expect(state.errorKey).toBe('network');
    expect(state.attempts).toEqual([]);
  });

  it('goes to the error phase when loading fails, and clears the error on the next load', () => {
    const failed = run([{ type: 'failed', errorKey: 'generic' }]);
    expect(failed.phase).toBe('error');
    expect(quizReducer(failed, { type: 'loading' }).errorKey).toBeNull();
    expect(run([{ type: 'answerFailed', errorKey: 'generic' }]).phase).toBe(
      'error'
    );
  });
});

describe('buildSummary', () => {
  const attempt = (
    enablerId: string,
    title: string,
    correct: boolean,
    href: string | null = `/trainee/enablers/${enablerId}`
  ) => ({
    questionId: `${enablerId}-${Math.random()}`,
    enablerId,
    enablerTitle: title,
    enablerHref: href,
    correct,
    solutionWithheld: false,
  });

  it('counts x of y and lists the enablers to repeat, the most wrong first', () => {
    const summary = buildSummary([
      attempt('e1', 'SQL', false),
      attempt('e2', 'Netzwerke', false),
      attempt('e2', 'Netzwerke', false),
      attempt('e3', 'Python', true),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.correct).toBe(1);
    expect(summary.repeat).toEqual([
      {
        enablerId: 'e2',
        title: 'Netzwerke',
        href: '/trainee/enablers/e2',
        wrong: 2,
      },
      { enablerId: 'e1', title: 'SQL', href: '/trainee/enablers/e1', wrong: 1 },
    ]);
  });

  it('has nothing to repeat when everything was right, and handles no attempt', () => {
    expect(buildSummary([attempt('e1', 'SQL', true)]).repeat).toEqual([]);
    expect(buildSummary([])).toEqual({
      total: 0,
      correct: 0,
      anyWithheld: false,
      repeat: [],
    });
  });

  it('says whether any solution stayed back', () => {
    const withheld = { ...attempt('e1', 'SQL', false), solutionWithheld: true };
    expect(
      buildSummary([attempt('e2', 'Netz', true), withheld]).anyWithheld
    ).toBe(true);
    expect(buildSummary([attempt('e2', 'Netz', true)]).anyWithheld).toBe(false);
  });

  it('keeps a missing link as null (a trainer has no page of the enabler)', () => {
    expect(
      buildSummary([attempt('e1', 'SQL', false, null)]).repeat[0].href
    ).toBeNull();
  });
});

describe('toQuizStartScope', () => {
  const ID = '20000000-0000-4000-8000-000000000001';

  it('takes a topic and an enabler id', () => {
    expect(toQuizStartScope({ topic: ' SQL ', enablerId: ID })).toEqual({
      topic: 'SQL',
      enablerId: ID,
    });
  });

  it('drops a malformed id and a blank topic, and cuts a long topic', () => {
    expect(toQuizStartScope({ topic: '   ', enablerId: 'x' })).toEqual({
      topic: null,
      enablerId: null,
    });
    expect(toQuizStartScope({ topic: 'a'.repeat(200) })?.topic).toHaveLength(
      80
    );
  });

  it.each([[undefined], [null], ['text'], [42], [[]]])(
    'gives null for %p',
    raw => {
      expect(toQuizStartScope(raw)).toBeNull();
    }
  );
});

describe('toggleSelection', () => {
  it('replaces the selection for a choice question', () => {
    expect(toggleSelection({ multiple: false }, ['a'], 'b')).toEqual(['b']);
    expect(toggleSelection({ multiple: false }, ['a'], 'a')).toEqual(['a']);
  });

  it('toggles for a multiple question', () => {
    expect(toggleSelection({ multiple: true }, ['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSelection({ multiple: true }, ['a', 'b'], 'a')).toEqual(['b']);
  });
});
