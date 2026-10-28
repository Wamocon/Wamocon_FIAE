/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

import { executePlan } from '@/lib/content-import/apply/engine';
import { TABLES } from '@/lib/content-import/apply/tables';
import type { Decisions } from '@/lib/content-import/apply/types';
import { planAttribution } from '@/lib/content-upload/transfer/attribution';
import {
  TRANSFER_ENGINE_VERSION,
  canonicalPlan,
  decisionsHash,
  sha256Hex,
  stableStringify,
  type CanonicalInput,
} from '@/lib/content-upload/transfer/canonical';
import { buildTransferPlan } from '@/lib/content-upload/transfer/plan';
import { transferDecisions } from '@/lib/content-upload/transfer/preset';
import { RecordingDb } from '@/lib/content-upload/transfer/record';
import {
  MAX_PUBLISH_ORIGINALS,
  MAX_REPLACE_FILES,
  parseTransferBody,
} from '@/lib/content-upload/transfer/request';
import {
  DELETE_ORDER,
  RollbackSqlError,
  buildRollbackSql,
  type AppliedRowRecord,
} from '@/lib/content-upload/transfer/rollback';
import type { TransferFile } from '@/lib/content-upload/transfer/types';

import { CREATOR_ID, MemoryImportDb } from '../../../helpers/memoryImportDb';
import {
  enablerFiles,
  type FixtureFile,
} from '../../../helpers/transferFixtures';

const UUID = (n: number) =>
  `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function planOf(
  fixtures: FixtureFile[],
  options: { decisions?: Decisions; now?: Date } = {}
) {
  const bytes = new Map(fixtures.map(f => [f.file.id, f.bytes]));
  return buildTransferPlan({
    files: fixtures.map(f => f.file),
    components: [],
    decisions: options.decisions ?? transferDecisions(),
    readBytes: async (file: TransferFile) => bytes.get(file.id) ?? null,
    now: options.now,
  });
}

async function inputOf(
  fixtures: FixtureFile[],
  options: { decisions?: Decisions; now?: Date; replaceFiles?: string[] } = {}
): Promise<CanonicalInput> {
  const decisions = options.decisions ?? transferDecisions();
  const plan = await planOf(fixtures, options);
  return {
    decisions,
    importPlan: plan.importPlan,
    useCasePlan: plan.useCasePlan,
    options: { replaceFiles: options.replaceFiles ?? [] },
    files: plan.plannedFiles,
    originals: [],
  };
}

describe('the presets', () => {
  it('are the file of the import scripts, and never activate', () => {
    const decisions = transferDecisions();
    const file = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), 'scripts', 'import', 'kfbm-decisions.json'),
        'utf8'
      )
    );
    expect(decisions.components.mandatoryNumbers).toEqual(
      file.components.mandatoryNumbers
    );
    expect(decisions.components.excludedNumbers).toEqual([18]);
    expect(decisions.content.activate).toBe(false);
    expect(decisions.catalog).toBe('KFBM');
  });

  it('forces activate off even when the file says on, and cannot be changed', () => {
    // The file itself says false today; the module sets it again in any case
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/content-upload/transfer/preset.ts'),
      'utf8'
    );
    expect(source).toMatch(/activate: false/);
    const decisions = transferDecisions();
    expect(Object.isFrozen(decisions)).toBe(true);
    expect(Object.isFrozen(decisions.content)).toBe(true);
    expect(() => {
      (decisions.content as { activate: boolean }).activate = true;
    }).toThrow();
    expect(transferDecisions()).toBe(decisions);
  });
});

describe('stableStringify', () => {
  it('does not depend on the order of the keys and leaves out undefined', () => {
    expect(
      stableStringify({ b: 1, a: { d: 2, c: [3, { z: 1, y: undefined }] } })
    ).toBe(stableStringify({ a: { c: [3, { z: 1 }], d: 2 }, b: 1 }));
    expect(stableStringify({ a: undefined })).toBe('{}');
    expect(stableStringify([undefined, 1])).toBe('[null,1]');
    expect(stableStringify(new Date('2026-10-27T00:00:00Z'))).toBe(
      '"2026-10-27T00:00:00.000Z"'
    );
  });

  it('tells different values apart (types included)', () => {
    expect(stableStringify({ a: '1' })).not.toBe(stableStringify({ a: 1 }));
    expect(stableStringify({ a: null })).not.toBe(stableStringify({}));
    expect(stableStringify('a"b')).toBe('"a\\"b"');
  });

  it('refuses what cannot be hashed', () => {
    expect(() => stableStringify({ a: Number.NaN })).toThrow();
    expect(() => stableStringify({ a: Infinity })).toThrow();
    expect(() => stableStringify({ a: () => 1 })).toThrow();
    expect(() => stableStringify({ a: Symbol('x') })).toThrow();
    expect(() => stableStringify({ a: 10n })).toThrow();
  });
});

describe('the canonical plan and its hash', () => {
  it('is the same for the same files, in another order, built at another time', async () => {
    const files = await enablerFiles({ tree: true });
    const first = decisionsHash(
      await inputOf(files, { now: new Date('2026-10-27T08:00:00Z') })
    );
    const second = decisionsHash(
      await inputOf([...files].reverse(), {
        now: new Date('2027-01-01T00:00:00Z'),
      })
    );
    expect(second).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes with a decision, with a byte of a file and with the switch of the run', async () => {
    const files = await enablerFiles({ tree: true });
    const base = decisionsHash(await inputOf(files));

    const changedDecision = files.map(f => ({
      ...f,
      file: {
        ...f.file,
        decision: {
          ...f.file.decision,
          action:
            f.file.decision.docType === 'quiz'
              ? ('reject' as const)
              : f.file.decision.action,
        },
      },
    }));
    expect(decisionsHash(await inputOf(changedDecision))).not.toBe(base);

    const changedBytes = files.map((f, i) =>
      i === 1 ? { ...f, file: { ...f.file, sha256: 'f'.repeat(64) } } : f
    );
    expect(decisionsHash(await inputOf(changedBytes))).not.toBe(base);

    expect(
      decisionsHash(await inputOf(files, { replaceFiles: [UUID(1)] }))
    ).not.toBe(base);
  });

  it('changes with the presets and with the originals', async () => {
    const files = await enablerFiles({ tree: true });
    const base = await inputOf(files);
    const other = {
      ...base,
      decisions: {
        ...base.decisions,
        components: { ...base.decisions.components, placeholderHours: 7 },
      },
    };
    expect(decisionsHash(other)).not.toBe(decisionsHash(base));
    const withOriginal = {
      ...base,
      originals: [{ id: UUID(1), sha256: 'a'.repeat(64), enablerCode: 'K4-a' }],
    };
    expect(decisionsHash(withOriginal)).not.toBe(decisionsHash(base));
    const swapped = {
      ...base,
      originals: [{ id: UUID(1), sha256: 'b'.repeat(64), enablerCode: 'K4-a' }],
    };
    expect(decisionsHash(swapped)).not.toBe(decisionsHash(withOriginal));
  });

  it('names the version of the engine and the fixed settings, and not the time of the build', async () => {
    const text = canonicalPlan(
      await inputOf(await enablerFiles({ tree: true }), {
        now: new Date('2026-10-27T08:00:00Z'),
      })
    );
    expect(text).toContain(TRANSFER_ENGINE_VERSION);
    expect(text).toContain(
      '"fixed":{"activate":false,"extendQuizzes":true,"learningUpdateExisting":false,"scenarioSolutions":false,"useCaseSolutions":false}'
    );
    expect(text).not.toContain('2026-10-27T08:00:00');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('RecordingDb and the attribution to files', () => {
  async function applied() {
    const files = await enablerFiles({ tree: true });
    const built = await planOf(files);
    const memory = new MemoryImportDb();
    const recorder = new RecordingDb(
      memory,
      planAttribution({
        importPlan: built.importPlan,
        useCasePlan: built.useCasePlan,
        fileOfSource: built.fileOfSource,
      })
    );
    await executePlan(recorder, built.importPlan, {
      createdBy: CREATOR_ID,
      updateExisting: false,
      write: true,
      activate: false,
      scenarioSolutions: false,
    });
    return { files, built, memory, recorder };
  }

  it('lists every inserted row once, with its id and no values from before', async () => {
    const { memory, recorder } = await applied();
    expect(recorder.written).toHaveLength(memory.totalRows());
    expect(
      recorder.written.every(w => w.action === 'insert' && w.before === null)
    ).toBe(true);
    const ids = new Set(recorder.written.map(w => `${w.table}:${w.rowId}`));
    expect(ids.size).toBe(recorder.written.length);
    for (const w of recorder.written) {
      expect(memory.tables[w.table].some(r => r.id === w.rowId)).toBe(true);
    }
  });

  it('knows the file of a quiz, its questions and options, the enabler and the scenario', async () => {
    const { files, recorder, memory } = await applied();
    const idOf = (docType: string) =>
      files.find(f => f.file.decision.docType === docType)!.file.id;
    const byTable = (table: string) =>
      recorder.written.filter(w => w.table === table);
    expect(new Set(byTable('quizzes').map(w => w.fileId))).toEqual(
      new Set([idOf('quiz')])
    );
    expect(new Set(byTable('questions').map(w => w.fileId))).toEqual(
      new Set([idOf('quiz')])
    );
    expect(new Set(byTable('options').map(w => w.fileId))).toEqual(
      new Set([idOf('quiz')])
    );
    expect(new Set(byTable('enabler_quiz_links').map(w => w.fileId))).toEqual(
      new Set([idOf('quiz')])
    );
    expect(new Set(byTable('enablers').map(w => w.fileId))).toEqual(
      new Set([idOf('enabler')])
    );
    // the scenario document, found by its title
    const docs = byTable('content_documents');
    expect(docs).toHaveLength(memory.count('content_documents'));
    expect(docs.every(d => d.fileId === idOf('scenario'))).toBe(true);
    // components and courses belong to many files
    expect(byTable('training_components').every(w => w.fileId === null)).toBe(
      true
    );
    expect(byTable('courses').every(w => w.fileId === null)).toBe(true);
  });

  it('records the values before an update, and only of the columns the update changes', async () => {
    const { built, memory, recorder } = await applied();
    const enabler = memory.tables.enablers[0];
    memory.tables.enablers[0] = { ...enabler, title: 'Alter Titel' };
    const second = new RecordingDb(memory);
    await executePlan(second, built.importPlan, {
      createdBy: CREATOR_ID,
      updateExisting: true,
      write: true,
      activate: false,
      scenarioSolutions: false,
    });
    expect(second.written).toEqual([
      {
        table: 'enablers',
        rowId: String(enabler.id),
        action: 'update',
        before: { title: 'Alter Titel' },
        fileId: null,
      },
    ]);
    expect(recorder.written.length).toBeGreaterThan(1);
  });

  it('does not record a column that no update may change, and an empty update writes nothing', async () => {
    const memory = new MemoryImportDb();
    const recorder = new RecordingDb(memory);
    const [row] = await recorder.insert('quizzes', [
      {
        code: 'K1-a-low',
        title: 'T',
        quiz_type: 'LESSON',
        created_by_id: CREATOR_ID,
        is_active: false,
        training_catalog_id: memory.catalogs[1].id,
        training_component_id: null,
      },
    ]);
    await recorder.update('quizzes', String(row.id), {});
    expect(recorder.written).toHaveLength(1);
    // a row that this apply inserted stays ONE entry, an insert without values from before
    await recorder.update('quizzes', String(row.id), { title: 'Neu' });
    expect(recorder.written).toHaveLength(1);
    expect(recorder.written[0]).toMatchObject({
      action: 'insert',
      before: null,
    });
    // a row of an earlier apply that is updated twice keeps the values from before the first write
    const other = new MemoryImportDb();
    other.tables.quizzes.push({ id: 'q1', title: 'T0', code: 'K1-a-low' });
    const twice = new RecordingDb(other);
    await twice.update('quizzes', 'q1', { title: 'T1' });
    await twice.update('quizzes', 'q1', { title: 'T2' });
    expect(twice.written).toEqual([
      {
        table: 'quizzes',
        rowId: 'q1',
        action: 'update',
        before: { title: 'T0' },
        fileId: null,
      },
    ]);
    await expect(
      recorder.update('quizzes', 'missing', { title: 'x' })
    ).rejects.toThrow(/does not exist/);
    // the interface offers no delete
    expect(Object.getOwnPropertyNames(RecordingDb.prototype)).not.toContain(
      'delete'
    );
  });

  it('knows the storage paths of the document rows it inserted', async () => {
    const memory = new MemoryImportDb();
    const recorder = new RecordingDb(memory);
    await recorder.insert('content_documents', [
      {
        enabler_id: null,
        use_case_id: null,
        course_id: null,
        organization_id: null,
        title: 'A',
        description: null,
        document_type: 'THEORY',
        visibility: 'ALL',
        file_name: 'a.pdf',
        file_size: 1,
        mime_type: 'application/pdf',
        storage_url: 'x',
        storage_path: 'u/1_a.pdf',
        order_index: 0,
        uploaded_by_id: CREATOR_ID,
      },
    ]);
    expect([...recorder.storedPaths]).toEqual(['u/1_a.pdf']);
  });

  it('passes the reads through', async () => {
    const memory = new MemoryImportDb();
    const recorder = new RecordingDb(memory);
    expect((await recorder.findCatalog('KFBM'))?.code).toBe('KFBM');
    expect((await recorder.findProfile(CREATOR_ID))?.role).toBe('SUPER_ADMIN');
    expect(await recorder.select('quizzes')).toEqual([]);
  });
});

describe('parseTransferBody', () => {
  it('takes no body, an empty object and the known fields', () => {
    expect(parseTransferBody(undefined)).toEqual({
      ok: true,
      data: { replaceFiles: [], publishOriginals: [] },
    });
    expect(parseTransferBody(null)).toMatchObject({ ok: true });
    expect(parseTransferBody({})).toEqual({
      ok: true,
      data: { replaceFiles: [], publishOriginals: [] },
    });
    expect(
      parseTransferBody({
        replaceFiles: [UUID(3).toUpperCase(), UUID(3), UUID(2)],
        confirm: 'KFBM',
        publishOriginals: [UUID(1).toUpperCase(), UUID(1), UUID(2)],
        ignored: { a: 1 },
      })
    ).toEqual({
      ok: true,
      data: {
        replaceFiles: [UUID(2), UUID(3)],
        confirm: 'KFBM',
        publishOriginals: [UUID(1), UUID(2)],
      },
    });
  });

  it.each([
    ['an array', []],
    ['a text', 'x'],
    ['replaceFiles as text', { replaceFiles: 'yes' }],
    ['a replace id that is none', { replaceFiles: ['nope'] }],
    [
      'too many files to replace',
      {
        replaceFiles: Array.from({ length: MAX_REPLACE_FILES + 1 }, (_, i) =>
          UUID(i + 1)
        ),
      },
    ],
    ['publishOriginals as text', { publishOriginals: 'a' }],
    ['a file id that is none', { publishOriginals: ['nope'] }],
    ['a mixed list', { publishOriginals: [UUID(1), 5] }],
    [
      'too many originals',
      {
        publishOriginals: Array.from(
          { length: MAX_PUBLISH_ORIGINALS + 1 },
          (_, i) => UUID(i + 1)
        ),
      },
    ],
    ['confirm as number', { confirm: 1 }],
  ])('refuses %s with 400', (_name, body) => {
    expect(parseTransferBody(body)).toMatchObject({
      ok: false,
      status: 400,
      code: 'BODY_INVALID',
    });
  });
});

describe('buildRollbackSql', () => {
  const base = {
    applyId: UUID(100),
    runId: UUID(101),
    startedAt: new Date('2026-10-27T08:00:00Z'),
    generatedAt: new Date('2026-10-27T09:00:00Z'),
  };
  const insert = (
    table: AppliedRowRecord['table'],
    n: number
  ): AppliedRowRecord => ({
    table,
    rowId: UUID(n),
    action: 'insert',
    before: null,
  });

  it('deletes children before parents and checks every count', () => {
    const rows = [
      insert('training_components', 1),
      insert('courses', 2),
      insert('enablers', 3),
      insert('quizzes', 4),
      insert('questions', 5),
      insert('options', 6),
      insert('enabler_quiz_links', 7),
      insert('content_documents', 8),
      insert('use_cases', 9),
    ];
    const { sql, deletes } = buildRollbackSql({ ...base, rows });
    expect(deletes).toEqual({
      training_components: 1,
      courses: 1,
      enablers: 1,
      quizzes: 1,
      questions: 1,
      options: 1,
      enabler_quiz_links: 1,
      content_documents: 1,
      use_cases: 1,
    });
    const positions = DELETE_ORDER.map(t =>
      sql.indexOf(`delete from ${t} where`)
    ).filter(p => p >= 0);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions).toHaveLength(9);
    expect(sql.indexOf('delete from options')).toBeLessThan(
      sql.indexOf('delete from quizzes')
    );
    expect(sql.indexOf('delete from use_cases')).toBeLessThan(
      sql.indexOf('delete from enablers')
    );
    expect(sql.indexOf('delete from courses')).toBeLessThan(
      sql.indexOf('delete from training_components')
    );
    // the lock first, then only this apply, ending in a probe
    const begin = sql.indexOf('\nbegin;');
    expect(begin).toBeGreaterThan(0);
    expect(
      sql.indexOf("pg_advisory_xact_lock(hashtext('kfbm-content-import'))")
    ).toBeGreaterThan(begin);
    expect(sql.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      sql.indexOf('delete from')
    );
    expect(sql).toMatch(/\nrollback; -- probe\./);
    expect(sql).not.toMatch(/\ncommit;/);
    expect(sql).toContain(`where id = '${base.applyId}'`);
    expect(sql).toContain(
      "raise exception 'delete from options: % rows deleted, expected 1'"
    );
    // no catalog pattern, no truncate, no drop
    expect(sql).not.toMatch(/truncate|drop table|training_catalogs/i);
  });

  it('splits long lists into blocks of 500 rows', () => {
    const rows = Array.from({ length: 1201 }, (_, i) =>
      insert('options', i + 1)
    );
    const { sql, deletes } = buildRollbackSql({ ...base, rows });
    expect(deletes).toEqual({ options: 1201 });
    expect(sql.match(/delete from options where/g)).toHaveLength(3);
    expect(sql).toContain('expected 500');
    expect(sql).toContain('expected 201');
  });

  it('restores the values from before with their types, and escapes every text', () => {
    const rows: AppliedRowRecord[] = [
      {
        table: 'enablers',
        rowId: UUID(1),
        action: 'update',
        before: {
          title: "Ein 'Titel' mit \\ und $$ und\nZeilenumbruch",
          description_text: null,
          order_index: 3,
        },
      },
      {
        table: 'options',
        rowId: UUID(2),
        action: 'update',
        before: { option_text: 'ä ö ü ß', is_correct: true, explanation: null },
      },
    ];
    const { sql, restores } = buildRollbackSql({ ...base, rows });
    expect(restores).toEqual({ enablers: 1, options: 1 });
    expect(sql).toContain(
      "update enablers set description_text = null, order_index = 3, title = 'Ein ''Titel'' mit \\ und $$ und\nZeilenumbruch', updated_at = now() where id = '" +
        UUID(1) +
        "';"
    );
    expect(sql).toContain(
      "update options set explanation = null, is_correct = true, option_text = 'ä ö ü ß' where id = '" +
        UUID(2) +
        "';"
    );
    expect(sql).toContain('set local standard_conforming_strings = on;');
    // the text of the value cannot end the DO block: the quote is not in any value
    const tag = /do (\$rollback\d*\$)/.exec(sql)![1];
    const inner = sql.split(`do ${tag}`)[1].split(`end ${tag};`)[0];
    expect(inner.includes(tag)).toBe(false);
    expect(sql.split(tag).length - 1).toBe(
      (sql.match(/\bdo \$rollback\d*\$/g) ?? []).length * 2
    );
  });

  it('picks another quote when the value holds the first one', () => {
    const { sql } = buildRollbackSql({
      ...base,
      rows: [
        {
          table: 'enablers',
          rowId: UUID(1),
          action: 'update',
          before: { title: 'x $rollback$ y $rollback0$ z' },
        },
      ],
    });
    expect(sql).toMatch(/do \$rollback1\$/);
    expect(sql).not.toMatch(/do \$rollback\$\n/);
  });

  it('names the originals in the bucket in the header, on one line each', () => {
    const { sql } = buildRollbackSql({
      ...base,
      rows: [insert('options', 1)],
      objectPaths: [
        'preview/u/1_K4-a_lehrtext.pdf',
        'evil\n; drop table x; --',
      ],
    });
    expect(sql).toContain(
      '--       bucket content: preview/u/1_K4-a_lehrtext.pdf'
    );
    expect(sql).not.toMatch(/^; drop table/m);
  });

  it('makes no restore and no delete block for an empty apply, only the mark', () => {
    const { sql, deletes, restores } = buildRollbackSql({ ...base, rows: [] });
    expect(deletes).toEqual({});
    expect(restores).toEqual({});
    expect(sql).not.toContain('delete from');
    expect(sql).toContain("jsonb_build_object('rolledBack', true");
  });

  it.each([
    [
      'a row id that is no uuid',
      {
        table: 'options',
        rowId: "x'; drop table y; --",
        action: 'insert',
        before: null,
      },
    ],
    [
      'a table of the import that does not exist',
      { table: 'profiles', rowId: UUID(1), action: 'insert', before: null },
    ],
    [
      'an update without values from before',
      { table: 'enablers', rowId: UUID(1), action: 'update', before: null },
    ],
    [
      'a column that no update may change',
      {
        table: 'enablers',
        rowId: UUID(1),
        action: 'update',
        before: { is_active: true },
      },
    ],
    [
      'a column name that is no identifier',
      {
        table: 'enablers',
        rowId: UUID(1),
        action: 'update',
        before: { 'title; drop': 'x' },
      },
    ],
    [
      'a NUL character',
      {
        table: 'enablers',
        rowId: UUID(1),
        action: 'update',
        before: { title: 'a\0b' },
      },
    ],
    [
      'a value that is not finite',
      {
        table: 'enablers',
        rowId: UUID(1),
        action: 'update',
        before: { order_index: Number.NaN },
      },
    ],
    [
      'a value of another type',
      {
        table: 'enablers',
        rowId: UUID(1),
        action: 'update',
        before: { title: { a: 1 } },
      },
    ],
  ])('refuses %s', (_name, row) => {
    expect(() =>
      buildRollbackSql({ ...base, rows: [row as unknown as AppliedRowRecord] })
    ).toThrow(RollbackSqlError);
  });

  it('only names columns that the import may update, for every table', () => {
    for (const [table, spec] of Object.entries(TABLES)) {
      for (const column of spec.updatable) {
        const { sql } = buildRollbackSql({
          ...base,
          rows: [
            {
              table: table as AppliedRowRecord['table'],
              rowId: UUID(1),
              action: 'update',
              before: { [column]: 'x' },
            },
          ],
        });
        expect(sql).toContain(`${column} = 'x'`);
      }
    }
  });
});
