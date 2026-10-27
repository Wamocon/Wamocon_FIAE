/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import { ImportAbort } from '@/lib/content-import/apply/db';
import { parseDecisions } from '@/lib/content-import/apply/decisions';
import {
  FIXED_ENGINE_OPTIONS,
  PLAN_BUDGET_MS,
  STALE_APPLYING_MINUTES,
  readConnectionFacts,
  runTransfer,
  type TransferRequest,
} from '@/lib/content-upload/transfer/run';
import { transferDecisions } from '@/lib/content-upload/transfer/preset';

import { CREATOR_ID } from '../../../helpers/memoryImportDb';
import {
  harness,
  LOCAL_FACTS,
  memoryConnections,
} from '../../../helpers/memoryTransfer';
import {
  docx,
  enablerFiles,
  fixtureFile,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import { enablerBlocks, b, t } from '../../../helpers/uploadFixtures';

const request = (
  mode: 'dry_run' | 'apply',
  extra: Partial<TransferRequest> = {}
): TransferRequest => ({
  runId: 'cccccccc-0000-4000-8000-000000000001',
  callerId: CREATOR_ID,
  mode,
  updateExisting: false,
  publishOriginals: [],
  ...(mode === 'apply' ? { confirm: 'KFBM' } : {}),
  ...extra,
});

/** A database that fails with this error (set after the dry run, so only the apply meets it). */
function failing(error: Error) {
  return () => {
    throw error;
  };
}

const before = (events: string[], a: string, b2: string) =>
  events.indexOf(a) >= 0 &&
  events.indexOf(b2) >= 0 &&
  events.indexOf(a) < events.indexOf(b2);

describe('runTransfer: the fixed settings', () => {
  it('says activate false and no solution rows, as a constant', () => {
    expect(FIXED_ENGINE_OPTIONS).toEqual({
      activate: false,
      scenarioSolutions: false,
      useCaseSolutions: false,
    });
    expect(Object.isFrozen(FIXED_ENGINE_OPTIONS)).toBe(true);
    expect(STALE_APPLYING_MINUTES).toBe(15);
    expect(PLAN_BUDGET_MS).toBeLessThan(60_000);
  });

  it('every row of an apply is inactive and no document holds a solution (presets with activate true)', async () => {
    const h = harness(await enablerFiles({ tree: true }), {
      deps: { decisions: parseDecisionsWithActivation() },
    });
    const dry = await runTransfer(h.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    const applied = await runTransfer(h.deps, request('apply'));
    expect(applied.ok && applied.data.wrote).toBe(true);
    const t = h.db.tables;
    for (const row of [...t.courses]) {
      expect(row.is_active).toBe(false);
      expect(row.is_published).toBe(false);
    }
    for (const row of [...t.enablers, ...t.quizzes, ...t.use_cases]) {
      expect(row.is_active).toBe(false);
    }
    expect(
      t.content_documents.some(d => d.document_type === 'TRAINER_SOLUTION')
    ).toBe(false);
    expect(t.content_documents.length).toBeGreaterThan(0);
  });
});

function parseDecisionsWithActivation() {
  const raw = JSON.parse(JSON.stringify(transferDecisions()));
  raw.content.activate = true;
  const result = parseDecisions(raw);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.decisions;
}

describe('runTransfer: a dry run', () => {
  it('opens the gate first, reads on the connection of the engines and rolls back', async () => {
    const h = harness(await enablerFiles({ tree: true }));
    const result = await runTransfer(h.deps, request('dry_run'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const e = h.timeline.events;
    expect(before(e, 'store.beginApplying', 'connection.reserve')).toBe(true);
    expect(before(e, 'connection.begin', 'connection.rollback')).toBe(true);
    expect(e).not.toContain('connection.commit');
    expect(e.filter(x => x === 'connection.release')).toHaveLength(1);
    expect(e.some(x => x.startsWith('protocol.'))).toBe(false);
    // the engines wrote inside the transaction and it was undone
    expect(h.db.totalRows()).toBe(0);
    expect(h.store.gateCalls).toEqual([{ version: 1, requireHash: null }]);
    expect(h.store.state.status).toBe('review');
    expect(h.store.state.lastDryRunHash).toBe(result.data.decisionsHash);
    expect(result.data).toMatchObject({
      status: 'ok',
      readyToApply: true,
      wrote: false,
    });
    expect(result.data.applyId).toBe('attempt-1');
    expect(h.store.attempts[0]).toMatchObject({
      mode: 'dry_run',
      status: 'ok',
      decisionsVersion: 1,
      updateExisting: false,
    });
    // numbers only in the protocol of the attempt
    expect(JSON.stringify(h.store.attempts[0].counts)).not.toMatch(
      /Kanarien|ZEBRA/
    );
  });

  it('puts the target check, the isolation level and the lock inside the transaction', async () => {
    const h = harness(await enablerFiles({ tree: true }));
    await runTransfer(h.deps, request('dry_run'));
    const q = h.connections.queries;
    expect(q[0]).toMatch(/^begin isolation level repeatable read read write/);
    expect(q.some(x => x.startsWith('set local lock_timeout'))).toBe(true);
    expect(q.some(x => x.includes('pg_try_advisory_xact_lock'))).toBe(true);
    expect(q[q.length - 1]).toBe('rollback');
  });

  it('reports conflicts and clears the hash', async () => {
    const h = harness(await enablerFiles({ tree: true }), {
      deps: {
        makeDb: () => {
          throw new ImportAbort('CONFLICTS', 'x', [
            { table: 'quizzes', key: 'K4-a-low', reason: 'another number' },
          ]);
        },
      },
    });
    const result = await runTransfer(h.deps, request('dry_run'));
    expect(result.ok && result.data).toMatchObject({
      status: 'conflict',
      readyToApply: false,
      conflicts: [
        { table: 'quizzes', key: 'K4-a-low', reason: 'another number' },
      ],
    });
    expect(h.store.state).toMatchObject({
      status: 'review',
      lastDryRunHash: null,
    });
    expect(h.store.attempts[0]).toMatchObject({ status: 'conflict' });
    expect(h.store.attempts[0].conflicts).toHaveLength(1);
    expect(h.timeline.events).toContain('connection.rollback');
  });

  it('lists what it left out and what the planner skipped, as codes', async () => {
    const files = await enablerFiles({ tree: true });
    files[1].file.decision.action = 'reject';
    const h = harness(files);
    const result = await runTransfer(h.deps, request('dry_run'));
    expect(result.ok && result.data.excluded.map(e => e.code)).toEqual([
      'REJECTED',
    ]);
  });
});

describe('runTransfer: an apply', () => {
  async function dryThenApply(
    options: Parameters<typeof harness>[1] = {},
    files?: FixtureFile[]
  ) {
    const h = harness(files ?? (await enablerFiles({ tree: true })), options);
    const dry = await runTransfer(h.deps, request('dry_run'));
    expect(dry.ok).toBe(true);
    h.timeline.events.length = 0;
    return h;
  }

  it('writes content, use cases and the protocol on ONE connection and commits last', async () => {
    const h = await dryThenApply();
    const result = await runTransfer(h.deps, request('apply'));
    expect(result.ok && result.data).toMatchObject({
      status: 'ok',
      wrote: true,
    });
    const e = h.timeline.events;
    expect(e.indexOf('store.beginApplying')).toBeLessThan(
      e.indexOf('connection.reserve')
    );
    // the order of the protocol inside the transaction, then the commit
    const order = [
      'connection.begin',
      'protocol.insertApply',
      'protocol.insertAppliedRows',
      'protocol.markFilesApplied',
      'protocol.finishRunApplied',
      'connection.commit',
      'connection.release',
    ];
    expect(order.map(x => e.indexOf(x))).toEqual(
      [...order.map(x => e.indexOf(x))].sort((a, b2) => a - b2)
    );
    expect(order.every(x => e.includes(x))).toBe(true);
    // one reservation for the content AND the use cases
    expect(h.connections.reserved).toBe(2);
    expect(h.db.count('use_cases')).toBe(1);
    expect(h.db.count('enablers')).toBe(1);
    expect(h.store.appliedRows).toHaveLength(h.db.totalRows());
    expect(h.store.markedFiles).toHaveLength(4);
    expect(h.store.state.status).toBe('applied');
    // the gate asked for the hash of the dry run
    expect(h.store.gateCalls[1].requireHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.store.attempts.filter(a => a.mode === 'apply')).toHaveLength(1);
  });

  it('refuses without the dry run of this plan, with another switch and after a change', async () => {
    const h = harness(await enablerFiles({ tree: true }));
    expect(await runTransfer(h.deps, request('apply'))).toMatchObject({
      ok: false,
      status: 409,
      code: 'DRY_RUN_REQUIRED',
    });
    expect(h.connections.reserved).toBe(0);
    await runTransfer(h.deps, request('dry_run', { updateExisting: true }));
    expect(await runTransfer(h.deps, request('apply'))).toMatchObject({
      code: 'DRY_RUN_REQUIRED',
    });
    expect(h.db.totalRows()).toBe(0);
    expect(h.store.state.status).toBe('review');
  });

  it('needs the catalog code typed exactly', async () => {
    const h = await dryThenApply();
    for (const confirm of [undefined, '', 'kfbm', ' KFBM', 'FIAE']) {
      expect(
        await runTransfer(h.deps, request('apply', { confirm }))
      ).toMatchObject({
        ok: false,
        status: 400,
        code: 'CONFIRM_REQUIRED',
      });
    }
    expect(h.timeline.events).toEqual([]);
  });

  it('a failure of the protocol takes the content back and leaves the run in review', async () => {
    const h = await dryThenApply();
    h.store.failProtocolAt = 'insertAppliedRows';
    await expect(runTransfer(h.deps, request('apply'))).rejects.toThrow(
      'broke'
    );
    expect(h.db.totalRows()).toBe(0);
    expect(h.timeline.events).toContain('connection.rollback');
    expect(h.timeline.events).not.toContain('connection.commit');
    expect(h.store.state).toMatchObject({
      status: 'review',
      lastDryRunHash: null,
    });
    expect(h.store.attempts.at(-1)).toMatchObject({
      mode: 'apply',
      status: 'failed',
    });
    expect(
      h.timeline.events.filter(x => x === 'connection.release')
    ).toHaveLength(1);
  });

  it('a run that is no longer applying aborts the transaction', async () => {
    const h = await dryThenApply();
    h.store.failProtocolAt = 'finishRunApplied';
    const result = await runTransfer(h.deps, request('apply'));
    expect(result).toMatchObject({ ok: false, status: 409, code: 'RUN_STATE' });
    expect(h.db.totalRows()).toBe(0);
  });

  it('turns a conflict at apply time into a report with status 409 data and nothing written', async () => {
    const h = await dryThenApply();
    h.deps.makeDb = failing(
      new ImportAbort('CONFLICTS', 'x', [
        { table: 'enablers', key: 'K4-a', reason: 'exists elsewhere' },
      ])
    );
    const result = await runTransfer(h.deps, request('apply'));
    expect(result.ok && result.data).toMatchObject({
      status: 'conflict',
      wrote: false,
    });
    expect(h.store.state).toMatchObject({
      status: 'review',
      lastDryRunHash: null,
    });
    expect(h.store.attempts.at(-1)).toMatchObject({
      mode: 'apply',
      status: 'conflict',
    });
  });

  it('keeps the hash of the dry run when another import holds the lock', async () => {
    const h = await dryThenApply();
    const hash = h.store.state.lastDryRunHash;
    h.deps.connections = memoryConnections(h.timeline, h.db, { locked: false });
    const result = await runTransfer(h.deps, request('apply'));
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: 'IMPORT_LOCKED',
    });
    expect(h.store.state).toMatchObject({
      status: 'review',
      lastDryRunHash: hash,
    });
    expect(h.db.totalRows()).toBe(0);
  });

  it('refuses a target that does not fit, and never names the host', async () => {
    const h = await dryThenApply();
    h.deps.host = 'db.secret-project.supabase.co';
    h.deps.readFacts = async (_q, host) => ({ ...LOCAL_FACTS, host });
    const result = await runTransfer(h.deps, request('apply'));
    expect(result).toMatchObject({ ok: false, code: 'TARGET_REFUSED' });
    expect(JSON.stringify(result)).not.toContain('secret-project');
    expect(JSON.stringify(h.store.attempts)).not.toContain('secret-project');
    expect(h.db.totalRows()).toBe(0);
  });

  it('refuses the schema public on a hosted host (the shape of Production)', async () => {
    const h = harness(await enablerFiles({ tree: true }), {
      deps: {
        host: 'db.example.supabase.co',
        readFacts: async (_q, host) => ({ ...LOCAL_FACTS, host }),
      },
    });
    const result = await runTransfer(h.deps, request('dry_run'));
    expect(result).toMatchObject({ ok: false, code: 'TARGET_REFUSED' });
    // the Preview shape passes the target check
    const preview = harness(await enablerFiles({ tree: true }), {
      deps: {
        host: 'db.example.supabase.co',
        readFacts: async (_q, host) => ({
          host,
          currentSchema: 'public_preview',
          resolvedSchema: 'public_preview',
          currentUser: 'app_preview',
          sessionUser: 'app_preview',
          hasPreviewMarkers: true,
        }),
      },
    });
    expect(await runTransfer(preview.deps, request('dry_run'))).toMatchObject({
      ok: true,
    });
  });

  it('rethrows an unexpected error after it gave the run back and logged only a code', async () => {
    const h = await dryThenApply();
    h.deps.makeDb = failing(
      Object.assign(new Error('could not serialize secret-table'), {
        code: '40001',
      })
    );
    await expect(runTransfer(h.deps, request('apply'))).rejects.toThrow(
      'serialize'
    );
    expect(h.store.state.status).toBe('review');
    const last = h.store.attempts.at(-1)!;
    expect(last).toMatchObject({
      status: 'failed',
      counts: { errorCode: '40001' },
    });
    expect(JSON.stringify(last)).not.toContain('secret-table');
  });
});

describe('runTransfer: the state of the run', () => {
  it('answers 404 for an unknown run and 409 for a run that is not in review', async () => {
    const h = harness(await enablerFiles({ tree: true }), {
      run: { status: 'processing' },
    });
    expect(
      await runTransfer(h.deps, { ...request('dry_run'), runId: 'other' })
    ).toMatchObject({ status: 404 });
    expect(await runTransfer(h.deps, request('dry_run'))).toMatchObject({
      status: 409,
      code: 'RUN_STATE',
    });
    expect(h.connections.reserved).toBe(0);
  });

  it('refuses another catalog than KFBM', async () => {
    const h = harness(await enablerFiles({ tree: true }), {
      run: { catalogCode: 'FIAE' },
    });
    expect(await runTransfer(h.deps, request('dry_run'))).toMatchObject({
      status: 409,
      code: 'CATALOG_UNSUPPORTED',
    });
  });

  it('gives back a run that has been applying for 15 minutes, not a younger one', async () => {
    const stale = harness(await enablerFiles({ tree: true }), {
      run: {
        status: 'applying',
        updatedAt: new Date(Date.now() - 16 * 60_000),
      },
    });
    expect(await runTransfer(stale.deps, request('dry_run'))).toMatchObject({
      ok: true,
    });
    expect(stale.timeline.events).toContain('store.releaseStale(15)');
    const fresh = harness(await enablerFiles({ tree: true }), {
      run: { status: 'applying', updatedAt: new Date() },
    });
    expect(await runTransfer(fresh.deps, request('dry_run'))).toMatchObject({
      status: 409,
      code: 'RUN_STATE',
    });
  });

  it('says NOTHING_TO_TRANSFER when no file becomes an item', async () => {
    const files = await enablerFiles({ tree: true });
    for (const f of files) f.file.decision.action = 'defer';
    const h = harness(files);
    expect(await runTransfer(h.deps, request('dry_run'))).toMatchObject({
      status: 409,
      code: 'NOTHING_TO_TRANSFER',
    });
    expect(h.timeline.events).toEqual([]);
  });

  it('says PLAN_TOO_LARGE before the gate when the time for reading is over', async () => {
    const h = harness(await enablerFiles({ tree: true }), {
      deps: { planBudgetMs: -1 },
    });
    expect(await runTransfer(h.deps, request('dry_run'))).toMatchObject({
      status: 422,
      code: 'PLAN_TOO_LARGE',
    });
    expect(h.timeline.events).not.toContain('store.beginApplying');
  });

  it('says STALE_DECISIONS when the decisions change before the gate, RUN_STATE when someone else started', async () => {
    const stale = harness(await enablerFiles({ tree: true }));
    stale.store.beforeGate = state => {
      stale.store.state = {
        ...state,
        decisionsVersion: state.decisionsVersion + 1,
      };
    };
    expect(await runTransfer(stale.deps, request('dry_run'))).toMatchObject({
      status: 409,
      code: 'STALE_DECISIONS',
    });
    const taken = harness(await enablerFiles({ tree: true }));
    taken.store.beforeGate = state => {
      taken.store.state = { ...state, status: 'applying' };
    };
    expect(await runTransfer(taken.deps, request('dry_run'))).toMatchObject({
      status: 409,
      code: 'RUN_STATE',
    });
  });

  it('uses the version of the decisions it read before it built the plan', async () => {
    const h = harness(await enablerFiles({ tree: true }), {
      run: { decisionsVersion: 7 },
    });
    await runTransfer(h.deps, request('dry_run'));
    expect(h.store.gateCalls[0].version).toBe(7);
    expect(h.store.attempts[0].decisionsVersion).toBe(7);
  });
});

describe('readConnectionFacts', () => {
  it('reads the facts of the connection with one statement', async () => {
    const statements: string[] = [];
    const facts = await readConnectionFacts(
      {
        async query(text) {
          statements.push(text);
          return {
            rows: [
              {
                current_schema: 'public_preview',
                current_role: 'app_preview',
                session_role: 'app_preview',
                resolved_schema: 'public_preview',
                has_preview_markers: true,
              },
            ],
          };
        },
      },
      'h.example'
    );
    expect(statements).toHaveLength(1);
    expect(facts).toEqual({
      host: 'h.example',
      currentSchema: 'public_preview',
      resolvedSchema: 'public_preview',
      currentUser: 'app_preview',
      sessionUser: 'app_preview',
      hasPreviewMarkers: true,
    });
    const empty = await readConnectionFacts(
      { query: async () => ({ rows: [] }) },
      null
    );
    expect(empty).toMatchObject({
      currentSchema: null,
      hasPreviewMarkers: false,
    });
  });
});

describe('runTransfer: a file with a solution marker in an enabler text', () => {
  it('keeps the plan as the planner builds it (the guard of the engine decides)', async () => {
    const files = [
      fixtureFile(
        await docx([
          ...enablerBlocks({ code: '4a' }),
          b('Musterlösung'),
          t('Etwas'),
        ]),
        {
          rel: undefined,
          name: '4a.docx',
          docType: 'enabler',
          componentCode: 'K4',
          enablerCode: 'K4-a',
        }
      ),
    ];
    const h = harness(files, {
      components: [
        {
          code: 'K4',
          title: 'Vier',
          reference: null,
          kind: 'pflicht',
          phase: 1,
        },
      ],
    });
    const result = await runTransfer(h.deps, request('dry_run'));
    // the planner keeps such a text out of the plan, and the report says so
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.skipped.map(s => s.code)).toContain('SOLUTION_MARKER');
    expect(result.data.tables.enablers?.insert ?? 0).toBe(0);
    expect(JSON.stringify(result.data)).not.toContain('Musterl');
  });
});
