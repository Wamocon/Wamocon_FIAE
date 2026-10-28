import { ImportAbort } from '@/lib/content-import/apply/db';
import {
  executeUseCasePlan,
  documentRowsOfUseCase,
} from '@/lib/content-import/use-cases/engine';
import type { UseCaseRunOptions } from '@/lib/content-import/use-cases/engine';
import { buildUseCasePlan } from '@/lib/content-import/use-cases/plan';
import type { UseCasePlan } from '@/lib/content-import/use-cases/types';

import {
  CREATOR_ID,
  FIAE_CATALOG_ID,
  KFBM_CATALOG_ID,
  MemoryImportDb,
  inTransaction,
} from '../../../helpers/memoryImportDb';
import { loadDecisions, sampleTree } from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const plan = (): UseCasePlan =>
  buildUseCasePlan(sampleTree(), loadDecisions(), { now: NOW });

const COURSES = ['K1', 'K6.1', 'K6.2', 'K10', 'K20'];
const ENABLERS = ['K1-a', 'K1-b', 'K6.1-a', 'K6.2-d', 'K10-a', 'K20-a'];
const idOf = (kind: string, i: number) =>
  `00000000-0000-4000-a000-${kind}${String(i + 1).padStart(11, '0')}`;

/** A target that already holds the courses and enablers of the content import. */
function database(
  courses: string[] = COURSES,
  enablers: string[] = ENABLERS,
  catalogId = KFBM_CATALOG_ID
) {
  const db = new MemoryImportDb();
  courses.forEach((code, i) =>
    db.tables.courses.push({
      id: idOf('c', i),
      training_catalog_id: catalogId,
      code,
    })
  );
  enablers.forEach((code, i) =>
    db.tables.enablers.push({
      id: idOf('e', i),
      course_id: db.tables.courses.find(c => c.code === code.split('-')[0])?.id,
      training_catalog_id: catalogId,
      code,
    })
  );
  return db;
}

const options = (
  patch: Partial<UseCaseRunOptions> = {}
): UseCaseRunOptions => ({
  createdBy: CREATOR_ID,
  updateExisting: false,
  write: true,
  activate: false,
  solutions: false,
  ...patch,
});
const run = (
  db: MemoryImportDb,
  p: UseCasePlan = plan(),
  patch: Partial<UseCaseRunOptions> = {}
) => executeUseCasePlan(db, p, options(patch));

const UC = 'use_cases' as const;
const DOC = 'content_documents' as const;

describe('executeUseCasePlan: first run', () => {
  it('writes one use case per enabler with its topics, and no solution row', async () => {
    const db = database();
    const report = await run(db);
    expect(report.wrote).toBe(true);
    expect(report.tables[UC]).toEqual({ insert: 6, update: 0, unchanged: 0 });
    expect(report.tables[DOC]).toEqual({ insert: 6, update: 0, unchanged: 0 });
    expect(report.conflicts).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.withheldSolutionRows).toBe(6);
    expect(db.count(UC)).toBe(6);

    const uc = db.tables[UC].find(r => r.code === 'K6.2-d');
    const course = db.tables.courses.find(c => c.code === 'K6.2');
    const enabler = db.tables.enablers.find(e => e.code === 'K6.2-d');
    expect(uc).toMatchObject({
      course_id: course?.id,
      training_catalog_id: KFBM_CATALOG_ID,
      enabler_id: enabler?.id,
      title: 'Erfundener Titel 6.2d',
      order_index: 4,
      is_active: false,
    });
    // the short title, like FIAE, not the assignment
    expect(uc?.description_text).toBe('Erfundener Titel 6.2d');

    const doc = db.tables[DOC].find(r => r.use_case_id === uc?.id);
    expect(doc).toMatchObject({
      title: 'Use Case K6.2-d: Behandelte Themen',
      document_type: 'THEORY',
      visibility: 'ALL',
      enabler_id: null,
      course_id: null,
      organization_id: null,
      file_name: 'UC_6d_Titel.docx',
      storage_url: '',
      mime_type: 'text/plain',
      uploaded_by_id: CREATOR_ID,
    });
  });

  it('never writes a solution without the switch: no row of the database holds one', async () => {
    const db = database();
    await run(db);
    const everything = JSON.stringify(db.tables);
    expect(everything).not.toContain('OMEGA');
    expect(everything).not.toContain('ZETA');
    expect(everything).not.toContain('Musterlösung');
    expect(
      db.tables[DOC].every(
        r => r.document_type === 'THEORY' && r.visibility === 'ALL'
      )
    ).toBe(true);
  });

  it('writes the solutions as trainer-only documents with the switch, and only there', async () => {
    const db = database();
    const report = await run(db, plan(), { solutions: true });
    expect(report.tables[DOC].insert).toBe(12);
    expect(report.withheldSolutionRows).toBe(0);
    const solutionRows = db.tables[DOC].filter(
      r => r.document_type === 'TRAINER_SOLUTION'
    );
    expect(solutionRows).toHaveLength(6);
    for (const row of solutionRows) {
      expect(row.visibility).toBe('TRAINER_ONLY');
      expect(row.title).toMatch(
        /^Use Case K[\d.]+-[a-z]: Musterlösung \(Trainer\)$/
      );
      expect(String(row.description)).toContain('OMEGA');
    }
    // nothing a trainee can read holds the solution
    for (const row of db.tables[UC]) {
      expect(JSON.stringify(row)).not.toContain('OMEGA');
      expect(JSON.stringify(row)).not.toContain('ZETA');
    }
    for (const row of db.tables[DOC].filter(r => r.visibility === 'ALL')) {
      expect(JSON.stringify(row)).not.toContain('OMEGA');
      expect(JSON.stringify(row)).not.toContain('ZETA');
    }
  });

  it('writes the criteria as a second trainer-only document', async () => {
    const withCriteria = plan();
    withCriteria.useCases[0].criteria = 'Erfundenes Kriterium KAPPA.';
    const db = database();
    await run(db, withCriteria, { solutions: true });
    const row = db.tables[DOC].find(r =>
      String(r.title).includes('Bewertungskriterien')
    );
    expect(row).toMatchObject({
      document_type: 'TRAINER_SOLUTION',
      visibility: 'TRAINER_ONLY',
      description: 'Erfundenes Kriterium KAPPA.',
    });
    const without = database();
    await run(without, withCriteria);
    expect(JSON.stringify(without.tables)).not.toContain('KAPPA');
  });

  it('makes the use cases active only when the decisions say so', async () => {
    const db = database();
    await run(db, plan(), { activate: true });
    expect(db.tables[UC].every(r => r.is_active === true)).toBe(true);
  });

  it('is idempotent: the second run writes nothing', async () => {
    const db = database();
    await run(db, plan(), { solutions: true });
    db.log.length = 0;
    const again = await run(db, plan(), { solutions: true });
    expect(db.log).toEqual([]);
    expect(again.tables[UC]).toEqual({ insert: 0, update: 0, unchanged: 6 });
    expect(again.tables[DOC]).toEqual({ insert: 0, update: 0, unchanged: 12 });
    expect(db.count(UC)).toBe(6);
  });

  it('a later run with the switch adds only the solution rows', async () => {
    const db = database();
    await run(db);
    db.log.length = 0;
    const second = await run(db, plan(), { solutions: true });
    expect(second.tables[UC].insert).toBe(0);
    expect(second.tables[DOC]).toEqual({ insert: 6, update: 0, unchanged: 6 });
    expect(db.log).toEqual([{ op: 'insert', table: DOC, rows: 6 }]);
  });

  it('a comparison without write reports the counts and changes nothing', async () => {
    const db = database();
    const report = await run(db, plan(), { write: false });
    expect(report.wrote).toBe(false);
    expect(report.tables[UC].insert).toBe(6);
    expect(db.log).toEqual([]);
    expect(db.count(UC)).toBe(0);
  });

  it('a rolled back run leaves nothing behind', async () => {
    const db = database();
    await inTransaction(db, 'rollback', () =>
      run(db, plan(), { solutions: true })
    );
    expect(db.count(UC)).toBe(0);
    expect(db.count(DOC)).toBe(0);
  });

  it('leaves the use cases of another catalog alone', async () => {
    const db = database();
    db.tables.courses.push({
      id: 'fiae-course',
      training_catalog_id: FIAE_CATALOG_ID,
      code: 'K1',
    });
    db.tables[UC].push({
      id: 'fiae-uc',
      course_id: 'fiae-course',
      training_catalog_id: FIAE_CATALOG_ID,
      code: 'K1-a',
      title: 'FIAE Use Case',
    });
    const report = await run(db);
    expect(report.tables[UC].insert).toBe(6);
    expect(db.tables[UC].find(r => r.id === 'fiae-uc')?.title).toBe(
      'FIAE Use Case'
    );
  });
});

describe('executeUseCasePlan: what the target must have', () => {
  it('stops when the catalog is missing, inactive or not KFBM', async () => {
    const missing = database();
    missing.catalogs = missing.catalogs.filter(c => c.code !== 'KFBM');
    await expect(run(missing)).rejects.toMatchObject({
      code: 'CATALOG_MISSING',
    });
    const inactive = database();
    inactive.catalogs.find(c => c.code === 'KFBM')!.is_active = false;
    await expect(run(inactive)).rejects.toMatchObject({
      code: 'CATALOG_INACTIVE',
    });
    const fiae = JSON.parse(JSON.stringify(plan()));
    fiae.catalog = 'FIAE';
    await expect(run(database(), fiae)).rejects.toMatchObject({
      code: 'PLAN_INVALID',
    });
    expect(missing.log).toEqual([]);
  });

  it('stops when the creator is unknown or has no right to write content', async () => {
    const unknown = database();
    unknown.profiles = [];
    await expect(run(unknown)).rejects.toMatchObject({
      code: 'CREATOR_MISSING',
    });
    const trainee = database();
    trainee.profiles = [{ id: CREATOR_ID, role: 'TRAINEE' }];
    await expect(run(trainee)).rejects.toMatchObject({ code: 'CREATOR_ROLE' });
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'TEMP_ADMIN', 'TRAINER']) {
      const ok = database();
      ok.profiles = [{ id: CREATOR_ID, role }];
      await expect(run(ok, plan(), { write: false })).resolves.toBeDefined();
    }
  });

  it('stops when the catalog has no enabler: the content import comes first', async () => {
    const db = database([], []);
    await expect(run(db)).rejects.toMatchObject({ code: 'NO_ENABLERS' });
    expect(db.log).toEqual([]);
  });

  it('skips a use case whose course or enabler is not in the target, and reports it', async () => {
    const db = database(
      ['K1', 'K6.1', 'K6.2', 'K20'],
      ['K1-a', 'K6.1-a', 'K6.2-d', 'K20-a']
    );
    const report = await run(db);
    expect(report.tables[UC].insert).toBe(4);
    expect(report.skipped).toEqual([
      expect.objectContaining({
        useCaseCode: 'K1-b',
        code: 'ENABLER_NOT_IN_DATABASE',
      }),
      expect.objectContaining({
        useCaseCode: 'K10-a',
        code: 'COURSE_NOT_IN_DATABASE',
      }),
    ]);
    expect(db.count(UC)).toBe(4);
    // only the four use cases that were written have solution rows to withhold
    expect(report.withheldSolutionRows).toBe(4);
  });

  it('refuses an invalid plan before it reads anything', async () => {
    const bad = JSON.parse(JSON.stringify(plan()));
    bad.useCases[0].description += '\n\nMusterlösung: so geht es';
    const db = database();
    await expect(run(db, bad)).rejects.toMatchObject({ code: 'PLAN_INVALID' });
    expect(db.log).toEqual([]);
  });
});

describe('executeUseCasePlan: conflicts stop a writing run before the first write', () => {
  const existing = (
    db: MemoryImportDb,
    patch: Record<string, unknown> = {}
  ) => {
    const course = db.tables.courses.find(c => c.code === 'K1');
    const enabler = db.tables.enablers.find(e => e.code === 'K1-a');
    db.tables[UC].push({
      id: 'uc-old',
      course_id: course?.id,
      training_catalog_id: KFBM_CATALOG_ID,
      enabler_id: enabler?.id,
      code: 'K1-a',
      title: 'Erfundener Titel 1a',
      description_text: 'alt',
      order_index: 1,
      is_active: false,
      ...patch,
    });
  };

  it('a use case that exists for another enabler', async () => {
    const db = database();
    existing(db, {
      enabler_id: db.tables.enablers.find(e => e.code === 'K1-b')?.id,
    });
    const report = await run(db, plan(), { write: false });
    // K1-a is linked to the enabler of K1-b, so K1-b finds its enabler taken
    expect(report.conflicts).toEqual([
      expect.objectContaining({ table: UC, key: 'K1-a' }),
      expect.objectContaining({ table: UC, key: 'K1-b' }),
    ]);
    await expect(run(db)).rejects.toMatchObject({ code: 'CONFLICTS' });
    expect(db.log).toEqual([]);
  });

  it('a use case that exists without a link to an enabler', async () => {
    const db = database();
    existing(db, { enabler_id: null });
    await expect(run(db)).rejects.toMatchObject({ code: 'CONFLICTS' });
  });

  it('an enabler that already has another use case', async () => {
    const db = database();
    existing(db, { code: 'K1-x', title: 'Anderer' });
    const report = await run(db, plan(), { write: false });
    expect(report.conflicts).toEqual([
      expect.objectContaining({
        table: UC,
        key: 'K1-a',
        reason: expect.stringContaining('K1-x'),
      }),
    ]);
    await expect(run(db)).rejects.toBeInstanceOf(ImportAbort);
    expect(db.log).toEqual([]);
  });

  it('a document that exists with another visibility', async () => {
    const db = database();
    existing(db);
    db.tables[DOC].push({
      id: 'doc-old',
      use_case_id: 'uc-old',
      title: 'Use Case K1-a: Behandelte Themen',
      document_type: 'THEORY',
      visibility: 'TRAINER_ONLY',
      description: 'x',
    });
    const report = await run(db, plan(), { write: false });
    expect(report.conflicts).toEqual([expect.objectContaining({ table: DOC })]);
    await expect(run(db)).rejects.toMatchObject({ code: 'CONFLICTS' });
  });
});

describe('executeUseCasePlan: rows that exist', () => {
  const seed = async (db: MemoryImportDb) => {
    await run(db, plan(), { solutions: true });
    db.log.length = 0;
  };

  it('reports a changed text and leaves it alone without --update-existing', async () => {
    const db = database();
    await seed(db);
    const changed = plan();
    changed.useCases[0].title = 'Neuer Titel';
    const report = await run(db, changed, { solutions: true });
    expect(report.differences).toEqual([
      { table: UC, key: 'K1-a', columns: ['title'] },
    ]);
    expect(report.tables[UC].update).toBe(0);
    expect(db.log).toEqual([]);
  });

  it('updates the named columns with --update-existing and nothing else', async () => {
    const db = database();
    await seed(db);
    const changed = plan();
    changed.useCases[0].title = 'Neuer Titel';
    changed.useCases[0].description += '\n\nZusatz.';
    changed.useCases[0].solution += '\n\nZusätzliche Lösung OMEGA2.';
    const report = await run(db, changed, {
      solutions: true,
      updateExisting: true,
    });
    expect(report.tables[UC].update).toBe(1);
    expect(report.tables[DOC].update).toBe(1);
    expect(db.log.map(l => [l.op, l.table, l.columns])).toEqual([
      ['update', UC, ['title', 'description_text']],
      ['update', DOC, ['description']],
    ]);
    const row = db.tables[UC].find(r => r.code === 'K1-a');
    expect(row).toMatchObject({ title: 'Neuer Titel', is_active: false });
  });

  it('never replaces a text by nothing and never touches is_active or the link', async () => {
    const db = database();
    await seed(db);
    const before = JSON.stringify(db.tables[UC]);
    const changed = plan();
    changed.useCases[0].topics = null;
    await run(db, changed, { solutions: true, updateExisting: true });
    expect(JSON.stringify(db.tables[UC])).toBe(before);
    expect(db.tables[DOC].filter(r => r.visibility === 'ALL')).toHaveLength(6);
  });

  it('adds the missing topics row to a use case that has none', async () => {
    const db = database();
    await seed(db);
    const topicsRow = db.tables[DOC].findIndex(
      r => r.title === 'Use Case K1-a: Behandelte Themen'
    );
    db.tables[DOC].splice(topicsRow, 1);
    const report = await run(db, plan(), { solutions: true });
    expect(report.tables[DOC]).toEqual({ insert: 1, update: 0, unchanged: 11 });
    expect(db.log).toEqual([{ op: 'insert', table: DOC, rows: 1 }]);
  });

  it('refuses a change that would put a solution into a visible text, also on an update run', async () => {
    const db = database();
    await seed(db);
    const changed = plan();
    // The new title is the solution of another use case.
    const other = changed.useCases[1];
    other.solution =
      'Die lange erfundene Antwort KAPPA lautet zwölf Schrauben.';
    changed.useCases[0].title = other.solution;
    await expect(
      run(db, changed, { solutions: true, updateExisting: true })
    ).rejects.toMatchObject({ code: 'PLAN_INVALID' });
    expect(db.log).toEqual([]);
  });
});

describe('documentRowsOfUseCase', () => {
  const uc = () => plan().useCases[0];

  it('gives the topics row only, or topics and solution', () => {
    expect(
      documentRowsOfUseCase(uc(), 'id', CREATOR_ID, false).map(
        r => r.document_type
      )
    ).toEqual(['THEORY']);
    expect(
      documentRowsOfUseCase(uc(), 'id', CREATOR_ID, true).map(r => [
        r.document_type,
        r.visibility,
        r.order_index,
      ])
    ).toEqual([
      ['THEORY', 'ALL', 1],
      ['TRAINER_SOLUTION', 'TRAINER_ONLY', 2],
    ]);
  });

  it('has no topics row for a use case without topics', () => {
    const noTopics = { ...uc(), topics: null };
    expect(documentRowsOfUseCase(noTopics, 'id', CREATOR_ID, false)).toEqual(
      []
    );
  });
});
