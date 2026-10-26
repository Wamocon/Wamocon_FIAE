import { ImportAbort } from '@/lib/content-import/apply/db';
import { executeLearningFieldPlan } from '@/lib/content-import/learning-fields/engine';
import { buildLearningFieldPlan } from '@/lib/content-import/learning-fields/plan';
import type { TitleSet } from '@/lib/content-import/learning-fields/titles';
import type { LearningFieldPlan } from '@/lib/content-import/learning-fields/types';

import {
  FIAE_CATALOG_ID,
  KFBM_CATALOG_ID,
  MemoryImportDb,
  inTransaction,
} from '../../../helpers/memoryImportDb';
import { sampleIndex, sampleSheet } from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const plan = (titles: TitleSet | null = null): LearningFieldPlan =>
  buildLearningFieldPlan(sampleSheet(), sampleIndex(), { now: NOW, titles });

const ENABLERS = ['K1-a', 'K1-b', 'K6.1-a', 'K6.2-d', 'K24.1-a'];

function database(codes: string[] = ENABLERS, catalogId = KFBM_CATALOG_ID) {
  const db = new MemoryImportDb();
  codes.forEach((code, i) =>
    db.tables.enablers.push({
      id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
      course_id: 'course',
      training_catalog_id: catalogId,
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

const LF = 'training_catalog_learning_fields' as const;
const MAP = 'training_catalog_content_mappings' as const;

describe('executeLearningFieldPlan: first run', () => {
  it('writes the 13 learning fields and the mappings of the enablers that exist', async () => {
    const db = database();
    const report = await run(db, plan());
    expect(report.wrote).toBe(true);
    expect(report.tables[LF]).toEqual({ insert: 13, update: 0, unchanged: 0 });
    expect(report.tables[MAP]).toEqual({ insert: 22, update: 0, unchanged: 0 });
    expect(report.conflicts).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(db.count(LF)).toBe(13);
    expect(db.count(MAP)).toBe(22);

    const lf = db.tables[LF].find(r => r.code === 'LF5');
    expect(lf).toMatchObject({
      training_catalog_id: KFBM_CATALOG_ID,
      title: 'Lernfeld 5',
      training_year: 2,
      order_index: 5,
      hours_budget: null,
      description: null,
    });
    const k61 = db.tables.enablers.find(r => r.code === 'K6.1-a');
    const mapped = db.tables[MAP].filter(r => r.enabler_id === k61?.id).map(
      r => db.tables[LF].find(f => f.id === r.learning_field_id)?.code
    );
    expect(mapped).toEqual(['LF3', 'LF5', 'LF7']);
    expect(db.tables[MAP].every(r => r.use_case_id == null)).toBe(true);
    expect(
      db.tables[MAP].every(r => r.training_catalog_id === KFBM_CATALOG_ID)
    ).toBe(true);
  });

  it('is idempotent: the second run writes nothing', async () => {
    const db = database();
    await run(db, plan());
    db.log.length = 0;
    const again = await run(db, plan());
    expect(db.log).toEqual([]);
    expect(again.tables[LF]).toEqual({ insert: 0, update: 0, unchanged: 13 });
    expect(again.tables[MAP]).toEqual({ insert: 0, update: 0, unchanged: 22 });
    expect(db.count(LF)).toBe(13);
    expect(db.count(MAP)).toBe(22);
  });

  it('a comparison without write reports the counts and changes nothing', async () => {
    const db = database();
    const report = await run(db, plan(), { write: false });
    expect(report.wrote).toBe(false);
    expect(report.tables[LF].insert).toBe(13);
    expect(report.tables[MAP].insert).toBe(22);
    expect(db.log).toEqual([]);
    expect(db.count(LF)).toBe(0);
  });

  it('a rolled back run leaves nothing behind', async () => {
    const db = database();
    await inTransaction(db, 'rollback', () => run(db, plan()));
    expect(db.count(LF)).toBe(0);
    expect(db.count(MAP)).toBe(0);
  });

  it('leaves the learning fields of another catalog alone', async () => {
    const db = database();
    db.tables[LF].push({
      id: 'fiae-lf1',
      training_catalog_id: FIAE_CATALOG_ID,
      code: 'LF1',
      title: 'FIAE Lernfeld',
      training_year: 1,
      order_index: 1,
    });
    const report = await run(db, plan());
    expect(report.tables[LF].insert).toBe(13);
    expect(db.tables[LF].find(r => r.id === 'fiae-lf1')?.title).toBe(
      'FIAE Lernfeld'
    );
  });

  it('looks for enablers in the catalog KFBM only', async () => {
    const db = database(ENABLERS);
    database(['K1-a'], FIAE_CATALOG_ID).tables.enablers.forEach(row =>
      db.tables.enablers.push({ ...row, id: 'fiae-enabler' })
    );
    await run(db, plan());
    expect(db.tables[MAP].some(r => r.enabler_id === 'fiae-enabler')).toBe(
      false
    );
  });
});

describe('executeLearningFieldPlan: enablers of the import', () => {
  it('reports mappings of missing enablers as skipped and fills them in the next run', async () => {
    const db = database(['K1-a', 'K24.1-a']);
    const report = await run(db, plan());
    expect(report.tables[MAP].insert).toBe(3 + 13);
    expect(
      report.skipped.map(s => [s.code, s.enablerCode, s.pairs, s.componentCode])
    ).toEqual([
      ['ENABLER_NOT_IN_DATABASE', 'K1-b', 1, 'K1'],
      ['ENABLER_NOT_IN_DATABASE', 'K6.1-a', 3, 'K6.1'],
      ['ENABLER_NOT_IN_DATABASE', 'K6.2-d', 2, 'K6.2'],
    ]);

    // the import brings the enablers, a second run adds only the missing mappings
    db.tables.enablers.push({
      id: 'e-late',
      course_id: 'c',
      training_catalog_id: KFBM_CATALOG_ID,
      code: 'K1-b',
    });
    const second = await run(db, plan());
    expect(second.tables[LF]).toEqual({ insert: 0, update: 0, unchanged: 13 });
    expect(second.tables[MAP]).toEqual({ insert: 1, update: 0, unchanged: 16 });
    expect(second.skipped).toHaveLength(2);
  });

  it('a provisional title of the source list replaces only the placeholder, never a title that was set', async () => {
    const csv: TitleSet = {
      titles: { 1: 'Quellentitel', 2: 'Zweiter' },
      years: {},
      source: 'csv',
      warnings: [],
    };
    const db = database();
    db.tables[LF].push(
      {
        id: 'lf-set',
        training_catalog_id: KFBM_CATALOG_ID,
        code: 'LF1',
        title: 'Von Hand',
        training_year: 1,
        order_index: 1,
      },
      {
        id: 'lf-placeholder',
        training_catalog_id: KFBM_CATALOG_ID,
        code: 'LF2',
        title: 'Lernfeld 2',
        training_year: 1,
        order_index: 2,
      }
    );
    const report = await run(db, plan(csv), { updateExisting: true });
    expect(report.differences.map(d => d.key)).toEqual(['LF1', 'LF2']);
    expect(report.tables[LF].update).toBe(1);
    expect(db.tables[LF].find(r => r.code === 'LF1')?.title).toBe('Von Hand');
    expect(db.tables[LF].find(r => r.code === 'LF2')?.title).toBe('Zweiter');
  });

  it('stops when two enablers of the catalog share a code', async () => {
    const db = database();
    db.tables.enablers.push({
      id: 'e-dup',
      course_id: 'other',
      training_catalog_id: KFBM_CATALOG_ID,
      code: 'K1-a',
    });
    await expect(run(db, plan())).rejects.toMatchObject({
      code: 'ENABLER_CODE_DUPLICATE',
    });
    expect(db.log).toEqual([]);
  });

  it('stops when the catalog has no enablers at all (the content import comes first)', async () => {
    const db = database([]);
    await expect(run(db, plan())).rejects.toMatchObject({
      name: 'ImportAbort',
      code: 'NO_ENABLERS',
    });
    expect(db.count(LF)).toBe(0);
    // the comparison stops too
    await expect(run(db, plan(), { write: false })).rejects.toBeInstanceOf(
      ImportAbort
    );
  });
});

describe('executeLearningFieldPlan: the target catalog', () => {
  it('stops without the catalog or with an inactive catalog', async () => {
    const missing = database();
    missing.catalogs = missing.catalogs.filter(c => c.code !== 'KFBM');
    await expect(run(missing, plan())).rejects.toMatchObject({
      code: 'CATALOG_MISSING',
    });

    const inactive = database();
    inactive.catalogs.find(c => c.code === 'KFBM')!.is_active = false;
    await expect(run(inactive, plan())).rejects.toMatchObject({
      code: 'CATALOG_INACTIVE',
    });
  });

  it('stops on an invalid plan before it reads anything', async () => {
    const db = database();
    const broken = plan();
    broken.catalog = 'FIAE';
    await expect(run(db, broken)).rejects.toMatchObject({
      code: 'PLAN_INVALID',
    });
    expect(db.log).toEqual([]);
  });
});

describe('executeLearningFieldPlan: rows that exist', () => {
  const seedField = (db: MemoryImportDb, over: Record<string, unknown> = {}) =>
    db.tables[LF].push({
      id: 'lf-existing',
      training_catalog_id: KFBM_CATALOG_ID,
      code: 'LF1',
      title: 'Von Hand',
      training_year: 1,
      order_index: 1,
      hours_budget: 40,
      ...over,
    });

  it('never replaces a title by a placeholder and keeps the hours', async () => {
    const db = database();
    seedField(db);
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.differences).toEqual([]);
    expect(report.tables[LF]).toEqual({ insert: 12, update: 0, unchanged: 1 });
    const lf1 = db.tables[LF].find(r => r.code === 'LF1');
    expect(lf1).toMatchObject({ title: 'Von Hand', hours_budget: 40 });
  });

  it('reports a different title and updates only the title with --update-existing', async () => {
    const titles: TitleSet = {
      titles: { 1: 'Quellentitel' },
      years: {},
      source: 'json',
      warnings: [],
    };
    const db = database();
    seedField(db);
    const report = await run(db, plan(titles));
    expect(report.differences).toEqual([
      { table: LF, key: 'LF1', columns: ['title'] },
    ]);
    expect(db.tables[LF].find(r => r.code === 'LF1')?.title).toBe('Von Hand');

    db.log.length = 0;
    const updated = await run(db, plan(titles), { updateExisting: true });
    expect(updated.tables[LF].update).toBe(1);
    expect(db.log).toEqual([
      { op: 'update', table: LF, rows: 1, columns: ['title'] },
    ]);
    const lf1 = db.tables[LF].find(r => r.code === 'LF1');
    expect(lf1).toMatchObject({
      title: 'Quellentitel',
      hours_budget: 40,
      training_year: 1,
      order_index: 1,
    });
  });

  it('reports a different order without changing it', async () => {
    const db = database();
    seedField(db, { order_index: 20, title: 'Lernfeld 1' });
    const report = await run(db, plan(), { updateExisting: true });
    expect(report.differences).toEqual([
      { table: LF, key: 'LF1', columns: ['order_index'] },
    ]);
    expect(db.tables[LF].find(r => r.code === 'LF1')?.order_index).toBe(20);
  });

  it('stops before the first write on a conflict', async () => {
    const wrongYear = database();
    seedField(wrongYear, { training_year: 2 });
    await expect(run(wrongYear, plan())).rejects.toMatchObject({
      code: 'CONFLICTS',
      conflicts: [
        {
          table: LF,
          key: 'LF1',
          reason:
            'The learning field exists with school year 2, the plan says 1.',
        },
      ],
    });
    expect(wrongYear.log).toEqual([]);

    // the comparison without write only reports it
    const report = await run(wrongYear, plan(), { write: false });
    expect(report.conflicts).toHaveLength(1);

    const taken = database();
    seedField(taken, { code: 'LF-alt', order_index: 3 });
    await expect(run(taken, plan())).rejects.toMatchObject({
      code: 'CONFLICTS',
      conflicts: [
        {
          table: LF,
          key: 'LF3',
          reason: 'The position 3 is taken by the learning field LF-alt.',
        },
      ],
    });
    expect(taken.log).toEqual([]);
  });

  it('keeps mappings that the plan does not name', async () => {
    const db = database();
    await run(db, plan());
    const lf1 = db.tables[LF].find(r => r.code === 'LF1');
    const enabler = db.tables.enablers.find(r => r.code === 'K1-b');
    db.tables[MAP].push({
      id: 'extra',
      learning_field_id: lf1?.id,
      enabler_id: enabler?.id,
      use_case_id: null,
      training_catalog_id: KFBM_CATALOG_ID,
    });
    const report = await run(db, plan());
    expect(report.keptMappings).toBe(1);
    expect(db.tables[MAP].some(r => r.id === 'extra')).toBe(true);
    expect(report.tables[MAP]).toEqual({ insert: 0, update: 0, unchanged: 22 });
  });
});
