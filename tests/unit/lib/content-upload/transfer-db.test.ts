/**
 * @jest-environment node
 */
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';

import {
  DEPENDENTS,
  DELETE_ORDER,
  rollbackAnswer,
} from '@/lib/content-upload/transfer/rollback';
import { compareStock } from '@/lib/content-upload/transfer/compare';
import {
  runTransfer,
  type TransferDeps,
} from '@/lib/content-upload/transfer/run';
import {
  PgTransferStore,
  queryableOfPool,
  type TransferStore,
} from '@/lib/content-upload/transfer/store';

import {
  CONTENT_TABLES,
  SCHEMA,
  USER,
  connect,
  counts,
  reset,
  seedRun,
  snapshot,
  transferDeps,
  type SeededRun,
  type Sql,
} from '../../../helpers/transferDb';
import { MemoryBucket } from '../../../helpers/memoryTransfer';
import {
  docx,
  enablerFiles,
  fixtureFile,
  type FixtureFile,
} from '../../../helpers/transferFixtures';
import { pdfBytes, quizBlocks } from '../../../helpers/uploadFixtures';

// The transfer against a REAL, LOCAL, throwaway PostgreSQL (the schema of the
// migrations up to 20261030000100). Only runs when CONTENT_UPLOAD_TEST_DB names
// such a database, for example
//
//   CONTENT_UPLOAD_TEST_DB=postgresql://postgres:pw@127.0.0.1:54347/u7_t
//
// It refuses every host but the own machine and empties the content tables first.

const url = process.env.CONTENT_UPLOAD_TEST_DB;
// The role of the app. Without a second address the same connection is used. In the Preview
// shape it is the role app_preview, and the first one an owner that seeds and compares.
const appUrl = process.env.CONTENT_UPLOAD_TEST_APP_URL ?? url;

if (!url) {
  describe.skip('transfer on PostgreSQL (set CONTENT_UPLOAD_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  const sql: Sql = connect(url);
  const app: Sql = appUrl === url ? sql : connect(appUrl as string);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
    if (app !== sql) await app.end({ timeout: 5 });
  });
  beforeEach(async () => {
    await reset(sql);
  });

  const request = (
    runId: string,
    mode: 'dry_run' | 'apply',
    extra: Record<string, unknown> = {}
  ) => ({
    runId,
    callerId: USER,
    mode,
    replaceFiles: [] as string[],
    publishOriginals: [] as string[],
    ...(mode === 'apply' ? { confirm: 'KFBM' } : {}),
    ...extra,
  });

  const runRow = async (runId: string) =>
    (
      await sql`select status, last_dry_run_hash, purge_after, finished_at, decisions_version from content_upload_runs where id = ${runId}`
    )[0];

  /** Runs a SQL text on one connection; after an error the transaction is ended. */
  async function execSql(text: string) {
    const connection = await sql.reserve();
    try {
      await connection.unsafe(text);
      return { ok: true as const };
    } catch (error) {
      await connection.unsafe('rollback').catch(() => undefined);
      return { ok: false as const, message: String((error as Error).message) };
    } finally {
      connection.release();
    }
  }

  const asCommit = (text: string) =>
    text.replace(/^rollback; -- probe.*$/m, 'commit;');

  /** A transfer store that lets a test step in at one place. */
  function wrapStore(
    base: TransferStore,
    overrides: Partial<TransferStore>
  ): TransferStore {
    return {
      getRunState: id => base.getRunState(id),
      releaseStale: (id, m) => base.releaseStale(id, m),
      loadFiles: (id, o) => base.loadFiles(id, o),
      saveStock: (id, e) => base.saveStock(id, e),
      clearStock: id => base.clearStock(id),
      loadComponents: id => base.loadComponents(id),
      loadEnablers: id => base.loadEnablers(id),
      beginApplying: (id, o) => base.beginApplying(id, o),
      endApplying: (id, h) => base.endApplying(id, h),
      recordAttempt: r => base.recordAttempt(r),
      protocol: tx => base.protocol(tx),
      ...overrides,
    };
  }

  describe('transfer on PostgreSQL', () => {
    it('a dry run writes nothing to the content and stores the hash of the plan', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const before = await snapshot(sql);
      const result = await runTransfer(
        transferDeps(app, seeded),
        request(seeded.runId, 'dry_run')
      );
      expect(JSON.stringify(result).slice(0, 300)).toContain('"ok":true');
      if (!result.ok) return;
      expect(result.data.status).toBe('ok');
      expect(result.data.readyToApply).toBe(true);
      expect(result.data.tables.enablers.insert).toBe(1);
      expect(result.data.tables.use_cases.insert).toBe(1);
      expect(result.data.wrote).toBe(false);
      expect(await snapshot(sql)).toEqual(before);
      const run = await runRow(seeded.runId);
      expect(run.status).toBe('review');
      expect(run.last_dry_run_hash).toBe(result.data.decisionsHash);
      const applies =
        await sql`select mode, status, target_schema from content_upload_applies where run_id = ${seeded.runId}`;
      expect(applies.map(a => [a.mode, a.status, a.target_schema])).toEqual([
        ['dry_run', 'ok', SCHEMA],
      ]);
      const rows =
        await sql`select count(*)::int as n from content_upload_applied_rows`;
      expect(rows[0].n).toBe(0);
    });

    it('an apply needs the dry run of exactly this plan', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      const early = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(early).toMatchObject({
        ok: false,
        status: 409,
        code: 'DRY_RUN_REQUIRED',
      });
      expect((await counts(sql)).enablers).toBe(0);
      expect((await runRow(seeded.runId)).status).toBe('review');
    });

    it('the apply needs the catalog code typed, and changes nothing without it', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      for (const confirm of [undefined, '', 'kfbm', 'FIAE']) {
        const result = await runTransfer(
          deps,
          request(seeded.runId, 'apply', { confirm })
        );
        expect(result).toMatchObject({
          ok: false,
          status: 400,
          code: 'CONFIRM_REQUIRED',
        });
      }
      const run = await runRow(seeded.runId);
      expect(run.status).toBe('review');
      expect(run.last_dry_run_hash).not.toBeNull();
      expect((await counts(sql)).enablers).toBe(0);
    });

    it('applies in one transaction with the protocol, everything inactive', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      expect(
        (await runTransfer(deps, request(seeded.runId, 'dry_run'))).ok
      ).toBe(true);
      const applied = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.data).toMatchObject({ status: 'ok', wrote: true });
      const c = await counts(sql);
      expect(c).toMatchObject({
        training_components: 1,
        courses: 1,
        enablers: 1,
        quizzes: 1,
        questions: 5,
        options: 20,
        enabler_quiz_links: 1,
        use_cases: 1,
      });
      // content_documents: the scenario situation and the use case topics, no solution rows
      expect(c.content_documents).toBe(2);
      const active = await sql`
        select (select count(*) from courses where is_active or is_published)::int
             + (select count(*) from enablers where is_active)::int
             + (select count(*) from quizzes where is_active)::int
             + (select count(*) from use_cases where is_active)::int as active`;
      expect(active[0].active).toBe(0);
      const solutions =
        await sql`select count(*)::int as n from content_documents where document_type = 'TRAINER_SOLUTION'`;
      expect(solutions[0].n).toBe(0);

      // the protocol: one row per row written, committed together with the content
      const total = Object.values(c).reduce((a, b) => a + b, 0);
      const protocol =
        await sql`select count(*)::int as n, count(*) filter (where action = 'insert')::int as inserts from content_upload_applied_rows`;
      expect(protocol[0]).toEqual({ n: total, inserts: total });
      const attributed =
        await sql`select count(*)::int as n from content_upload_applied_rows where file_id is not null`;
      expect(attributed[0].n).toBeGreaterThan(total - 4);
      const apply = (
        await sql`select status, update_existing, decisions_version from content_upload_applies where mode = 'apply'`
      )[0];
      expect(apply).toMatchObject({
        status: 'ok',
        update_existing: false,
        decisions_version: 1,
      });
      const files =
        await sql`select status from content_upload_files where run_id = ${seeded.runId}`;
      expect(files.every(f => f.status === 'applied')).toBe(true);
      const run = await runRow(seeded.runId);
      expect(run.status).toBe('applied');
      expect(run.last_dry_run_hash).toBeNull();
      // the staging files go 30 days after the apply
      const days =
        (new Date(run.purge_after).getTime() - Date.now()) / 86400000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    });

    it('is idempotent: a second apply of the same files writes nothing', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      await runTransfer(deps, request(seeded.runId, 'apply'));
      const state = await snapshot(sql);
      const rowsBefore = (
        await sql`select count(*)::int as n from content_upload_applied_rows`
      )[0].n;

      // the owner takes the run back to review for another round
      await sql`update content_upload_runs set status = 'review' where id = ${seeded.runId}`;
      const dry = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(dry.ok && dry.data.tables).toBeTruthy();
      if (!dry.ok) return;
      for (const table of Object.values(dry.data.tables)) {
        expect(table.insert).toBe(0);
        expect(table.update).toBe(0);
      }
      const again = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(again.ok).toBe(true);
      expect(await snapshot(sql)).toEqual(state);
      // the second apply has an entry of its own and no rows
      const applies =
        await sql`select mode, status from content_upload_applies where mode = 'apply' order by started_at`;
      expect(applies).toHaveLength(2);
      const rowsAfter = (
        await sql`select count(*)::int as n from content_upload_applied_rows`
      )[0].n;
      expect(rowsAfter).toBe(rowsBefore);
    });

    it('two applies at the same time: exactly one passes the gate', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      const dry = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      const [one, two] = await Promise.all([
        runTransfer(deps, request(seeded.runId, 'apply')),
        runTransfer(deps, request(seeded.runId, 'apply')),
      ]);
      const passed = [one, two].filter(r => r.ok);
      const refused = [one, two].filter(r => !r.ok);
      expect(passed).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toMatchObject({ ok: false, status: 409 });
      expect((await counts(sql)).enablers).toBe(1);
      const applies =
        await sql`select count(*)::int as n from content_upload_applies where mode = 'apply' and status = 'ok'`;
      expect(applies[0].n).toBe(1);
    });

    it('the gate is one statement: of many callers with the right hash only one passes', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const store = new PgTransferStore(queryableOfPool(app as any));
      await sql`update content_upload_runs set last_dry_run_hash = 'h1' where id = ${seeded.runId}`;
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.beginApplying(seeded.runId, { version: 1, requireHash: 'h1' })
        )
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await runRow(seeded.runId)).status).toBe('applying');
      // a wrong hash or a changed version never passes
      await sql`update content_upload_runs set status = 'review' where id = ${seeded.runId}`;
      expect(
        await store.beginApplying(seeded.runId, {
          version: 1,
          requireHash: 'h2',
        })
      ).toBe(false);
      expect(
        await store.beginApplying(seeded.runId, {
          version: 2,
          requireHash: 'h1',
        })
      ).toBe(false);
      await sql`update content_upload_runs set last_dry_run_hash = null where id = ${seeded.runId}`;
      expect(
        await store.beginApplying(seeded.runId, {
          version: 1,
          requireHash: 'h1',
        })
      ).toBe(false);
    });

    it('a decision that changes after the dry run (hash cleared) closes the gate', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      // what the review list does with every change of a decision
      await sql`update content_upload_runs set decisions_version = decisions_version + 1, last_dry_run_hash = null where id = ${seeded.runId}`;
      const result = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        code: 'DRY_RUN_REQUIRED',
      });
      expect((await counts(sql)).enablers).toBe(0);
    });

    it('decisions that change while the plan is built end in STALE_DECISIONS', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const base = new PgTransferStore(queryableOfPool(app as any));
      const store = wrapStore(base, {
        beginApplying: async (id, options) => {
          await sql`update content_upload_runs set decisions_version = decisions_version + 1 where id = ${id}`;
          return base.beginApplying(id, options);
        },
      });
      const result = await runTransfer(
        transferDeps(app, seeded, { store }),
        request(seeded.runId, 'dry_run')
      );
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        code: 'STALE_DECISIONS',
      });
      expect((await runRow(seeded.runId)).status).toBe('review');
    });

    it('conflicts are found by the dry run, before the first write', async () => {
      const files = await enablerFiles({ tree: true });
      const seeded = await seedRun(sql, files);
      const deps = transferDeps(app, seeded);
      // a quiz of the same code with fewer questions AND another text of one of them: the
      // missing question is no extension any more (the existing ones are no subset)
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      await runTransfer(deps, request(seeded.runId, 'apply'));
      await sql`delete from questions where order_index = 5`;
      await sql`update questions set question_text = 'Ein ganz anderer Text' where order_index = 2`;
      await sql`update content_upload_runs set status = 'review' where id = ${seeded.runId}`;
      const before = await snapshot(sql);
      const dry = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect(dry.data.status).toBe('conflict');
      expect(dry.data.readyToApply).toBe(false);
      expect(dry.data.conflicts.map(c => c.table)).toContain('quizzes');
      expect(await snapshot(sql)).toEqual(before);
      const run = await runRow(seeded.runId);
      expect(run.status).toBe('review');
      expect(run.last_dry_run_hash).toBeNull();
      const attempt =
        await sql`select status, jsonb_array_length(conflicts)::int as n from content_upload_applies where mode = 'dry_run' order by started_at desc limit 1`;
      expect(attempt[0].status).toBe('conflict');
      expect(attempt[0].n).toBeGreaterThan(0);
      // and no apply without a new dry run
      const apply = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(apply).toMatchObject({ ok: false, code: 'DRY_RUN_REQUIRED' });
    });

    it('content and use cases are ONE transaction: a conflict of the use case engine takes the content back', async () => {
      const first = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps1 = transferDeps(app, first);
      await runTransfer(deps1, request(first.runId, 'dry_run'));
      await runTransfer(deps1, request(first.runId, 'apply'));
      const state = await snapshot(sql);

      // The enabler K4-a gets another use case behind the back of the second run
      const second = await seedRun(sql, [
        ...(await enablerFiles({ tree: true, code: 'b' })),
        ...(await enablerFiles({ tree: true, code: 'a' })).filter(
          f => f.file.decision.docType === 'use_case'
        ),
      ]);
      const deps2 = transferDeps(app, second);
      const dry = await runTransfer(deps2, request(second.runId, 'dry_run'));
      expect(dry.ok && dry.data.status).toBe('ok');
      await sql`update use_cases set code = 'K4-zz' where code = 'K4-a'`;
      const stateBefore = await snapshot(sql);
      expect(stateBefore).not.toEqual(state);

      const applied = await runTransfer(deps2, request(second.runId, 'apply'));
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.data.status).toBe('conflict');
      expect(applied.data.wrote).toBe(false);
      // the enabler and the quiz of the content engine are not there
      expect(await snapshot(sql)).toEqual(stateBefore);
      expect((await counts(sql)).enablers).toBe(1);
      const run = await runRow(second.runId);
      expect(run.status).toBe('review');
      expect(run.last_dry_run_hash).toBeNull();
      const attempt =
        await sql`select status from content_upload_applies where run_id = ${second.runId} and mode = 'apply'`;
      expect(attempt.map(a => a.status)).toEqual(['conflict']);
      const rows =
        await sql`select count(*)::int as n from content_upload_applied_rows r join content_upload_applies a on a.id = r.apply_id where a.run_id = ${second.runId}`;
      expect(rows[0].n).toBe(0);
    });

    it('a failure while the protocol is written takes everything back', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const base = new PgTransferStore(queryableOfPool(app as any));
      const store = wrapStore(base, {
        protocol: tx => {
          const real = base.protocol(tx);
          return {
            insertApply: record => real.insertApply(record),
            insertAppliedRows: async () => {
              throw new Error('protocol broke');
            },
            markFilesApplied: (r, f) => real.markFilesApplied(r, f),
            finishRunApplied: (r, d) => real.finishRunApplied(r, d),
          };
        },
      });
      const deps = transferDeps(app, seeded, { store });
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      await expect(
        runTransfer(deps, request(seeded.runId, 'apply'))
      ).rejects.toThrow('protocol broke');
      expect(await counts(sql)).toEqual(
        Object.fromEntries(CONTENT_TABLES.map(t => [t, 0]))
      );
      const run = await runRow(seeded.runId);
      expect(run.status).toBe('review');
      expect(run.last_dry_run_hash).toBeNull();
      const applies =
        await sql`select mode, status, counts from content_upload_applies where run_id = ${seeded.runId} and mode = 'apply'`;
      expect(applies.map(a => a.status)).toEqual(['failed']);
      expect(JSON.stringify(applies[0].counts)).not.toContain('protocol broke');
      const rows =
        await sql`select count(*)::int as n from content_upload_applied_rows`;
      expect(rows[0].n).toBe(0);
    });

    it('refuses a connection that does not fit the target (a hosted host on the schema public)', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const good = transferDeps(app, seeded);
      await runTransfer(good, request(seeded.runId, 'dry_run'));
      // a hosted host on the schema public, or the own machine on the Preview schema
      const wrongHost =
        SCHEMA === 'public' ? 'db.example.supabase.co' : '127.0.0.1';
      const bad = transferDeps(app, seeded, { host: wrongHost });
      const result = await runTransfer(bad, request(seeded.runId, 'apply'));
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        code: 'TARGET_REFUSED',
      });
      if (!result.ok) expect(result.error).not.toContain('example');
      expect((await counts(sql)).enablers).toBe(0);
      expect((await runRow(seeded.runId)).status).toBe('review');
      const dry = await runTransfer(bad, request(seeded.runId, 'dry_run'));
      expect(dry).toMatchObject({ ok: false, code: 'TARGET_REFUSED' });
      // and a host that cannot be read is refused as well
      const none = await runTransfer(
        transferDeps(app, seeded, { host: null }),
        request(seeded.runId, 'dry_run')
      );
      expect(none).toMatchObject({ ok: false, code: 'TARGET_REFUSED' });
    });

    it('another import holding the lock ends in IMPORT_LOCKED, the dry run stays valid', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      const dry = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(dry.ok).toBe(true);
      const holder = await sql.reserve();
      await holder.unsafe(
        "select pg_advisory_lock(hashtext('kfbm-content-import'))"
      );
      try {
        const locked = await runTransfer(deps, request(seeded.runId, 'apply'));
        expect(locked).toMatchObject({
          ok: false,
          status: 409,
          code: 'IMPORT_LOCKED',
        });
      } finally {
        await holder.unsafe(
          "select pg_advisory_unlock(hashtext('kfbm-content-import'))"
        );
        holder.release();
      }
      const run = await runRow(seeded.runId);
      expect(run.status).toBe('review');
      expect(run.last_dry_run_hash).not.toBeNull();
      expect((await counts(sql)).enablers).toBe(0);
      // the same apply goes through now
      const done = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(done.ok && done.data.status).toBe('ok');
    });

    it('gives a run back that has been applying for too long, and not a fresh one', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await sql`update content_upload_runs set status = 'applying', updated_at = now() where id = ${seeded.runId}`;
      expect(
        await runTransfer(deps, request(seeded.runId, 'dry_run'))
      ).toMatchObject({
        ok: false,
        status: 409,
        code: 'RUN_STATE',
      });
      await sql`update content_upload_runs set updated_at = now() - interval '16 minutes' where id = ${seeded.runId}`;
      const result = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(result.ok && result.data.status).toBe('ok');
    });

    it('refuses a run that is not in review, a run of another catalog and an empty run', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }), {
        status: 'processing',
      });
      const deps = transferDeps(app, seeded);
      expect(
        await runTransfer(deps, request(seeded.runId, 'dry_run'))
      ).toMatchObject({
        status: 409,
        code: 'RUN_STATE',
      });
      expect(
        await runTransfer(
          deps,
          request('99999999-0000-4000-8000-000000000000', 'dry_run')
        )
      ).toMatchObject({ status: 404 });

      const none = await seedRun(sql, [
        ...(await enablerFiles({ tree: true })).map(f => ({
          ...f,
          file: {
            ...f.file,
            decision: { ...f.file.decision, action: 'reject' as const },
          },
        })),
      ]);
      expect(
        await runTransfer(
          transferDeps(app, none),
          request(none.runId, 'dry_run')
        )
      ).toMatchObject({ status: 409, code: 'NOTHING_TO_TRANSFER' });
      expect((await runRow(none.runId)).status).toBe('review');
    });

    it('a plan that cannot be built in time never reaches the gate', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const result = await runTransfer(
        transferDeps(app, seeded, { planBudgetMs: -1 }),
        request(seeded.runId, 'dry_run')
      );
      expect(result).toMatchObject({
        ok: false,
        status: 422,
        code: 'PLAN_TOO_LARGE',
      });
      expect((await runRow(seeded.runId)).status).toBe('review');
    });
  });

  describe('update existing rows, and the rollback as SQL', () => {
    /** Applies the files of K4-a, then changes the enabler title behind the back of the run. */
    async function appliedWithDrift() {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      const first = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(first.ok).toBe(true);
      await sql`update enablers set title = 'Ein alter Titel mit ''Anführungszeichen'' und $$ Dollar' where code = 'K4-a'`;
      await sql`update content_upload_runs set status = 'review' where id = ${seeded.runId}`;
      return { seeded, deps };
    }

    /** The file of the enabler text of K4-a: its row is the one that drifts. */
    const enablerFileOf = (seeded: { files: Array<{ file: { id: string; decision: { docType: string | null } } }> }) =>
      seeded.files.find(f => f.file.decision.docType === 'enabler')!.file.id;

    it('the choice of files is per apply: the dry run and the apply must use the same one', async () => {
      const { seeded, deps } = await appliedWithDrift();
      const dry = await runTransfer(
        deps,
        request(seeded.runId, 'dry_run', {
          replaceFiles: [enablerFileOf(seeded)],
        })
      );
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect(dry.data.replaceFiles).toEqual([enablerFileOf(seeded)]);
      expect(
        dry.data.stock.files.find(f => f.fileId === enablerFileOf(seeded))
          ?.status
      ).toBe('differs');
      expect(dry.data.tables.enablers.update).toBe(1);
      expect(dry.data.differences).toContainEqual(
        expect.objectContaining({ table: 'enablers', columns: ['title'] })
      );
      // a dry run with the switch does not open the gate for an apply without it
      const without = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(without).toMatchObject({ ok: false, code: 'DRY_RUN_REQUIRED' });
      const applied = await runTransfer(
        deps,
        request(seeded.runId, 'apply', {
          replaceFiles: [enablerFileOf(seeded)],
        })
      );
      expect(applied.ok && applied.data.status).toBe('ok');
      const title = await sql`select title from enablers where code = 'K4-a'`;
      expect(title[0].title).not.toContain('alter Titel');
      const rows =
        await sql`select action, before from content_upload_applied_rows r join content_upload_applies a on a.id = r.apply_id where a.update_existing and r.action = 'update'`;
      expect(rows).toHaveLength(1);
      expect(rows[0].before).toEqual({
        title: "Ein alter Titel mit 'Anführungszeichen' und $$ Dollar",
      });
      const apply =
        await sql`select update_existing from content_upload_applies where mode = 'apply' order by started_at desc limit 1`;
      expect(apply[0].update_existing).toBe(true);
    });

    it('without the switch an existing row stays as it is and is only reported', async () => {
      const { seeded, deps } = await appliedWithDrift();
      const before = await snapshot(sql);
      const dry = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(dry.ok && dry.data.differences.length).toBeGreaterThan(0);
      const applied = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(applied.ok).toBe(true);
      expect(await snapshot(sql)).toEqual(before);
    });

    it('the rollback text deletes what the apply inserted and restores what it updated', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      const empty = await snapshot(sql);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect((await runTransfer(deps, request(seeded.runId, 'apply'))).ok).toBe(
        true
      );
      const afterApply = await snapshot(sql);
      expect(afterApply).not.toEqual(empty);

      const answer = await rollbackAnswer(queryableOfPool(app as any), {
        runId: seeded.runId,
      });
      expect(answer?.blockers).toEqual([]);
      expect(answer?.sql).toContain(
        "pg_advisory_xact_lock(hashtext('kfbm-content-import'))"
      );
      expect(answer?.sql).toMatch(/rollback; -- probe/);
      const text = answer?.sql as string;

      // as a probe: it runs without an error and leaves everything as it is
      expect((await execSql(text)).ok).toBe(true);
      expect(await snapshot(sql)).toEqual(afterApply);
      // with commit: the state of before the apply, and the apply is marked
      expect((await execSql(asCommit(text))).ok).toBe(true);
      expect(await snapshot(sql)).toEqual(empty);
      const marked =
        await sql`select counts ->> 'rolledBack' as rolled from content_upload_applies where mode = 'apply'`;
      expect(marked[0].rolled).toBe('true');
      // the protocol stays as proof
      const rows =
        await sql`select count(*)::int as n from content_upload_applied_rows`;
      expect(rows[0].n).toBeGreaterThan(0);
      // the same apply cannot be rolled back twice
      const second = await rollbackAnswer(queryableOfPool(app as any), {
        runId: seeded.runId,
        applyId: String(answer?.applyId),
      });
      expect(second?.sql).toBeNull();
      expect(second?.blockers.map(b => b.code)).toEqual([
        'ALREADY_ROLLED_BACK',
      ]);
      expect((await execSql(asCommit(text))).ok).toBe(false);
    });

    it('rolls back updates to the values from before, and a later apply blocks the earlier rollback until it is rolled back', async () => {
      const { seeded, deps } = await appliedWithDrift();
      const drifted = await snapshot(sql);
      await runTransfer(
        deps,
        request(seeded.runId, 'dry_run', {
          replaceFiles: [enablerFileOf(seeded)],
        })
      );
      await runTransfer(
        deps,
        request(seeded.runId, 'apply', {
          replaceFiles: [enablerFileOf(seeded)],
        })
      );
      expect(await snapshot(sql)).not.toEqual(drifted);

      const [first, second] =
        await sql`select id, started_at from content_upload_applies where mode = 'apply' order by started_at`;
      const q = queryableOfPool(app as any);
      // the earlier apply touched the same rows: blocked
      const early = await rollbackAnswer(q, {
        runId: seeded.runId,
        applyId: String(first.id),
      });
      expect(early?.sql).toBeNull();
      expect(early?.blockers.map(b => b.code)).toContain('LATER_APPLY');
      // the newest one can be rolled back, and then the older one is free
      const late = await rollbackAnswer(q, { runId: seeded.runId });
      expect(late?.applyId).toBe(String(second.id));
      expect(late?.restores).toEqual({ enablers: 1 });
      expect(late?.deletes).toEqual({});
      expect((await execSql(asCommit(late?.sql as string))).ok).toBe(true);
      expect(await snapshot(sql)).toEqual(drifted);
      const free = await rollbackAnswer(q, { runId: seeded.runId });
      expect(free?.applyId).toBe(String(first.id));
      expect(free?.sql).not.toBeNull();
    });

    it('stops itself when the database holds something else than the protocol lists', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      await runTransfer(deps, request(seeded.runId, 'apply'));
      const answer = await rollbackAnswer(queryableOfPool(app as any), {
        runId: seeded.runId,
      });
      const text = answer?.sql as string;
      await sql`delete from enabler_quiz_links`;
      const state = await snapshot(sql);
      const result = await execSql(asCommit(text));
      expect(result.ok).toBe(false);
      expect(result.ok ? '' : result.message).toMatch(
        /enabler_quiz_links|expected/
      );
      // the transaction ended: nothing of the text is kept
      expect(await snapshot(sql)).toEqual(state);
      const marked =
        await sql`select counts ->> 'rolledBack' as rolled from content_upload_applies where mode = 'apply'`;
      expect(marked[0].rolled).toBeNull();
    });

    it('the text checks again when it RUNS: a row added later, learner data or an activation stop it', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      await runTransfer(deps, request(seeded.runId, 'apply'));
      const answer = await rollbackAnswer(queryableOfPool(app as any), {
        runId: seeded.runId,
      });
      const text = asCommit(answer?.sql as string);
      const state = await snapshot(sql);

      // a trainer adds a document to the enabler after the text was made
      const [enabler] = await sql`select id from enablers limit 1`;
      await sql`insert into content_documents (enabler_id, title, file_name, storage_url, document_type, visibility)
                values (${enabler.id}, 'Spaeter', 'x.pdf', 'x', 'THEORY', 'ALL')`;
      const added = await execSql(text);
      expect(added.ok).toBe(false);
      expect(added.ok ? '' : added.message).toContain(
        'rows of content_documents hang on rows of this apply'
      );
      await sql`delete from content_documents where title = 'Spaeter'`;
      expect(await snapshot(sql)).toEqual(state);

      // a quiz is activated after the text was made
      await sql`update quizzes set is_active = true`;
      const active = await execSql(text);
      expect(active.ok).toBe(false);
      expect(active.ok ? '' : active.message).toContain('is_active now');
      await sql`update quizzes set is_active = false`;

      // learner data on a quiz
      const [quiz] = await sql`select id from quizzes limit 1`;
      const [org] =
        await sql`select organization_id from profiles where id = ${USER}`;
      await sql`insert into quiz_submissions (trainee_id, quiz_id, organization_id) values (${USER}, ${quiz.id}, ${org.organization_id})`;
      const learner = await execSql(text);
      expect(learner.ok).toBe(false);
      expect(learner.ok ? '' : learner.message).toContain('quiz_submissions');
      await sql`delete from quiz_submissions`;
      expect(await snapshot(sql)).toEqual(state);
      // without any of them it runs
      expect((await execSql(text)).ok).toBe(true);
    });

    it('gives a reason and no text for active content and for data of learners', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      const deps = transferDeps(app, seeded);
      await runTransfer(deps, request(seeded.runId, 'dry_run'));
      await runTransfer(deps, request(seeded.runId, 'apply'));
      const q = queryableOfPool(app as any);

      await sql`update quizzes set is_active = true`;
      const active = await rollbackAnswer(q, { runId: seeded.runId });
      expect(active?.sql).toBeNull();
      expect(active?.blockers.map(b => b.code)).toEqual(['ACTIVATED_CONTENT']);
      expect(active?.blockers[0].detail).toEqual({ 'quizzes.is_active': 1 });
      await sql`update quizzes set is_active = false`;

      const [quiz] = await sql`select id from quizzes limit 1`;
      const [org] =
        await sql`select organization_id from profiles where id = ${USER}`;
      await sql`insert into quiz_submissions (trainee_id, quiz_id, organization_id) values (${USER}, ${quiz.id}, ${org.organization_id})`;
      const data = await rollbackAnswer(q, { runId: seeded.runId });
      expect(data?.sql).toBeNull();
      expect(data?.blockers.map(b => b.code)).toEqual(['DEPENDENT_DATA']);
      expect(data?.blockers[0].detail).toEqual({
        'quiz_submissions.quiz_id': 1,
      });
      expect(JSON.stringify(data)).not.toMatch(/delete from/);
    });

    it('there is nothing to roll back before an apply, and a dry run is no apply', async () => {
      const seeded = await seedRun(sql, await enablerFiles({ tree: true }));
      await runTransfer(
        transferDeps(app, seeded),
        request(seeded.runId, 'dry_run')
      );
      expect(
        await rollbackAnswer(queryableOfPool(app as any), {
          runId: seeded.runId,
        })
      ).toBeNull();
    });
  });

  describe('originals of enabler texts', () => {
    async function withOriginal() {
      const files = await enablerFiles({ tree: true });
      const original = fixtureFile(
        new Uint8Array(
          pdfBytes({
            pages: [
              [
                'Ein erfundener Lehrtext ueber Netzwerke, der lang genug ist fuer den Leser.',
                'Eine zweite Zeile ueber Router und Switches im Lehrtext.',
              ],
            ],
          })
        ),
        {
          ext: 'pdf',
          name: '4a.pdf',
          docType: 'pdf_original',
          componentCode: 'K4',
          enablerCode: 'K4-a',
          dupKey: 'pdf:enabler:4a',
        }
      );
      const seeded = await seedRun(sql, [...files, original]);
      const bucket = new MemoryBucket();
      const deps = transferDeps(app, seeded, { contentBucket: () => bucket });
      return { seeded, bucket, deps, ids: [original.file.id] };
    }

    it('copies the original, writes its row with the data of the copy and names the file in the protocol', async () => {
      const { seeded, bucket, deps, ids } = await withOriginal();
      const dry = await runTransfer(
        deps,
        request(seeded.runId, 'dry_run', { publishOriginals: ids })
      );
      expect(dry.ok && dry.data.originals).toEqual({
        published: 1,
        refused: [],
      });
      expect(bucket.objects.size).toBe(0);
      expect((await counts(sql)).content_documents).toBe(0);
      const done = await runTransfer(
        deps,
        request(seeded.runId, 'apply', { publishOriginals: ids })
      );
      expect(done.ok && done.data.status).toBe('ok');
      expect(bucket.objects.size).toBe(1);
      const [path] = [...bucket.objects.keys()];
      const rows =
        await sql`select title, document_type, visibility, storage_path, file_size, mime_type, page_count, uploaded_by_id, use_case_id, enabler_id
                               from content_documents where document_type = 'THEORY' and storage_path is not null`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        title: 'Enabler K4-a: Lehrtext (Original PDF)',
        visibility: 'ALL',
        storage_path: path,
        mime_type: 'application/pdf',
        page_count: 1,
        uploaded_by_id: USER,
        use_case_id: null,
      });
      const protocol =
        await sql`select r.file_id from content_upload_applied_rows r join content_documents d on d.id = r.row_id where d.storage_path = ${path}`;
      expect(protocol[0].file_id).toBe(ids[0]);

      // the rollback names the copy, and the text takes the row away
      const answer = await rollbackAnswer(queryableOfPool(app as any), {
        runId: seeded.runId,
      });
      expect(answer?.objectPaths).toEqual([path]);
      expect(answer?.notes.join(' ')).toContain('document bucket');
      expect(answer?.sql).toContain(`bucket content: ${path}`);
      expect((await execSql(asCommit(answer?.sql as string))).ok).toBe(true);
      expect(await counts(sql)).toEqual(
        Object.fromEntries(CONTENT_TABLES.map(t => [t, 0]))
      );
    });

    it('takes the copy out of the bucket when the apply fails, and the row is not there', async () => {
      const { seeded, bucket, ids } = await withOriginal();
      const base = new PgTransferStore(queryableOfPool(app as any));
      const store = wrapStore(base, {
        protocol: tx => {
          const real = base.protocol(tx);
          return {
            insertApply: record => real.insertApply(record),
            insertAppliedRows: async () => {
              throw new Error('protocol broke');
            },
            markFilesApplied: (r, f) => real.markFilesApplied(r, f),
            finishRunApplied: (r, d) => real.finishRunApplied(r, d),
          };
        },
      });
      const deps = transferDeps(app, seeded, {
        store,
        contentBucket: () => bucket,
      });
      await runTransfer(
        deps,
        request(seeded.runId, 'dry_run', { publishOriginals: ids })
      );
      await expect(
        runTransfer(
          deps,
          request(seeded.runId, 'apply', { publishOriginals: ids })
        )
      ).rejects.toThrow('protocol broke');
      expect(bucket.objects.size).toBe(0);
      expect(bucket.removed).toHaveLength(1);
      expect((await counts(sql)).content_documents).toBe(0);
    });

    it('a file that is no enabler text never reaches the bucket', async () => {
      const files = await enablerFiles({ tree: true });
      const seeded = await seedRun(sql, files);
      const bucket = new MemoryBucket();
      const deps = transferDeps(app, seeded, { contentBucket: () => bucket });
      const quiz = files.find(f => f.file.decision.docType === 'quiz')!;
      const dry = await runTransfer(
        deps,
        request(seeded.runId, 'dry_run', { publishOriginals: [quiz.file.id] })
      );
      expect(dry.ok && dry.data.originals.refused[0]).toMatchObject({
        code: 'NOT_AN_ENABLER_TEXT',
      });
      await runTransfer(
        deps,
        request(seeded.runId, 'apply', { publishOriginals: [quiz.file.id] })
      );
      expect(bucket.objects.size).toBe(0);
    });
  });

  describe('the list of dependents', () => {
    it('names every table that has a foreign key to a table of the import, whatever the rule of the key', async () => {
      const fks = await sql`
        select cl.relname as child, a.attname as col, ref.relname as parent
          from pg_constraint c
          join pg_class cl on cl.oid = c.conrelid
          join pg_class ref on ref.oid = c.confrelid
          join pg_namespace n on n.oid = cl.relnamespace and n.nspname = current_schema()
          join lateral unnest(c.conkey) k(attnum) on true
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         where c.contype = 'f' and array_length(c.conkey, 1) = 1
           and ref.relname = any(${[...CONTENT_TABLES, 'training_catalog_learning_fields']})`;
      const known = new Set(
        DEPENDENTS.map(([p, child, col]) => `${p}|${child}|${col}`)
      );
      const missing = fks
        // the key to the catalog is no dependent row of an apply
        .filter(f => String(f.col) !== 'training_catalog_id')
        .filter(f => !known.has(`${f.parent}|${f.child}|${f.col}`))
        .map(f => `${f.parent}|${f.child}|${f.col}`);
      expect(missing).toEqual([]);
      // and every entry names a column that exists
      for (const [, child, col] of DEPENDENTS) {
        const found =
          await sql`select 1 from information_schema.columns where table_schema = current_schema() and table_name = ${child} and column_name = ${col}`;
        expect({ child, col, found: found.length }).toEqual({
          child,
          col,
          found: 1,
        });
      }
      // every table of the import is deleted somewhere in the order
      expect([...DELETE_ORDER]).toEqual(
        expect.arrayContaining([...CONTENT_TABLES])
      );
    });
  });

  describe('a supply of content (Nachschub)', () => {
    /** The files of K4 with a quiz that has this many questions (invented content). */
    async function setOf(letters: string[], questions: number) {
      const out: FixtureFile[] = [];
      for (const letter of letters) {
        for (const f of await enablerFiles({ tree: true, code: letter })) {
          if (f.file.decision.docType !== 'quiz') {
            out.push(f);
            continue;
          }
          out.push(
            fixtureFile(
              await docx(quizBlocks({ code: `4${letter}`, questions })),
              {
                rel: f.file.relPath,
                name: f.file.fileName,
                docType: 'quiz',
                componentCode: 'K4',
                enablerCode: `K4-${letter}`,
                quizLevel: 'low',
              }
            )
          );
        }
      }
      return out;
    }

    const apply = async (seeded: SeededRun, deps: TransferDeps) => {
      const dry = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(dry.ok).toBe(true);
      const done = await runTransfer(deps, request(seeded.runId, 'apply'));
      expect(done.ok && done.data.wrote).toBe(true);
      return { dry, done };
    };

    /** The same files again as a new run of the same catalog (the state of the database stays). */
    async function nextRun(files: FixtureFile[]) {
      const seeded = await seedRun(sql, files);
      return { seeded, deps: transferDeps(app, seeded) };
    }

    it('adds the missing questions of several quizzes, once, and a second run adds nothing', async () => {
      const letters = ['a', 'b', 'c'];
      const first = await nextRun(await setOf(letters, 3));
      await apply(first.seeded, first.deps);
      expect((await counts(sql)).questions).toBe(9);

      const full = await setOf(letters, 5);
      const second = await nextRun(full);
      const dry = await runTransfer(
        second.deps,
        request(second.seeded.runId, 'dry_run')
      );
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect(dry.data.status).toBe('ok');
      expect(dry.data.stock.counts).toMatchObject({ extended: 3 });
      expect(dry.data.extended.map(e => e.added)).toEqual([2, 2, 2]);
      const before = await snapshot(sql);
      const done = await runTransfer(
        second.deps,
        request(second.seeded.runId, 'apply')
      );
      expect(done.ok && done.data.wrote).toBe(true);
      const c = await counts(sql);
      expect(c.questions).toBe(15);
      expect(c.options).toBe(60);
      // only inserts: not a row of an earlier apply was changed or removed
      const written =
        await sql`select action, count(*)::int as n from content_upload_applied_rows r
                   join content_upload_applies a on a.id = r.apply_id
                  where a.run_id = ${second.seeded.runId} group by action`;
      expect(written.map(w => [w.action, w.n])).toEqual([['insert', 30]]);
      expect(before).not.toEqual(await snapshot(sql));

      // a third run, the same files: nothing to add, everything unchanged
      const third = await nextRun(await setOf(letters, 5));
      const dry3 = await runTransfer(
        third.deps,
        request(third.seeded.runId, 'dry_run')
      );
      expect(dry3.ok && dry3.data.stock.counts).toMatchObject({
        extended: 0,
        new: 0,
        differs: 0,
        unchanged: 3 + 9,
      });
      const stable = await snapshot(sql);
      const done3 = await runTransfer(
        third.deps,
        request(third.seeded.runId, 'apply')
      );
      expect(done3.ok && done3.data.wrote).toBe(true);
      expect(await snapshot(sql)).toEqual(stable);
      const none =
        await sql`select count(*)::int as n from content_upload_applied_rows r
                   join content_upload_applies a on a.id = r.apply_id where a.run_id = ${third.seeded.runId}`;
      expect(none[0].n).toBe(0);
    });

    it('takes a quiz alone, without the text of its enabler, and adds its missing questions', async () => {
      const first = await nextRun(await setOf(['a'], 3));
      await apply(first.seeded, first.deps);
      const quizOnly = (await setOf(['a'], 5)).filter(
        f => f.file.decision.docType === 'quiz'
      );
      const second = await nextRun(quizOnly);
      const { dry, done } = await apply(second.seeded, second.deps);
      expect(dry.ok && dry.data.stock.counts).toMatchObject({ extended: 1 });
      expect(dry.ok && dry.data.tables.enablers).toEqual({
        insert: 0,
        update: 0,
        unchanged: 1,
      });
      expect(done.ok && done.data.wrote).toBe(true);
      expect((await counts(sql)).questions).toBe(5);
      expect((await counts(sql)).enablers).toBe(1);
      const written =
        await sql`select table_name, action from content_upload_applied_rows r
                   join content_upload_applies a on a.id = r.apply_id
                  where a.run_id = ${second.seeded.runId} order by table_name`;
      expect([...new Set(written.map(w => `${w.table_name}:${w.action}`))]).toEqual([
        'options:insert',
        'questions:insert',
      ]);
    });

    it('adds a scenario that was missing and nothing else', async () => {
      const withoutScenario = (await enablerFiles({ tree: true })).filter(
        f => f.file.decision.docType !== 'scenario'
      );
      const first = await nextRun(withoutScenario);
      await apply(first.seeded, first.deps);
      const scenarioRows = async () =>
        (
          await sql`select count(*)::int as n from content_documents where document_type = 'TRAINEE_QUESTION'`
        )[0].n;
      expect(await scenarioRows()).toBe(0);
      const second = await nextRun(await enablerFiles({ tree: true }));
      const { dry, done } = await apply(second.seeded, second.deps);
      expect(dry.ok && dry.data.stock.counts).toMatchObject({
        new: 1,
        unchanged: 3,
      });
      expect(done.ok && done.data.tables.content_documents.insert).toBe(1);
      expect(await scenarioRows()).toBe(1);
      const docs =
        await sql`select document_type, visibility from content_documents where document_type <> 'THEORY'`;
      // only the part for trainees: the solution parts are never written
      expect(docs.map(d => [d.document_type, d.visibility])).toEqual([
        ['TRAINEE_QUESTION', 'ALL'],
      ]);
      const inserted =
        await sql`select table_name, action from content_upload_applied_rows r
                   join content_upload_applies a on a.id = r.apply_id
                  where a.run_id = ${second.seeded.runId}`;
      expect(inserted.map(r => [r.table_name, r.action])).toEqual([
        ['content_documents', 'insert'],
      ]);
    });

    it('compares before a decision: only reads, stores the status per file, keeps the run', async () => {
      const files = await enablerFiles({ tree: true });
      const seeded = await seedRun(sql, files);
      // no decision yet: the proposal counts (the comparison reads the current proposal)
      await sql`delete from content_upload_decisions where run_id = ${seeded.runId}`;
      for (const { file } of files) {
        const d = file.decision;
        await sql`insert into content_upload_proposals
          (file_id, source, doc_type, component_code, enabler_code, quiz_level, confidence, band, is_current)
          values (${file.id}, 'path', ${d.docType}, ${d.componentCode}, ${d.enablerCode}, ${d.quizLevel}, 0.9, 'high', true)`;
      }
      const deps = transferDeps(app, seeded);
      const before = await snapshot(sql);
      const result = await compareStock(deps, {
        runId: seeded.runId,
        callerId: USER,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toMatchObject({ compared: 4, stored: 4 });
      expect(result.data.stock.counts).toMatchObject({ new: 4 });
      expect(await snapshot(sql)).toEqual(before);
      expect((await runRow(seeded.runId)).status).toBe('review');
      const stored =
        await sql`select parse_summary -> 'stock' as stock from content_upload_files where run_id = ${seeded.runId}`;
      expect(stored).toHaveLength(4);
      for (const row of stored) {
        expect(row.stock).toMatchObject({ status: 'new', moved: 0 });
        expect(typeof row.stock.assign).toBe('string');
      }
      // nothing of a decision or an apply was written
      const applies =
        await sql`select count(*)::int as n from content_upload_applies where run_id = ${seeded.runId}`;
      expect(applies[0].n).toBe(0);
      const decisions =
        await sql`select count(*)::int as n from content_upload_decisions where run_id = ${seeded.runId}`;
      expect(decisions[0].n).toBe(0);
    });

    it('takes the stored status off after an apply, and stores none outside the state review', async () => {
      const files = await enablerFiles({ tree: true });
      const seeded = await seedRun(sql, files);
      const deps = transferDeps(app, seeded);
      const dry = await runTransfer(deps, request(seeded.runId, 'dry_run'));
      expect(dry.ok).toBe(true);
      const has = async () =>
        (
          await sql`select count(*)::int as n from content_upload_files
                     where run_id = ${seeded.runId} and parse_summary -> 'stock' is not null`
        )[0].n;
      // a dry run stores the status of the files it compared
      expect(await has()).toBe(4);
      expect((await runTransfer(deps, request(seeded.runId, 'apply'))).ok).toBe(
        true
      );
      expect(await has()).toBe(0);
      // the run is applied now: a late write of a status finds no state review
      const store = new PgTransferStore(queryableOfPool(app as any));
      expect(
        await store.saveStock(seeded.runId, [
          {
            fileId: files[0].file.id,
            stock: {
              status: 'new',
              added: 0,
              moved: 0,
              assign: 'x',
              at: new Date().toISOString(),
            },
          },
        ])
      ).toBe(0);
      expect(await has()).toBe(0);
      expect(await compareStock(deps, { runId: seeded.runId, callerId: USER })).toMatchObject({
        ok: false,
        code: 'RUN_STATE',
      });
    });

    it('names the file of a conflict and writes nothing', async () => {
      const files = await enablerFiles({ tree: true });
      const first = await nextRun(files);
      await apply(first.seeded, first.deps);
      await sql`update quizzes set quiz_type = 'GLOBAL' where code = 'K4-a-low'`;
      const second = await nextRun(await enablerFiles({ tree: true }));
      const before = await snapshot(sql);
      const dry = await runTransfer(
        second.deps,
        request(second.seeded.runId, 'dry_run')
      );
      expect(dry.ok).toBe(true);
      if (!dry.ok) return;
      expect(dry.data.status).toBe('conflict');
      expect(dry.data.stock.counts.conflict).toBe(1);
      expect(await snapshot(sql)).toEqual(before);
    });
  });

  // keep the type import used
  void (null as unknown as TransferDeps);
}
