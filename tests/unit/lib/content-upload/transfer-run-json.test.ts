/**
 * @jest-environment node
 */
// A supply of quizzes as a JSON file and of the learning field mapping as an Excel file
// (package UP2): the status per file, the supply of missing questions, the idempotence,
// the protocol and the rollback text. Invented files, memory database. The SQL itself is
// tried against a real database in transfer-db.test.ts.
import { describe, expect, it } from '@jest/globals';

import { compareStock } from '@/lib/content-upload/transfer/compare';
import { buildRollbackSql } from '@/lib/content-upload/transfer/rollback';
import {
  runTransfer,
  type TransferRequest,
} from '@/lib/content-upload/transfer/run';
import { emptyStockCounts } from '@/lib/content-upload/transfer/stock';

import { CREATOR_ID } from '../../../helpers/memoryImportDb';
import {
  harness,
  memoryConnections,
  type Harness,
} from '../../../helpers/memoryTransfer';
import {
  K4_DIR,
  enablerFiles,
  jsonQuizFile,
  xlsxMappingFile,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import { jsonQuiz, lessonFile } from '../../content-import/quiz-json/fixtures';
import {
  HEADER,
  block,
  row,
} from '../../content-import/learning-fields/fixtures';
import { makeXlsx } from '../../../helpers/xlsxFixture';
import type { ComponentFact } from '@/lib/content-upload/transfer/types';

const request = (
  mode: 'dry_run' | 'apply',
  extra: Partial<TransferRequest> = {}
): TransferRequest => ({
  runId: 'cccccccc-0000-4000-8000-000000000001',
  callerId: CREATOR_ID,
  mode,
  replaceFiles: [],
  publishOriginals: [],
  ...(mode === 'apply' ? { confirm: 'KFBM' } : {}),
  ...extra,
});

const K4: ComponentFact = {
  code: 'K4',
  title: 'Erfundenes Thema Vier',
  reference: '§ 4 Abs. 2 Nr. 4',
  kind: 'pflicht',
  phase: 1,
};

const k4 = (id: string, count = 10, tag?: string) =>
  jsonQuiz({ id, componentId: '04', dir: K4_DIR, count, tag });

const lessonJson = (quizzes: unknown[], options = {}) =>
  jsonQuizFile(lessonFile(quizzes), options);

/** A mapping table with a block for K4 (§ 4 Absatz 2 Nummer 4) and two positions. */
async function mappingK4() {
  const rows = [
    HEADER,
    row(5, block(4, 'Erfundenes Viertes', 2, 4), 'a) Position a', 'LF 2, 3'),
    row(6, null, 'b) Position b', 'LF 3'),
  ];
  return new Uint8Array(
    await makeXlsx([
      {
        name: 'Zuordnung',
        rows: rows.map(r => ({ row: r.row, cells: r.cells })),
      },
    ])
  );
}

/** A second run against the database of the first (the state applied would stop it). */
function again(files: FixtureFile[], first: Harness): Harness {
  const h = harness(files, {
    components: [K4],
    deps: { makeDb: () => first.db },
  });
  h.deps.connections = memoryConnections(h.timeline, first.db);
  return h;
}

async function applyAll(h: Harness, extra: Partial<TransferRequest> = {}) {
  const dry = await runTransfer(h.deps, request('dry_run', extra));
  expect(dry.ok).toBe(true);
  const done = await runTransfer(h.deps, request('apply', extra));
  expect(done.ok && done.data.wrote).toBe(true);
  return { dry, done: done.ok ? done.data : null };
}

describe('a supply of quizzes as a JSON file', () => {
  it('says new in the dry run, writes inactive quizzes and enablers, and stores the status for the list', async () => {
    const file = lessonJson([k4('4a'), k4('4b')]);
    const h = harness([file], { components: [K4] });
    const dry = await runTransfer(h.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.status).toBe('ok');
    expect(dry.data.stock.counts).toEqual({ ...emptyStockCounts(), new: 1 });
    expect(dry.data.stock.files).toEqual([
      expect.objectContaining({ fileId: file.file.id, status: 'new' }),
    ]);
    expect(dry.data.tables.quizzes).toEqual({
      insert: 6,
      update: 0,
      unchanged: 0,
    });
    expect(dry.data.tables.questions.insert).toBe(60);
    // a dry run writes nothing
    expect(h.db.totalRows()).toBe(0);
    expect(h.store.stockWrites).toHaveLength(1);
    expect(h.store.stockWrites[0].stock).toMatchObject({
      status: 'new',
      assign: 'quiz|||',
    });

    const applied = await runTransfer(h.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    for (const quiz of h.db.tables.quizzes) expect(quiz.is_active).toBe(false);
    for (const enabler of h.db.tables.enablers) {
      expect(enabler.is_active).toBe(false);
    }
    expect(h.db.count('quizzes')).toBe(6);
    expect(h.db.count('enablers')).toBe(2);
    // every row of the protocol belongs to the file
    const files = new Set(
      h.store.appliedRows
        .filter(r =>
          ['quizzes', 'questions', 'options', 'enablers'].includes(r.table)
        )
        .map(r => r.fileId)
    );
    expect(files).toEqual(new Set([file.file.id]));
    expect(h.store.markedFiles).toEqual([file.file.id]);
  });

  it('says unchanged for the same file again, and a second apply adds nothing', async () => {
    const file = lessonJson([k4('4a')]);
    const first = harness([file], { components: [K4] });
    await applyAll(first);
    const rows = first.db.totalRows();

    const second = again([file], first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok && dry.data.stock.counts).toEqual({
      ...emptyStockCounts(),
      unchanged: 1,
    });
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    expect(first.db.totalRows()).toBe(rows);
    expect(second.store.appliedRows).toHaveLength(0);
  });

  it('adds the missing questions of existing quizzes and reports the file as extended', async () => {
    const short = lessonJson([k4('4a', 3)], { name: 'quizze.json' });
    const first = harness([short], { components: [K4] });
    await applyAll(first);
    expect(first.db.count('questions')).toBe(9);

    const full = lessonJson([k4('4a', 10)], { name: 'quizze.json' });
    const second = again([full], first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.status).toBe('ok');
    expect(dry.data.stock.files[0]).toMatchObject({
      status: 'extended',
      added: 21,
    });
    expect(dry.data.extended).toHaveLength(3);
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    expect(first.db.count('questions')).toBe(30);
    // nothing was changed or removed: only inserted, every row of it belongs to the file
    expect(second.store.appliedRows.every(r => r.action === 'insert')).toBe(
      true
    );
    expect(
      second.store.appliedRows
        .filter(r => r.table === 'questions')
        .every(r => r.fileId === full.file.id)
    ).toBe(true);
  });

  it('reports a question that reads differently as differs and leaves it alone, unless the person names the file', async () => {
    const first = harness([lessonJson([k4('4a', 10, 'alt')])], {
      components: [K4],
    });
    await applyAll(first);
    const edited = lessonJson([k4('4a', 10, 'neu')]);

    const second = again([edited], first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok && dry.data.stock.files[0].status).toBe('differs');
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    // nothing was replaced: the file stays decided, not applied
    expect(second.store.markedFiles).toEqual([]);
    expect(
      second.store.appliedRows.filter(r => r.action === 'update')
    ).toHaveLength(0);
    expect(
      first.db.tables.questions.some(q =>
        String(q.question_text).includes('neu')
      )
    ).toBe(false);

    const third = again([edited], first);
    const replaced = await applyAll(third, { replaceFiles: [edited.file.id] });
    expect(replaced.done?.wrote).toBe(true);
    expect(
      third.store.appliedRows.filter(r => r.action === 'update').length
    ).toBeGreaterThan(0);
  });

  it('names the file of a quiz in a conflict, and writes nothing', async () => {
    const file = lessonJson([k4('4a')]);
    const first = harness([file], { components: [K4] });
    await applyAll(first);
    // the quiz exists with another meaning (a global quiz under the code)
    first.db.tables.quizzes[0].quiz_type = 'GLOBAL';
    const second = again([file], first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.status).toBe('conflict');
    expect(dry.data.readyToApply).toBe(false);
    expect(
      dry.data.stock.files.find(f => f.fileId === file.file.id)?.status
    ).toBe('conflict');
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok).toBe(false);
  });

  it('compares a JSON file before a decision and only reads', async () => {
    const file = lessonJson([k4('4a')]);
    const h = harness([file], { components: [K4] });
    const result = await compareStock(h.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.compared).toBe(1);
    expect(result.data.stock.files[0]).toMatchObject({ status: 'new' });
    expect(h.db.totalRows()).toBe(0);
    expect(h.timeline.events).not.toContain('connection.commit');
  });

  it('makes a rollback text that deletes exactly the rows of the file, children first', async () => {
    const file = lessonJson([k4('4a')]);
    const h = harness([file], { components: [K4] });
    await applyAll(h);
    const sql = buildRollbackSql({
      applyId: 'aaaaaaaa-0000-4000-8000-0000000000a1',
      runId: 'cccccccc-0000-4000-8000-000000000001',
      startedAt: new Date('2026-10-27T10:00:00Z'),
      generatedAt: new Date('2026-10-27T10:05:00Z'),
      rows: h.store.appliedRows.map(r => ({
        table: r.table,
        rowId: r.rowId,
        action: r.action,
        before: r.before,
      })),
    });
    expect(sql.deletes.quizzes).toBe(3);
    expect(sql.deletes.questions).toBe(30);
    expect(sql.deletes.options).toBe(120);
    expect(sql.deletes.enablers).toBe(1);
    const text = sql.sql;
    expect(text.indexOf('delete from options')).toBeLessThan(
      text.indexOf('delete from questions')
    );
    expect(text.indexOf('delete from questions')).toBeLessThan(
      text.indexOf('delete from quizzes')
    );
    // no text of the file in the rollback
    expect(text).not.toMatch(/Erfundene Frage/);
  });
});

describe('a supply of the learning field mapping as an Excel file', () => {
  it('runs after the content engines, in the same transaction, and writes only additions', async () => {
    const content = await enablerFiles({ tree: true });
    const mapping = xlsxMappingFile(await mappingK4());
    const h = harness([...content, mapping], { components: [K4] });
    const dry = await runTransfer(h.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.status).toBe('ok');
    expect(
      dry.data.stock.files.find(f => f.fileId === mapping.file.id)
    ).toMatchObject({ status: 'new' });
    expect(dry.data.tables.training_catalog_learning_fields.insert).toBe(13);
    // two mappings for the enabler K4-a (LF2, LF3) and K4-b is no enabler of the run
    expect(
      dry.data.tables.training_catalog_content_mappings.insert
    ).toBeGreaterThan(0);
    expect(h.db.totalRows()).toBe(0);

    const applied = await runTransfer(h.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    expect(h.db.count('training_catalog_learning_fields')).toBe(13);
    const useCase = h.db.tables.use_cases[0];
    expect(useCase.lernfelder).toEqual(['LF2', 'LF3']);
    // every row of the learning field import belongs to the Excel file
    const owners = h.store.appliedRows
      .filter(r => r.table.startsWith('training_catalog_'))
      .map(r => r.fileId);
    expect(owners.length).toBeGreaterThan(13);
    expect(new Set(owners)).toEqual(new Set([mapping.file.id]));
    expect(h.store.markedFiles).toContain(mapping.file.id);
  });

  it('is unchanged the second time, extended when a new enabler brings new mappings, and never replaces', async () => {
    const mapping = xlsxMappingFile(await mappingK4());
    const first = harness([...(await enablerFiles({ tree: true })), mapping], {
      components: [K4],
    });
    await applyAll(first);
    const rows = first.db.totalRows();

    const second = again([mapping], first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok && dry.data.stock.files[0].status).toBe('unchanged');
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    expect(first.db.totalRows()).toBe(rows);
    expect(second.store.appliedRows).toHaveLength(0);

    // the owner changes a title of a learning field by hand: the run reports it and leaves it
    first.db.tables.training_catalog_learning_fields[0].title =
      'Von Hand geändert';
    const third = again([mapping], first);
    const dry3 = await runTransfer(third.deps, request('dry_run'));
    expect(dry3.ok).toBe(true);
    if (!dry3.ok) return;
    expect(dry3.data.differences.length).toBeGreaterThan(0);
    await runTransfer(third.deps, request('apply'));
    expect(first.db.tables.training_catalog_learning_fields[0].title).toBe(
      'Von Hand geändert'
    );

    // a position of the table that the catalog gets later: the run adds its mappings
    const more = xlsxMappingFile(
      new Uint8Array(
        await makeXlsx([
          {
            name: 'Zuordnung',
            rows: [
              HEADER,
              row(5, block(4, 'Erfundenes Viertes', 2, 4), 'a) A', 'LF 2, 3'),
              row(6, null, 'b) B', 'LF 3'),
            ].map(r => ({ row: r.row, cells: r.cells })),
          },
        ])
      )
    );
    const quizJson = lessonJson([k4('4b')]);
    const fourth = again([quizJson, more], first);
    const dry4 = await runTransfer(fourth.deps, request('dry_run'));
    expect(dry4.ok).toBe(true);
    if (!dry4.ok) return;
    expect(
      dry4.data.stock.files.find(f => f.fileId === more.file.id)?.status
    ).toBe('extended');
  });

  it('restores the codes of a use case in the rollback text', async () => {
    const content = await enablerFiles({ tree: true });
    const first = harness(content, { components: [K4] });
    await applyAll(first);
    const mapping = xlsxMappingFile(await mappingK4());
    const second = again([mapping], first);
    await applyAll(second);
    const updates = second.store.appliedRows.filter(r => r.action === 'update');
    expect(updates.map(r => r.table)).toEqual(['use_cases']);
    expect(updates[0].before).toEqual({ lernfelder: null });
    const sql = buildRollbackSql({
      applyId: 'aaaaaaaa-0000-4000-8000-0000000000a2',
      runId: 'cccccccc-0000-4000-8000-000000000001',
      startedAt: new Date('2026-10-27T10:00:00Z'),
      generatedAt: new Date('2026-10-27T10:05:00Z'),
      rows: second.store.appliedRows.map(r => ({
        table: r.table,
        rowId: r.rowId,
        action: r.action,
        before: r.before,
      })),
    });
    expect(sql.restores.use_cases).toBe(1);
    expect(sql.deletes.training_catalog_content_mappings).toBeGreaterThan(0);
    expect(sql.deletes.training_catalog_learning_fields).toBe(13);
    expect(
      sql.sql.indexOf('delete from training_catalog_content_mappings')
    ).toBeLessThan(
      sql.sql.indexOf('delete from training_catalog_learning_fields')
    );
  });

  it('refuses the run when the catalog has no enabler yet, and says why', async () => {
    const mapping = xlsxMappingFile(await mappingK4());
    const h = harness([mapping], { components: [K4] });
    const dry = await runTransfer(h.deps, request('dry_run'));
    expect(dry.ok).toBe(false);
    if (dry.ok) return;
    expect(dry.code).toBe('NO_ENABLERS');
    expect(h.store.state.status).toBe('review');
  });

  it('compares the table before a decision and only reads', async () => {
    const content = await enablerFiles({ tree: true });
    const mapping = xlsxMappingFile(await mappingK4());
    const first = harness(content, { components: [K4] });
    await applyAll(first);
    const second = again([mapping], first);
    const result = await compareStock(second.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.stock.files[0]).toMatchObject({
      fileId: mapping.file.id,
      status: 'new',
    });
    expect(first.db.count('training_catalog_learning_fields')).toBe(0);
  });
});
