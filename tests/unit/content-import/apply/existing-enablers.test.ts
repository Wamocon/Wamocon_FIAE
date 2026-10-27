// A supply brings a quiz or a scenario without the text of its enabler: the enabler of
// the database stands in for it (docs/ki-upload-konzept.md 8.9). Invented content.
import { executePlan } from '@/lib/content-import/apply/engine';
import {
  DATABASE_SOURCE_PREFIX,
  buildImportPlan,
  validatePlan,
  type ExistingEnabler,
} from '@/lib/content-import/apply/plan';

import { CREATOR_ID, MemoryImportDb } from '../../../helpers/memoryImportDb';
import { DIR, completeEnabler, loadDecisions } from './fixtures';

const NOW = new Date('2026-10-27T12:00:00Z');
const decisions = loadDecisions();
const run = {
  createdBy: CREATOR_ID,
  updateExisting: false,
  write: true,
  activate: false,
  scenarioSolutions: false,
  extendQuizzes: true,
};

const known = (...codes: string[]) =>
  new Map<string, ExistingEnabler>(
    codes.map(code => [
      code,
      {
        code,
        title: 'Erfundenes Enabler-Thema',
        componentCode: 'K1',
        orderIndex: 1,
      },
    ])
  );
const withoutText = () =>
  completeEnabler(DIR.k1, '1', 'a').filter(f => !/[\\/]1a\.docx$/.test(f.rel));

describe('existing enablers in the plan', () => {
  it('skips a quiz and a scenario without their enabler document, as before', () => {
    const plan = buildImportPlan(withoutText(), decisions, { now: NOW });
    expect(plan.quizzes).toEqual([]);
    expect(plan.scenarios).toEqual([]);
    expect(plan.skipped.filter(s => s.code === 'ENABLER_MISSING')).toHaveLength(
      4
    );
  });

  it('plans them with the enabler of the database, whose source names no file', () => {
    const plan = buildImportPlan(withoutText(), decisions, {
      now: NOW,
      existingEnablers: known('K1-a'),
    });
    expect(plan.quizzes.map(q => q.code).sort()).toEqual([
      'K1-a-high',
      'K1-a-low',
      'K1-a-medium',
    ]);
    expect(plan.scenarios.map(s => s.enablerCode)).toEqual(['K1-a']);
    expect(plan.enablers).toEqual([
      expect.objectContaining({
        code: 'K1-a',
        title: 'Erfundenes Enabler-Thema',
        descriptionText: null,
        source: `${DATABASE_SOURCE_PREFIX}K1-a`,
      }),
    ]);
    expect(validatePlan(plan)).toEqual([]);
    // the quiz title is the one of the first delivery (title of the enabler plus the level)
    expect(plan.quizzes[0].title).toContain('Erfundenes Enabler-Thema');
  });

  it('prefers the document of the delivery, and takes no enabler of another component', () => {
    const all = completeEnabler(DIR.k1, '1', 'a');
    const plan = buildImportPlan(all, decisions, {
      now: NOW,
      existingEnablers: known('K1-a'),
    });
    expect(plan.enablers).toHaveLength(1);
    expect(plan.enablers[0].source).not.toContain(DATABASE_SOURCE_PREFIX);

    const other = new Map<string, ExistingEnabler>([
      [
        'K1-a',
        { code: 'K1-a', title: 'x', componentCode: 'K6.1', orderIndex: 1 },
      ],
    ]);
    const skipped = buildImportPlan(withoutText(), decisions, {
      now: NOW,
      existingEnablers: other,
    });
    expect(skipped.quizzes).toEqual([]);
    expect(skipped.skipped.some(s => s.code === 'ENABLER_MISSING')).toBe(true);
  });

  it('writes the quizzes and the scenario to the existing enabler and nothing for the enabler', async () => {
    const db = new MemoryImportDb();
    const first = buildImportPlan(
      completeEnabler(DIR.k1, '1', 'a'),
      decisions,
      { now: NOW }
    );
    await executePlan(db, first, run);
    // delete what a supply would bring, to see it come back
    db.tables.content_documents = [];
    const quizIds = db.tables.quizzes
      .filter(q => q.code === 'K1-a-high')
      .map(q => q.id);
    db.tables.options = db.tables.options.filter(
      o =>
        !db.tables.questions.some(
          q => q.id === o.question_id && quizIds.includes(q.quiz_id)
        )
    );
    db.tables.questions = db.tables.questions.filter(
      q => !quizIds.includes(q.quiz_id)
    );

    const plan = buildImportPlan(withoutText(), decisions, {
      now: NOW,
      existingEnablers: known('K1-a'),
    });
    const events: string[] = [];
    const report = await executePlan(db, plan, {
      ...run,
      observe: e => events.push(`${e.table}:${e.key}:${e.status}`),
    });
    expect(report.conflicts).toEqual([]);
    expect(report.tables.enablers).toEqual({
      insert: 0,
      update: 0,
      unchanged: 1,
    });
    expect(report.tables.content_documents.insert).toBe(1);
    expect(events).toContain('quizzes:K1-a-high:extended');
    expect(db.tables.enablers).toHaveLength(1);
  });
});
