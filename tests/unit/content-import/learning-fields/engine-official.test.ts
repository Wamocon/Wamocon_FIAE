import { executeLearningFieldPlan } from '@/lib/content-import/learning-fields/engine';
import {
  OFFICIAL_LEARNING_FIELDS,
  officialHours,
} from '@/lib/content-import/learning-fields/official';
import { buildLearningFieldPlan } from '@/lib/content-import/learning-fields/plan';
import type { TitleSet } from '@/lib/content-import/learning-fields/titles';
import type { LearningFieldPlan } from '@/lib/content-import/learning-fields/types';

import {
  KFBM_CATALOG_ID,
  MemoryImportDb,
} from '../../../helpers/memoryImportDb';
import { sampleIndex, sampleSheet } from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const plan = (
  titles: TitleSet | null = null,
  official?: boolean
): LearningFieldPlan =>
  buildLearningFieldPlan(sampleSheet(), sampleIndex(), {
    now: NOW,
    titles,
    official,
  });

const LF = 'training_catalog_learning_fields' as const;

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

const run = (
  db: MemoryImportDb,
  p: LearningFieldPlan,
  options: { updateExisting?: boolean; write?: boolean } = {}
) =>
  executeLearningFieldPlan(db, p, {
    updateExisting: options.updateExisting ?? false,
    write: options.write ?? true,
  });

const seed = (db: MemoryImportDb, over: Record<string, unknown> = {}) =>
  db.tables[LF].push({
    id: 'lf-existing',
    training_catalog_id: KFBM_CATALOG_ID,
    code: 'LF1',
    title: OFFICIAL_LEARNING_FIELDS[0].title,
    description: OFFICIAL_LEARNING_FIELDS[0].description,
    training_year: 1,
    order_index: 1,
    hours_budget: null,
    ...over,
  });

const lf1 = (db: MemoryImportDb) => db.tables[LF].find(r => r.code === 'LF1');

describe('executeLearningFieldPlan: official titles and hours', () => {
  it('writes the official titles and the hours of all 13 learning fields', async () => {
    const db = database();
    const report = await run(db, plan());
    expect(report.tables[LF]).toEqual({ insert: 13, update: 0, unchanged: 0 });
    expect(db.tables[LF]).toHaveLength(13);
    for (const official of OFFICIAL_LEARNING_FIELDS) {
      expect(
        db.tables[LF].find(r => r.code === `LF${official.number}`)
      ).toMatchObject({
        title: official.title,
        training_year: official.trainingYear,
        hours_budget: official.hours,
      });
    }
    const total = db.tables[LF].reduce((n, r) => n + Number(r.hours_budget), 0);
    expect(total).toBe(officialHours());
    expect(total).toBe(880);
  });

  it('a dry comparison reports the counts and writes nothing', async () => {
    const db = database();
    const report = await run(db, plan(), { write: false });
    expect(report.tables[LF].insert).toBe(13);
    expect(db.log).toEqual([]);
  });

  it('is idempotent: the second run writes nothing', async () => {
    const db = database();
    await run(db, plan());
    db.log.length = 0;
    const again = await run(db, plan(), { updateExisting: true });
    expect(again.tables[LF]).toEqual({ insert: 0, update: 0, unchanged: 13 });
    expect(again.differences).toEqual([]);
    expect(db.log).toEqual([]);
  });

  it('keeps existing rows without --update-existing and only reports the hours', async () => {
    const db = database();
    seed(db);
    const report = await run(db, plan());
    expect(report.differences).toEqual([
      { table: LF, key: 'LF1', columns: ['hours_budget'] },
    ]);
    expect(report.tables[LF]).toEqual({ insert: 12, update: 0, unchanged: 1 });
    expect(lf1(db)?.hours_budget).toBeNull();
  });

  it('--update-existing sets the hours and touches no other column', async () => {
    const db = database();
    seed(db);
    db.log.length = 0;
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.tables[LF]).toEqual({ insert: 12, update: 1, unchanged: 0 });
    expect(db.log.filter(l => l.op === 'update')).toEqual([
      { op: 'update', table: LF, rows: 1, columns: ['hours_budget'] },
    ]);
    expect(lf1(db)).toMatchObject({
      id: 'lf-existing',
      code: 'LF1',
      training_year: 1,
      order_index: 1,
      hours_budget: 40,
    });
  });

  it('--update-existing replaces a provisional title of the source list and a wrong value of the hours', async () => {
    const db = database();
    seed(db, { title: 'Die eigene Rolle', hours_budget: 45 });
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.differences).toEqual([
      { table: LF, key: 'LF1', columns: ['title', 'hours_budget'] },
    ]);
    expect(lf1(db)).toMatchObject({
      title: OFFICIAL_LEARNING_FIELDS[0].title,
      hours_budget: 40,
    });
  });

  it('compares hours that the driver returns as a numeric string', async () => {
    const db = database();
    seed(db, { hours_budget: '40' });
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.differences).toEqual([]);
  });

  it('a skipped provisional title does not block the hours', async () => {
    const csv: TitleSet = {
      titles: { 1: 'Quellentitel' },
      years: {},
      source: 'csv',
      warnings: [],
    };
    const db = database();
    seed(db, { title: 'Von Hand', hours_budget: null });
    // the source list loses against the official title, so use the plan
    // without the official titles but with hours set by hand
    const p = plan(csv, false);
    p.learningFields[0].hoursBudget = 40;
    const report = await run(db, p, { updateExisting: true });
    expect(report.differences).toEqual([
      { table: LF, key: 'LF1', columns: ['title', 'hours_budget'] },
    ]);
    expect(lf1(db)).toMatchObject({ title: 'Von Hand', hours_budget: 40 });
  });

  it('an existing row that equals the official data is unchanged', async () => {
    const db = database();
    seed(db, { hours_budget: 40 });
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.differences).toEqual([]);
    expect(report.tables[LF]).toEqual({ insert: 12, update: 0, unchanged: 1 });
  });

  it('a plan without hours never erases the hours of a row that exists', async () => {
    const db = database();
    seed(db, { hours_budget: 40, title: 'Von Hand' });
    const report = await run(db, plan(null, false), { updateExisting: true });
    expect(report.differences).toEqual([]);
    expect(lf1(db)).toMatchObject({ title: 'Von Hand', hours_budget: 40 });
  });

  it('a conflict of the school year still stops a writing run before the first write', async () => {
    const db = database();
    seed(db, { training_year: 2 });
    await expect(
      run(db, plan(), { updateExisting: true })
    ).rejects.toMatchObject({ code: 'CONFLICTS' });
    expect(db.log).toEqual([]);
  });
});
