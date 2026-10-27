// --extend-quizzes: a quiz that exists with fewer questions gets the missing
// ones, in their place. Invented content, in memory database of the engine.
import { executePlan } from '@/lib/content-import/apply/engine';
import type { RunOptions } from '@/lib/content-import/apply/engine';
import { buildImportPlan } from '@/lib/content-import/apply/plan';
import { readLessonQuizzes } from '@/lib/content-import/quiz-json/read';

import { CREATOR_ID, MemoryImportDb } from '../../../helpers/memoryImportDb';
import { DIR, loadDecisions } from '../apply/fixtures';
import { clone, jsonQuiz, lessonFile } from './fixtures';

const NOW = new Date('2026-10-26T12:00:00Z');
const decisions = loadDecisions();
const options = (patch: Partial<RunOptions> = {}): RunOptions => ({
  createdBy: CREATOR_ID,
  updateExisting: false,
  write: true,
  activate: false,
  scenarioSolutions: false,
  ...patch,
});

/** The quiz 1a with ten questions per level. */
const full = () =>
  lessonFile([
    jsonQuiz({
      id: '1a',
      componentId: '01',
      dir: DIR.k1,
      title: '1a) Erfundenes Thema',
    }),
  ]);

/** The same quiz without the questions at the given places (1 based), renumbered. */
function without(places: number[], levels = ['leicht', 'mittel', 'schwer']) {
  const raw = clone(full());
  for (const level of levels) {
    const set = raw.quizzes[0].difficulties[level];
    set.questions = set.questions
      .filter((_: unknown, i: number) => !places.includes(i + 1))
      .map((q: any, i: number) => ({
        ...q,
        number: i + 1,
        id: `1a-${level}-q${i + 1}`,
      }));
  }
  return raw;
}

const planOf = (raw: unknown) =>
  buildImportPlan(readLessonQuizzes(raw).files, decisions, { now: NOW });

const texts = (db: MemoryImportDb, code: string) => {
  const quiz = db.tables.quizzes.find(q => q.code === code)!;
  return db.tables.questions
    .filter(q => q.quiz_id === quiz.id)
    .sort((a, b) => Number(a.order_index) - Number(b.order_index));
};

describe('--extend-quizzes', () => {
  async function eightFirst() {
    const db = new MemoryImportDb();
    const first = await executePlan(db, planOf(without([3, 7])), options());
    expect(first.conflicts).toEqual([]);
    expect(texts(db, 'K1-a-low')).toHaveLength(8);
    return db;
  }

  it('is a conflict without the switch, as before', async () => {
    const db = await eightFirst();
    await expect(
      executePlan(db, planOf(full()), options())
    ).rejects.toMatchObject({ code: 'CONFLICTS' });
    const check = await executePlan(
      db,
      planOf(full()),
      options({ write: false })
    );
    expect(check.conflicts).toHaveLength(3);
    expect(check.extended).toBeUndefined();
  });

  it('counts the added questions in a comparison without writing anything', async () => {
    const db = await eightFirst();
    const before = db.snapshot();
    const report = await executePlan(
      db,
      planOf(full()),
      options({ write: false, extendQuizzes: true })
    );
    expect(report.conflicts).toEqual([]);
    expect(report.extended).toEqual([
      { quiz: 'K1-a-low', added: 2, moved: 6 },
      { quiz: 'K1-a-medium', added: 2, moved: 6 },
      { quiz: 'K1-a-high', added: 2, moved: 6 },
    ]);
    expect(report.tables.questions).toEqual({
      insert: 6,
      update: 0,
      unchanged: 24,
    });
    expect(report.tables.options.insert).toBe(24);
    expect(report.wrote).toBe(false);
    expect(db.snapshot()).toEqual(before);
  });

  it('inserts in the middle: the order is right, existing rows keep id, text and answer', async () => {
    const db = await eightFirst();
    const existing = texts(db, 'K1-a-low');
    const ids = existing.map(q => q.id);
    const existingOptions = db.tables.options.filter(o =>
      ids.includes(o.question_id)
    );
    const quizzes = db.count('quizzes');

    const report = await executePlan(
      db,
      planOf(full()),
      options({ extendQuizzes: true })
    );
    expect(report.wrote).toBe(true);
    expect(report.conflicts).toEqual([]);

    const after = texts(db, 'K1-a-low');
    expect(after.map(q => q.order_index)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(after.map(q => q.question_text)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Erfundene Frage 1aLow${i + 1}?`)
    );
    // the old rows are the same rows
    for (const old of existing) {
      const now = after.find(q => q.id === old.id)!;
      expect(now.question_text).toBe(old.question_text);
    }
    expect(
      after.filter(q => !ids.includes(q.id)).map(q => q.order_index)
    ).toEqual([3, 7]);
    // nothing was removed, the old options are unchanged, the new questions have four
    for (const option of existingOptions) {
      const now = db.tables.options.find(o => o.id === option.id)!;
      expect(now).toEqual(option);
    }
    const newIds = after.filter(q => !ids.includes(q.id)).map(q => q.id);
    for (const id of newIds) {
      const own = db.tables.options.filter(o => o.question_id === id);
      expect(own.map(o => [o.order_index, o.is_correct])).toEqual([
        [1, false],
        [2, true],
        [3, false],
        [4, false],
      ]);
      expect(own.filter(o => o.explanation).length).toBe(1);
    }
    expect(db.count('quizzes')).toBe(quizzes);
    expect(db.count('questions')).toBe(30);
    expect(db.count('options')).toBe(120);
    expect(db.count('enabler_quiz_links')).toBe(3);
    // the solution only in its columns
    expect(db.tables.questions.every(q => q.expected_answer === null)).toBe(
      true
    );
  });

  it('a second run changes nothing', async () => {
    const db = await eightFirst();
    await executePlan(db, planOf(full()), options({ extendQuizzes: true }));
    const snapshot = db.snapshot();
    const again = await executePlan(
      db,
      planOf(full()),
      options({ extendQuizzes: true })
    );
    expect(again.conflicts).toEqual([]);
    expect(again.extended).toBeUndefined();
    expect(again.tables.questions.insert).toBe(0);
    expect(again.tables.questions.unchanged).toBe(30);
    expect(db.snapshot()).toEqual(snapshot);
    // and without the switch the full quiz is just a quiz that exists
    const plain = await executePlan(db, planOf(full()), options());
    expect(plain.conflicts).toEqual([]);
  });

  it('adds at the end and at the start as well', async () => {
    for (const places of [
      [9, 10],
      [1, 2],
      [1, 10],
    ]) {
      const db = new MemoryImportDb();
      await executePlan(db, planOf(without(places)), options());
      await executePlan(db, planOf(full()), options({ extendQuizzes: true }));
      expect(texts(db, 'K1-a-high').map(q => q.question_text)).toEqual(
        Array.from({ length: 10 }, (_, i) => `Erfundene Frage 1aHigh${i + 1}?`)
      );
    }
  });

  it('only one level may be incomplete', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, planOf(without([4], ['mittel'])), options());
    const report = await executePlan(
      db,
      planOf(full()),
      options({ extendQuizzes: true })
    );
    expect(report.extended).toEqual([
      { quiz: 'K1-a-medium', added: 1, moved: 6 },
    ]);
  });

  it('stays a conflict when an existing question is not in the plan (another text)', async () => {
    const db = await eightFirst();
    const changed = clone(full());
    changed.quizzes[0].difficulties.leicht.questions[1].question =
      'Erfundene andere Frage?';
    const check = await executePlan(
      db,
      planOf(changed),
      options({ write: false, extendQuizzes: true })
    );
    expect(check.conflicts.map(c => [c.table, c.key])).toEqual([
      ['quizzes', 'K1-a-low'],
    ]);
    expect(check.conflicts[0].reason).toMatch(/not all in the plan/);
    await expect(
      executePlan(db, planOf(changed), options({ extendQuizzes: true }))
    ).rejects.toMatchObject({ code: 'CONFLICTS' });
    expect(texts(db, 'K1-a-low')).toHaveLength(8);
  });

  it('stays a conflict when the order differs, or the plan has fewer questions', async () => {
    const db = await eightFirst();
    const swapped = clone(full());
    const qs = swapped.quizzes[0].difficulties.leicht.questions;
    [qs[0].question, qs[1].question] = [qs[1].question, qs[0].question];
    const check = await executePlan(
      db,
      planOf(swapped),
      options({ write: false, extendQuizzes: true })
    );
    expect(check.conflicts.map(c => c.key)).toEqual(['K1-a-low']);

    const fewer = await executePlan(
      db,
      planOf(without([1, 2, 3, 4, 5])),
      options({ write: false, extendQuizzes: true })
    );
    expect(fewer.conflicts.map(c => c.key).sort()).toEqual([
      'K1-a-high',
      'K1-a-low',
      'K1-a-medium',
    ]);
  });

  it('stays a conflict when the options of an existing question have another structure', async () => {
    const db = await eightFirst();
    const quiz = db.tables.quizzes.find(q => q.code === 'K1-a-low')!;
    const question = db.tables.questions.find(q => q.quiz_id === quiz.id)!;
    db.tables.options = db.tables.options.filter(
      o => !(o.question_id === question.id && o.order_index === 4)
    );
    const check = await executePlan(
      db,
      planOf(full()),
      options({ write: false, extendQuizzes: true })
    );
    expect(check.conflicts[0].reason).toMatch(
      /options of an existing question/
    );
  });

  it('an existing text that differs only in white space still matches', async () => {
    const db = await eightFirst();
    for (const q of db.tables.questions) {
      q.question_text = `  ${String(q.question_text).replace(' ', '   ')} `;
    }
    const report = await executePlan(
      db,
      planOf(full()),
      options({ extendQuizzes: true })
    );
    expect(report.conflicts).toEqual([]);
    expect(report.tables.questions.insert).toBe(6);
  });

  it('with --update-existing the texts of the old questions are still only the named columns', async () => {
    const db = await eightFirst();
    const report = await executePlan(
      db,
      planOf(full()),
      options({ extendQuizzes: true, updateExisting: true })
    );
    expect(report.conflicts).toEqual([]);
    expect(texts(db, 'K1-a-low')).toHaveLength(10);
  });

  it('does not touch another quiz and refuses a leak in an added question', async () => {
    const db = await eightFirst();
    const leaky = clone(full());
    leaky.quizzes[0].difficulties.leicht.questions[2].options[0].text =
      'Richtige Antwort: B';
    // the planner skips the quiz with the marker, so nothing is added
    const plan = planOf(leaky);
    expect(plan.skipped.map(s => s.code)).toContain('SOLUTION_MARKER');
    const report = await executePlan(
      db,
      plan,
      options({ extendQuizzes: true })
    );
    expect(report.extended?.map(e => e.quiz)).toEqual([
      'K1-a-medium',
      'K1-a-high',
    ]);
    expect(texts(db, 'K1-a-low')).toHaveLength(8);
  });
});
