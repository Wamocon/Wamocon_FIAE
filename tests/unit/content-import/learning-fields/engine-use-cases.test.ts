import { executeLearningFieldPlan } from '@/lib/content-import/learning-fields/engine';
import { buildLearningFieldPlan } from '@/lib/content-import/learning-fields/plan';
import type { LearningFieldPlan } from '@/lib/content-import/learning-fields/types';

import {
  FIAE_CATALOG_ID,
  KFBM_CATALOG_ID,
  MemoryImportDb,
  inTransaction,
} from '../../../helpers/memoryImportDb';
import { sampleIndex, sampleSheet } from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const plan = (): LearningFieldPlan =>
  buildLearningFieldPlan(sampleSheet(), sampleIndex(), { now: NOW });

const LF = 'training_catalog_learning_fields' as const;
const MAP = 'training_catalog_content_mappings' as const;
const UC = 'use_cases' as const;

const ENABLERS = ['K1-a', 'K1-b', 'K6.1-a', 'K6.2-d', 'K24.1-a'];
const enablerId = (code: string) =>
  `00000000-0000-4000-a000-${String(ENABLERS.indexOf(code) + 1).padStart(12, '0')}`;

/** Enablers of the catalog, and use cases for K1-a, K1-b and K6.1-a only. */
function database(withUseCases = true) {
  const db = new MemoryImportDb();
  ENABLERS.forEach(code =>
    db.tables.enablers.push({
      id: enablerId(code),
      course_id: 'course',
      training_catalog_id: KFBM_CATALOG_ID,
      code,
    })
  );
  if (withUseCases) {
    for (const [code, enabler] of [
      ['1a', 'K1-a'],
      ['1b', 'K1-b'],
      ['6a', 'K6.1-a'],
    ]) {
      addUseCase(db, code, enablerId(enabler));
    }
  }
  return db;
}

function addUseCase(
  db: MemoryImportDb,
  code: string,
  enabler: string | null,
  over: Record<string, unknown> = {}
) {
  const row = {
    id: `00000000-0000-4000-b000-${String(db.tables[UC].length + 1).padStart(12, '0')}`,
    course_id: 'course',
    training_catalog_id: KFBM_CATALOG_ID,
    enabler_id: enabler,
    code,
    lernfelder: [],
    ...over,
  };
  db.tables[UC].push(row);
  return row;
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

const useCase = (db: MemoryImportDb, code: string) =>
  db.tables[UC].find(r => r.code === code);
const fieldCode = (db: MemoryImportDb, id: unknown) =>
  db.tables[LF].find(r => r.id === id)?.code;
/** Learning field codes of the mapping rows of one content row. */
const codesOf = (
  db: MemoryImportDb,
  key: 'enabler_id' | 'use_case_id',
  id: unknown
) =>
  db.tables[MAP].filter(r => r[key] === id).map(r =>
    String(fieldCode(db, r.learning_field_id))
  );
const plannedFor = (p: LearningFieldPlan, enabler: string) =>
  p.mappings
    .filter(m => m.enablerCode === enabler)
    .map(m => m.learningFieldCode);

describe('executeLearningFieldPlan: use case mappings', () => {
  it('maps every learning field of an enabler to the use case of that enabler', async () => {
    const db = database();
    const p = plan();
    const report = await run(db, p);

    const expected = ['K1-a', 'K1-b', 'K6.1-a'].reduce(
      (n, code) => n + plannedFor(p, code).length,
      0
    );
    expect(expected).toBeGreaterThan(0);
    expect(report.useCaseMappings).toEqual({
      insert: expected,
      update: 0,
      unchanged: 0,
    });
    expect(report.wrote).toBe(true);
    expect(db.tables[MAP].filter(r => r.use_case_id != null)).toHaveLength(
      expected
    );

    for (const [code, enabler] of [
      ['1a', 'K1-a'],
      ['1b', 'K1-b'],
      ['6a', 'K6.1-a'],
    ]) {
      const uc = useCase(db, code);
      expect(codesOf(db, 'use_case_id', uc?.id).sort()).toEqual(
        plannedFor(p, enabler).sort()
      );
    }
  });

  it('writes a row of its own per use case: exactly one of enabler and use case', async () => {
    const db = database();
    await run(db, plan());
    for (const row of db.tables[MAP]) {
      expect((row.enabler_id == null) !== (row.use_case_id == null)).toBe(true);
      expect(row.training_catalog_id).toBe(KFBM_CATALOG_ID);
    }
    // the enabler rows are the same as without use cases
    const withoutUseCases = database(false);
    await run(withoutUseCases, plan());
    expect(db.tables[MAP].filter(r => r.enabler_id != null)).toHaveLength(
      withoutUseCases.count(MAP)
    );
  });

  it('adds the learning field codes to use_cases.lernfelder in the order of the learning fields', async () => {
    const db = database();
    const p = plan();
    await run(db, p);
    const codes = (uc: string) => useCase(db, uc)?.lernfelder as string[];
    expect(codes('6a')).toEqual(['LF3', 'LF5', 'LF7']);
    for (const [uc, enabler] of [
      ['1a', 'K1-a'],
      ['1b', 'K1-b'],
    ]) {
      const wanted = [...new Set(plannedFor(p, enabler))].sort(
        (a, b) => Number(a.slice(2)) - Number(b.slice(2))
      );
      expect(codes(uc)).toEqual(wanted);
    }
  });

  it('keeps codes that are already there and only adds the missing ones', async () => {
    const db = database(false);
    addUseCase(db, '6a', enablerId('K6.1-a'), { lernfelder: ['LF5', 'LF-9'] });
    const report = await run(db, plan());
    expect(useCase(db, '6a')?.lernfelder).toEqual([
      'LF5',
      'LF-9',
      'LF3',
      'LF7',
    ]);
    expect(report.useCaseCodes).toEqual({ insert: 0, update: 1, unchanged: 0 });
  });

  it('reads an empty array column (null) as no codes', async () => {
    const db = database(false);
    addUseCase(db, '6a', enablerId('K6.1-a'), { lernfelder: null });
    await run(db, plan());
    expect(useCase(db, '6a')?.lernfelder).toEqual(['LF3', 'LF5', 'LF7']);
  });

  it('is idempotent: the second run writes nothing', async () => {
    const db = database();
    const first = await run(db, plan());
    const rows = db.count(MAP);
    db.log.length = 0;
    const again = await run(db, plan(), { updateExisting: true });
    expect(db.log).toEqual([]);
    expect(db.count(MAP)).toBe(rows);
    expect(again.useCaseMappings).toEqual({
      insert: 0,
      update: 0,
      unchanged: first.useCaseMappings.insert,
    });
    expect(again.useCaseCodes).toEqual({
      insert: 0,
      update: 0,
      unchanged: first.useCaseCodes.update,
    });
    expect(again.tables[MAP].insert).toBe(0);
  });

  it('writes only what is missing and leaves existing rows alone', async () => {
    const db = database();
    const p = plan();
    await run(db, p);
    // one use case row and one code are lost, one extra row of the owner exists
    const uc = useCase(db, '6a');
    const lf5 = db.tables[LF].find(r => r.code === 'LF5');
    db.tables[MAP] = db.tables[MAP].filter(
      r => !(r.use_case_id === uc?.id && r.learning_field_id === lf5?.id)
    );
    (uc as Record<string, unknown>).lernfelder = ['LF3', 'LF7'];
    const lf9 = db.tables[LF].find(r => r.code === 'LF9');
    db.tables[MAP].push({
      id: 'extra',
      learning_field_id: lf9?.id,
      use_case_id: uc?.id,
      training_catalog_id: KFBM_CATALOG_ID,
    });
    const before = db.snapshot();
    db.log.length = 0;
    const report = await run(db, p);
    expect(report.useCaseMappings).toMatchObject({ insert: 1, update: 0 });
    expect(report.useCaseCodes).toMatchObject({ update: 1 });
    expect(uc?.lernfelder).toEqual(['LF3', 'LF7', 'LF5']);
    expect(report.keptMappings).toBe(1);
    expect(db.tables[MAP].some(r => r.id === 'extra')).toBe(true);
    expect(db.log.map(l => [l.op, l.table, l.rows])).toEqual([
      ['insert', MAP, 1],
      ['update', UC, 1],
    ]);
    expect(JSON.parse(before).tables[UC]).toHaveLength(3);
  });

  it('reports the enablers that have no use case', async () => {
    const db = database();
    const p = plan();
    const report = await run(db, p);
    const mapped = new Set(p.mappings.map(m => m.enablerCode));
    expect(report.enablersWithoutUseCase.sort()).toEqual(
      ['K6.2-d', 'K24.1-a'].filter(code => mapped.has(code)).sort()
    );
    expect(report.enablersWithoutUseCase.length).toBeGreaterThan(0);
  });

  it('reports the use cases that are linked to no enabler and gives them no learning field', async () => {
    const db = database();
    const orphan = addUseCase(db, '5b', null);
    addUseCase(db, '9z', null);
    const report = await run(db, plan());
    expect(report.useCasesWithoutEnabler.sort()).toEqual(['5b', '9z']);
    expect(codesOf(db, 'use_case_id', orphan.id)).toEqual([]);
    expect(orphan.lernfelder).toEqual([]);
  });

  it('writes no use case rows before the use case import and adds them in a second run', async () => {
    const db = database(false);
    const p = plan();
    const first = await run(db, p);
    expect(first.useCaseMappings).toEqual({
      insert: 0,
      update: 0,
      unchanged: 0,
    });
    expect(first.enablersWithoutUseCase.length).toBe(
      new Set(p.mappings.map(m => m.enablerCode)).size
    );
    expect(db.tables[MAP].every(r => r.use_case_id == null)).toBe(true);

    addUseCase(db, '1a', enablerId('K1-a'));
    const second = await run(db, p);
    expect(second.useCaseMappings.insert).toBe(
      new Set(plannedFor(p, 'K1-a')).size
    );
    expect(second.tables[MAP].insert).toBe(0);
    expect(second.tables[LF].insert).toBe(0);
  });

  it('a comparison without write reports the counts and changes nothing', async () => {
    const db = database();
    const report = await run(db, plan(), { write: false });
    expect(report.wrote).toBe(false);
    expect(report.useCaseMappings.insert).toBeGreaterThan(0);
    expect(report.useCaseCodes.update).toBe(3);
    expect(db.log).toEqual([]);
    expect(db.count(MAP)).toBe(0);
    expect(useCase(db, '6a')?.lernfelder).toEqual([]);
  });

  it('a rolled back run leaves nothing behind', async () => {
    const db = database();
    await inTransaction(db, 'rollback', () => run(db, plan()));
    expect(db.count(MAP)).toBe(0);
    expect(useCase(db, '6a')?.lernfelder).toEqual([]);
  });

  it('ignores the use cases of another catalog', async () => {
    const db = database(false);
    addUseCase(db, 'fiae', enablerId('K6.1-a'), {
      training_catalog_id: FIAE_CATALOG_ID,
    });
    addUseCase(db, 'fiae-free', null, { training_catalog_id: FIAE_CATALOG_ID });
    const report = await run(db, plan());
    expect(report.useCaseMappings.insert).toBe(0);
    expect(report.useCasesWithoutEnabler).toEqual([]);
    expect(useCase(db, 'fiae')?.lernfelder).toEqual([]);
  });

  it('does not carry a NULL element of the array over as the text "null"', async () => {
    const db = database(false);
    addUseCase(db, '6a', enablerId('K6.1-a'), { lernfelder: [null, 'LF5'] });
    await run(db, plan());
    expect(useCase(db, '6a')?.lernfelder).toEqual(['LF5', 'LF3', 'LF7']);
  });

  it('adds the codes also with --update-existing and then changes nothing', async () => {
    const db = database();
    const first = await run(db, plan(), { updateExisting: true });
    expect(first.useCaseCodes.update).toBe(3);
    expect(useCase(db, '6a')?.lernfelder).toEqual(['LF3', 'LF5', 'LF7']);
    db.log.length = 0;
    await run(db, plan(), { updateExisting: true });
    expect(db.log).toEqual([]);
  });

  it('stops before the first write when two use cases hang on one enabler', async () => {
    const db = database();
    addUseCase(db, 'dup', enablerId('K1-a'));
    await expect(run(db, plan())).rejects.toMatchObject({
      code: 'USE_CASE_ENABLER_DUPLICATE',
    });
    expect(db.log).toEqual([]);
    expect(db.count(LF)).toBe(0);
  });

  it('names a use case by its id when it has no code', async () => {
    const db = database(false);
    const row = addUseCase(db, '', null);
    delete (row as Record<string, unknown>).code;
    const report = await run(db, plan());
    expect(report.useCasesWithoutEnabler).toEqual([String(row.id)]);
  });

  it('does not write use case rows for an enabler that is not in the database', async () => {
    const db = database();
    db.tables.enablers = db.tables.enablers.filter(r => r.code !== 'K6.1-a');
    const report = await run(db, plan());
    expect(codesOf(db, 'use_case_id', useCase(db, '6a')?.id)).toEqual([]);
    expect(report.skipped.map(s => s.enablerCode)).toContain('K6.1-a');
  });
});
