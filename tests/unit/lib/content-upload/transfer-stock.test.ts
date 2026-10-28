/**
 * @jest-environment node
 */
// The supply of content (docs/ki-upload-konzept.md 8.9): the status per file that the
// dry run and the comparison report, extended quizzes, replacing a differing file by
// the choice of a person, and the idempotence of a second run. Invented files, memory
// database.
import { describe, expect, it } from '@jest/globals';

import { compareStock } from '@/lib/content-upload/transfer/compare';
import {
  runTransfer,
  type TransferRequest,
} from '@/lib/content-upload/transfer/run';
import {
  countStock,
  emptyStockCounts,
  readStoredStock,
  stockOfFiles,
} from '@/lib/content-upload/transfer/stock';

import { CREATOR_ID } from '../../../helpers/memoryImportDb';
import {
  harness,
  memoryConnections,
  type Harness,
} from '../../../helpers/memoryTransfer';
import {
  docx,
  enablerFiles,
  fixtureFile,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import {
  enablerBlocks,
  quizBlocks,
  scenarioBlocks,
} from '../../../helpers/uploadFixtures';

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

const byType = (files: FixtureFile[], type: string) =>
  files.find(f => f.file.decision.docType === type) as FixtureFile;

/** The same files with the quiz of K4-a cut to this many questions. */
async function withQuizOf(files: FixtureFile[], questions: number) {
  const quiz = byType(files, 'quiz');
  const short = fixtureFile(await docx(quizBlocks({ code: '4a', questions })), {
    rel: quiz.file.relPath,
    name: quiz.file.fileName,
    docType: 'quiz',
    componentCode: 'K4',
    enablerCode: 'K4-a',
    quizLevel: 'low',
  });
  return files.map(f => (f === quiz ? short : f));
}

async function applyAll(h: Harness, extra: Partial<TransferRequest> = {}) {
  const dry = await runTransfer(h.deps, request('dry_run', extra));
  expect(dry.ok).toBe(true);
  const done = await runTransfer(h.deps, request('apply', extra));
  expect(done.ok && done.data.wrote).toBe(true);
  return done.ok ? done.data : null;
}

/**
 * A second run against the database of the first (a run in the state applied would stop
 * it). The connections roll back THIS database, so a dry run leaves it as it was.
 */
function again(files: FixtureFile[], first: Harness): Harness {
  const h = harness(files, { deps: { makeDb: () => first.db } });
  h.deps.connections = memoryConnections(h.timeline, first.db);
  return h;
}

describe('the status of the supply in the report of a dry run', () => {
  it('says new for every file that is inserted and stores it for the list', async () => {
    const files = await enablerFiles({ tree: true });
    const h = harness(files);
    const dry = await runTransfer(h.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.stock.counts).toEqual({
      ...emptyStockCounts(),
      new: 4,
    });
    expect(dry.data.stock.files.map(f => f.status)).toEqual([
      'new',
      'new',
      'new',
      'new',
    ]);
    // saved for the review list: one record per file, with the assignment it was made for
    expect(h.store.stockWrites).toHaveLength(4);
    const quiz = h.store.stockWrites.find(
      w => w.fileId === byType(files, 'quiz').file.id
    );
    expect(quiz?.stock).toMatchObject({
      status: 'new',
      assign: 'quiz|K4|K4-a|low',
    });
    expect(readStoredStock({ stock: quiz?.stock })).not.toBeNull();
    expect(h.store.state.status).toBe('review');
  });

  it('says unchanged for the same files after an apply, and a second apply adds nothing', async () => {
    const files = await enablerFiles({ tree: true });
    const first = harness(files);
    await applyAll(first);
    expect(first.store.stockCleared).toBe(1);
    const rows = first.db.totalRows();

    const second = again(files, first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok && dry.data.stock.counts).toEqual({
      ...emptyStockCounts(),
      unchanged: 4,
    });
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    expect(first.db.totalRows()).toBe(rows);
    expect(second.store.appliedRows).toHaveLength(0);
  });

  it('adds the missing questions of a quiz and reports them as extended', async () => {
    const files = await enablerFiles({ tree: true });
    const short = await withQuizOf(files, 3);
    const first = harness(short);
    await applyAll(first);
    expect(first.db.count('questions')).toBe(3);

    const second = again(files, first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.status).toBe('ok');
    expect(dry.data.stock.counts).toMatchObject({ extended: 1, unchanged: 3 });
    const quiz = byType(files, 'quiz').file.id;
    expect(dry.data.stock.files.find(f => f.fileId === quiz)).toMatchObject({
      status: 'extended',
      added: 2,
      moved: 0,
    });
    expect(dry.data.extended).toEqual([
      { quiz: 'K4-a-low', added: 2, moved: 0 },
    ]);
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    expect(first.db.count('questions')).toBe(5);
    // nothing was changed or removed, only inserted
    expect(
      second.store.appliedRows.filter(r => r.action === 'update')
    ).toHaveLength(0);

    const third = again(files, first);
    const dry3 = await runTransfer(third.deps, request('dry_run'));
    expect(dry3.ok && dry3.data.stock.counts.unchanged).toBe(4);
  });

  it('takes a quiz and a scenario alone: the enabler of the database stands in for its document', async () => {
    const files = await enablerFiles({ tree: true });
    const first = harness(
      (await withQuizOf(files, 3)).filter(f => f.file.decision.docType !== 'scenario')
    );
    await applyAll(first);
    expect(first.db.count('questions')).toBe(3);

    const quiz = byType(files, 'quiz');
    const scenario = byType(files, 'scenario');
    const second = again([quiz, scenario], first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.status).toBe('ok');
    expect(
      Object.fromEntries(dry.data.stock.files.map(f => [f.fileId, f.status]))
    ).toEqual({ [quiz.file.id]: 'extended', [scenario.file.id]: 'new' });
    // the enabler is no item of a file and counts as unchanged
    expect(dry.data.tables.enablers).toEqual({ insert: 0, update: 0, unchanged: 1 });
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    expect(first.db.count('questions')).toBe(5);
    expect(first.db.count('enablers')).toBe(1);
    expect(second.store.appliedRows.every(r => r.action === 'insert')).toBe(true);
  });

  it('adds a scenario that was missing, as a supply of one file', async () => {
    const files = await enablerFiles({ tree: true });
    const scenario = byType(files, 'scenario');
    const first = harness(files.filter(f => f !== scenario));
    await applyAll(first);

    const second = again(files, first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(
      dry.data.stock.files.find(f => f.fileId === scenario.file.id)?.status
    ).toBe('new');
    expect(dry.data.stock.counts).toMatchObject({ new: 1, unchanged: 3 });
    const applied = await runTransfer(second.deps, request('apply'));
    expect(applied.ok && applied.data.tables.content_documents.insert).toBe(1);
  });
});

describe('a file that differs from the database', () => {
  async function differing() {
    const files = await enablerFiles({ tree: true });
    const first = harness(files);
    await applyAll(first);
    const text = byType(files, 'enabler');
    const changed = fixtureFile(
      await docx(
        enablerBlocks({
          code: '4a',
          title: 'Netzwerkgeräte a',
          paragraphs: 5,
        })
      ),
      {
        rel: text.file.relPath,
        name: text.file.fileName,
        docType: 'enabler',
        componentCode: 'K4',
        enablerCode: 'K4-a',
      }
    );
    const next = files.map(f => (f === text ? changed : f));
    return { first, next, changed };
  }

  it('is reported as differs and left alone by default', async () => {
    const { first, next, changed } = await differing();
    const before = first.db.tables.enablers[0].description_text;
    const second = again(next, first);
    const done = await applyAll(second);
    expect(
      done?.stock.files.find(f => f.fileId === changed.file.id)?.status
    ).toBe('differs');
    expect(done?.differences).toEqual([
      { table: 'enablers', key: 'K4-a', columns: ['description_text'] },
    ]);
    expect(first.db.tables.enablers[0].description_text).toBe(before);
    expect(
      second.store.appliedRows.filter(r => r.action === 'update')
    ).toHaveLength(0);
  });

  it('keeps a file that differs and was not replaced as decided, not applied', async () => {
    const { first, next, changed } = await differing();
    const second = again(next, first);
    await applyAll(second);
    expect(second.store.markedFiles).not.toContain(changed.file.id);
    // the files that were checked and need nothing are done
    expect(second.store.markedFiles).toHaveLength(3);
    const third = again(next, first);
    await applyAll(third, { replaceFiles: [changed.file.id] });
    expect(third.store.markedFiles).toContain(changed.file.id);
  });

  it('is replaced only for the file a person named, with the old value in the protocol', async () => {
    const { first, next, changed } = await differing();
    const before = first.db.tables.enablers[0].description_text;
    const second = again(next, first);
    const done = await applyAll(second, { replaceFiles: [changed.file.id] });
    expect(done?.replaceFiles).toEqual([changed.file.id]);
    expect(first.db.tables.enablers[0].description_text).not.toBe(before);
    const updates = second.store.appliedRows.filter(r => r.action === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      table: 'enablers',
      fileId: changed.file.id,
    });
    expect(updates[0].before).toEqual({ description_text: before });
    // never the activation, the author or a storage column
    expect(Object.keys(updates[0].before ?? {})).toEqual(['description_text']);
    expect(first.db.tables.enablers[0].is_active).toBe(false);
  });

  it('does not replace the rows of a file that was not named', async () => {
    const { first, next } = await differing();
    const before = first.db.tables.enablers[0].description_text;
    const other = byType(next, 'quiz').file.id;
    const second = again(next, first);
    await applyAll(second, { replaceFiles: [other] });
    expect(first.db.tables.enablers[0].description_text).toBe(before);
  });

  it('refuses to replace a file that is not part of the transfer, before anything runs', async () => {
    const files = await enablerFiles({ tree: true });
    const h = harness(files);
    const result = await runTransfer(
      h.deps,
      request('dry_run', {
        replaceFiles: ['dddddddd-0000-4000-8000-0000000000ff'],
      })
    );
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'REPLACE_NOT_PLANNED',
    });
    expect(h.connections.reserved).toBe(0);
    expect(h.store.gateCalls).toEqual([]);
  });

  it('needs a dry run for exactly this choice', async () => {
    const { first, next, changed } = await differing();
    const second = again(next, first);
    await runTransfer(second.deps, request('dry_run'));
    expect(
      await runTransfer(
        second.deps,
        request('apply', { replaceFiles: [changed.file.id] })
      )
    ).toMatchObject({ ok: false, code: 'DRY_RUN_REQUIRED' });
  });
});

describe('a conflict names its file', () => {
  it('marks the file whose quiz exists with another meaning', async () => {
    const files = await enablerFiles({ tree: true });
    const first = harness(files);
    await applyAll(first);
    first.db.tables.quizzes[0].quiz_type = 'GLOBAL';
    const second = again(files, first);
    const dry = await runTransfer(second.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.data.status).toBe('conflict');
    const quiz = byType(files, 'quiz').file.id;
    expect(dry.data.stock.files.find(f => f.fileId === quiz)?.status).toBe(
      'conflict'
    );
    expect(dry.data.stock.counts.conflict).toBe(1);
    expect(second.store.stockWrites.map(w => w.stock.status)).toContain(
      'conflict'
    );
  });
});

describe('the comparison before a decision', () => {
  it('reads the files like a dry run, only reads, and stores the status', async () => {
    const files = await enablerFiles({ tree: true });
    const h = harness(files);
    const result = await compareStock(h.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ compared: 4, stored: 4 });
    expect(result.data.stock.counts).toMatchObject({ new: 4 });
    expect(h.store.loadOptions).toEqual([{ effective: true }]);
    // a read only transaction that is rolled back, nothing written, the run untouched
    expect(h.connections.queries[0]).toMatch(
      /^begin isolation level repeatable read read only/
    );
    expect(h.timeline.events).toContain('connection.rollback');
    expect(h.timeline.events).not.toContain('connection.commit');
    expect(h.db.totalRows()).toBe(0);
    expect(h.store.gateCalls).toEqual([]);
    expect(h.store.attempts).toEqual([]);
    expect(h.store.state.status).toBe('review');
    expect(h.store.stockReplaced).toBe(1);
    expect(h.store.stockWrites).toHaveLength(4);
  });

  it('sees what the database holds: unchanged and extended', async () => {
    const files = await enablerFiles({ tree: true });
    const first = harness(await withQuizOf(files, 3));
    await applyAll(first);
    const h = again(files, first);
    const result = await compareStock(h.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    expect(result.ok && result.data.stock.counts).toMatchObject({
      extended: 1,
      unchanged: 3,
    });
  });

  it('refuses a run that is not in review and a target that does not fit', async () => {
    const files = await enablerFiles({ tree: true });
    const h = harness(files, { run: { status: 'applied' } });
    expect(
      await compareStock(h.deps, {
        runId: request('dry_run').runId,
        callerId: CREATOR_ID,
      })
    ).toMatchObject({ ok: false, status: 409, code: 'RUN_STATE' });
    const g = harness(files, {
      deps: {
        host: 'db.example.org',
        readFacts: async () => ({
          host: 'db.example.org',
          currentSchema: 'public',
          resolvedSchema: 'public',
          currentUser: 'postgres',
          sessionUser: 'postgres',
          hasPreviewMarkers: false,
        }),
      },
    });
    const refused = await compareStock(g.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    expect(refused).toMatchObject({
      ok: false,
      status: 409,
      code: 'TARGET_REFUSED',
    });
    expect(g.store.stockWrites).toEqual([]);
  });

  it('answers 404 for a run that does not exist', async () => {
    const h = harness(await enablerFiles({ tree: true }));
    expect(
      await compareStock(h.deps, {
        runId: 'cccccccc-0000-4000-8000-0000000000aa',
        callerId: CREATOR_ID,
      })
    ).toMatchObject({ ok: false, status: 404 });
  });

  it('opens no connection when no file became an item', async () => {
    const files = await enablerFiles({ tree: true });
    const h = harness(
      files.map(f => ({
        ...f,
        file: {
          ...f.file,
          decision: { ...f.file.decision, action: 'reject' as const },
        },
      }))
    );
    const result = await compareStock(h.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    expect(result.ok && result.data.compared).toBe(0);
    expect(h.connections.reserved).toBe(0);
  });

  it('a scenario file with its enabler new in the same plan counts as new', async () => {
    const files = await enablerFiles({ tree: true });
    const h = harness(files);
    const result = await compareStock(h.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    const useCase = byType(files, 'use_case').file.id;
    expect(
      result.ok &&
        result.data.stock.files.find(f => f.fileId === useCase)?.status
    ).toBe('new');
  });
});

describe('stockOfFiles', () => {
  const plans = {
    importPlan: {
      enablers: [{ code: 'E1', source: 'a' }],
      scenarios: [{ enablerCode: 'E1', source: 'b' }],
      quizzes: [
        {
          code: 'Q1',
          kind: 'lesson',
          enablerCode: 'E1',
          level: 'low',
          source: 'c',
        },
      ],
    },
    useCasePlan: { useCases: [{ code: 'U1', enablerCode: 'E1', source: 'd' }] },
    fileOfSource: new Map([
      ['a', 'fa'],
      ['b', 'fb'],
      ['c', 'fc'],
      ['d', 'fd'],
    ]),
  } as unknown as Parameters<typeof stockOfFiles>[0];
  const of = (events: Array<[string, string, string]>, extra = {}) =>
    stockOfFiles({
      ...plans,
      ...extra,
      events: events.map(([table, key, status]) => ({
        table,
        key,
        status: status as 'new',
      })),
    });

  it('takes the worst status of a file: conflict, differs, extended, new, unchanged', () => {
    const stock = of([
      ['quizzes', 'Q1', 'unchanged'],
      ['questions', 'Q1#1', 'differs'],
      ['options', 'Q1#1a', 'unchanged'],
      ['enablers', 'E1', 'unchanged'],
      ['enabler_quiz_links', 'E1/LOW', 'conflict'],
      ['content_documents', 'E1:Szenario E1: Ausgangssituation', 'new'],
      ['use_cases', 'U1', 'unchanged'],
      ['content_documents', 'U1:Use Case U1: Behandelte Themen', 'new'],
    ]);
    expect(stock.get('fc')?.status).toBe('conflict');
    // a new part next to an unchanged one is an extension of what exists
    expect(stock.get('fd')?.status).toBe('extended');
    expect(stock.get('fb')?.status).toBe('new');
    expect(stock.get('fa')?.status).toBe('unchanged');
    expect(countStock(stock)).toEqual({
      conflict: 1,
      differs: 0,
      extended: 1,
      new: 1,
      unchanged: 1,
    });
  });

  it('ignores shared rows, unknown keys and documents of an original', () => {
    const stock = of([
      ['training_components', 'K1', 'new'],
      ['courses', 'K1', 'unchanged'],
      ['quizzes', 'Qx', 'new'],
      ['content_documents', 'E1:Datei Original', 'new'],
      ['content_documents', 'nokey', 'new'],
      ['tablex', 'k', 'new'],
    ]);
    expect(stock.size).toBe(0);
  });

  it('a use case that waits for a new enabler is new, one that waits for a missing enabler conflicts', () => {
    const waiting = of([['enablers', 'E1', 'new']], {
      useCasesSkippedInDb: [{ useCaseCode: 'U1' }],
    });
    expect(waiting.get('fd')?.status).toBe('new');
    const missing = of([], { useCasesSkippedInDb: [{ useCaseCode: 'U1' }] });
    expect(missing.get('fd')?.status).toBe('conflict');
    expect(of([], { useCasesSkippedInDb: [{ useCaseCode: 'U9' }] }).size).toBe(
      0
    );
  });

  it('adds the numbers of an extension', () => {
    const stock = of([]);
    expect(stock.size).toBe(0);
    const extended = stockOfFiles({
      ...plans,
      events: [
        { table: 'quizzes', key: 'Q1', status: 'extended', added: 2, moved: 1 },
      ],
    });
    expect(extended.get('fc')).toEqual({
      status: 'extended',
      added: 2,
      moved: 1,
    });
  });

  it('reads a stored record only when it is complete', () => {
    expect(readStoredStock(null)).toBeNull();
    expect(readStoredStock({})).toBeNull();
    expect(readStoredStock({ stock: 'x' })).toBeNull();
    expect(
      readStoredStock({ stock: { status: 'new', assign: 'a' } })
    ).toBeNull();
    expect(
      readStoredStock({
        stock: { status: 'bogus', assign: 'a', at: '2026-10-27T00:00:00Z' },
      })
    ).toBeNull();
    expect(
      readStoredStock({
        stock: {
          status: 'extended',
          added: 2.5,
          moved: -1,
          assign: 'a',
          at: '2026-10-27T00:00:00Z',
        },
      })
    ).toEqual({
      status: 'extended',
      added: 0,
      moved: 0,
      assign: 'a',
      at: '2026-10-27T00:00:00Z',
    });
  });
});

describe('the supply keeps the solution parts out', () => {
  it('never puts a canary word into the report or the stored status', async () => {
    const files = await enablerFiles({ tree: true });
    const h = harness(files);
    const dry = await runTransfer(h.deps, request('dry_run'));
    const compared = await compareStock(h.deps, {
      runId: request('dry_run').runId,
      callerId: CREATOR_ID,
    });
    const text = JSON.stringify([dry, compared, h.store.stockWrites]);
    expect(text).not.toMatch(/ZEBRAKANAL|QUOKKA|WOMBAT|LAMA|OKAPI|TAPIR/);
    expect(scenarioBlocks().length).toBeGreaterThan(0);
  });
});
