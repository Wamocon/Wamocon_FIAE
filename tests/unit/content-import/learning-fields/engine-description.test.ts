import { executeLearningFieldPlan } from '@/lib/content-import/learning-fields/engine';
import { OFFICIAL_LEARNING_FIELDS } from '@/lib/content-import/learning-fields/official';
import { buildLearningFieldPlan } from '@/lib/content-import/learning-fields/plan';
import type { LearningFieldPlan } from '@/lib/content-import/learning-fields/types';

import {
  KFBM_CATALOG_ID,
  MemoryImportDb,
} from '../../../helpers/memoryImportDb';
import { sampleIndex, sampleSheet } from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const plan = (official?: boolean): LearningFieldPlan =>
  buildLearningFieldPlan(sampleSheet(), sampleIndex(), {
    now: NOW,
    official,
  });

const LF = 'training_catalog_learning_fields' as const;
const OFFICIAL_1 = OFFICIAL_LEARNING_FIELDS[0];

function database() {
  const db = new MemoryImportDb();
  ['K1-a', 'K1-b', 'K6.1-a', 'K6.2-d', 'K24.1-a'].forEach((code, i) =>
    db.tables.enablers.push({
      id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
      course_id: 'course',
      training_catalog_id: KFBM_CATALOG_ID,
      code,
    })
  );
  return db;
}

/** A learning field that exists with title and hours of the official data. */
const seed = (db: MemoryImportDb, over: Record<string, unknown> = {}) =>
  db.tables[LF].push({
    id: 'lf-existing',
    training_catalog_id: KFBM_CATALOG_ID,
    code: 'LF1',
    title: OFFICIAL_1.title,
    training_year: 1,
    order_index: 1,
    hours_budget: OFFICIAL_1.hours,
    ...over,
  });

const run = (
  db: MemoryImportDb,
  p: LearningFieldPlan,
  options: { updateExisting?: boolean; write?: boolean } = {}
) =>
  executeLearningFieldPlan(db, p, {
    updateExisting: options.updateExisting ?? false,
    write: options.write ?? true,
  });

const lf1 = (db: MemoryImportDb) => db.tables[LF].find(r => r.code === 'LF1');
const updates = (db: MemoryImportDb) => db.log.filter(l => l.op === 'update');

describe('executeLearningFieldPlan: descriptions', () => {
  it('writes the official description of all 13 new learning fields', async () => {
    const db = database();
    const report = await run(db, plan());
    expect(report.tables[LF].insert).toBe(13);
    for (const official of OFFICIAL_LEARNING_FIELDS) {
      expect(
        db.tables[LF].find(r => r.code === `LF${official.number}`)
      ).toMatchObject({ description: official.description });
    }
  });

  it('writes no description when the plan has none', async () => {
    const db = database();
    await run(db, plan(false));
    expect(db.tables[LF].every(r => r.description === null)).toBe(true);
  });

  it.each([
    ['null', { description: null }],
    ['an empty text', { description: '' }],
    ['only white space', { description: '  \n ' }],
    ['no value at all', {}],
  ])(
    'fills an empty description (%s) without --update-existing',
    async (_name, over) => {
      const db = database();
      seed(db, over);
      db.log.length = 0;
      const report = await run(db, plan());
      expect(report.differences).toMatchObject([
        { table: LF, key: 'LF1', columns: ['description'] },
      ]);
      expect(report.tables[LF]).toEqual({
        insert: 12,
        update: 1,
        unchanged: 0,
      });
      expect(updates(db)).toEqual([
        { op: 'update', table: LF, rows: 1, columns: ['description'] },
      ]);
      expect(lf1(db)).toMatchObject({
        id: 'lf-existing',
        title: OFFICIAL_1.title,
        description: OFFICIAL_1.description,
        training_year: 1,
        order_index: 1,
        hours_budget: OFFICIAL_1.hours,
      });
    }
  );

  it('never replaces a description that has text without --update-existing', async () => {
    const db = database();
    seed(db, { description: 'Von Hand geschrieben.' });
    db.log.length = 0;
    const report = await run(db, plan());
    expect(report.differences).toMatchObject([
      { table: LF, key: 'LF1', columns: ['description'] },
    ]);
    // the report names the lengths before (21) and after, numbers only
    expect(report.differences[0].lengths?.description.before).toBe(21);
    expect(report.tables[LF]).toEqual({ insert: 12, update: 0, unchanged: 1 });
    expect(updates(db)).toEqual([]);
    expect(lf1(db)?.description).toBe('Von Hand geschrieben.');
  });

  it('--update-existing replaces a description that differs', async () => {
    const db = database();
    seed(db, { description: 'Von Hand geschrieben.' });
    db.log.length = 0;
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.tables[LF]).toEqual({ insert: 12, update: 1, unchanged: 0 });
    expect(updates(db)).toEqual([
      { op: 'update', table: LF, rows: 1, columns: ['description'] },
    ]);
    expect(lf1(db)?.description).toBe(OFFICIAL_1.description);
  });

  it('a description that equals the official one is unchanged, also with --update-existing', async () => {
    const db = database();
    seed(db, { description: OFFICIAL_1.description });
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.differences).toEqual([]);
    expect(report.tables[LF]).toEqual({ insert: 12, update: 0, unchanged: 1 });
  });

  it('a plan without a description never erases one that exists', async () => {
    const db = database();
    seed(db, { description: 'Von Hand geschrieben.' });
    const report = await run(db, plan(false), { updateExisting: true });
    expect(report.differences).toEqual([]);
    expect(lf1(db)?.description).toBe('Von Hand geschrieben.');
  });

  it('is idempotent: the second run writes nothing', async () => {
    const db = database();
    seed(db, { description: null });
    await run(db, plan());
    db.log.length = 0;
    const again = await run(db, plan());
    expect(db.log).toEqual([]);
    expect(again.tables[LF]).toEqual({ insert: 0, update: 0, unchanged: 13 });
    expect(again.differences).toEqual([]);
  });

  it('a comparison without write fills nothing', async () => {
    const db = database();
    seed(db, { description: null });
    const report = await run(db, plan(), { write: false });
    expect(report.tables[LF].update).toBe(1);
    expect(db.log).toEqual([]);
    expect(lf1(db)?.description).toBeNull();
  });
});
