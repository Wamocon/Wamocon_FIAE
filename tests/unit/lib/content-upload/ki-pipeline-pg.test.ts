/**
 * @jest-environment node
 */
// The whole model stage on the SQL repositories: a run goes through the real steps
// of the queue (read, rules, model) against a stand-in for Sokrates on localhost,
// with the files in an in-memory storage. It only runs when CONTENT_UPLOAD_TEST_DB
// names a LOCAL throwaway PostgreSQL (the schema of the migrations up to
// 20261030000100). Never a hosted database, never a real model.
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { PgKiRepo } from '@/lib/content-upload/ki/repo-pg';
import { KI_STATE_KEY } from '@/lib/content-upload/ki/steps';
import { resetCorpusCache } from '@/lib/content-upload/ki/corpus';
import { PgReviewRepo } from '@/lib/content-upload/review/repo-pg';
import {
  pumpReviewRun,
  reviewStepEnv,
} from '@/lib/content-upload/review/steps';
import { PgUploadRepo } from '@/lib/content-upload/staging/repo-pg';
import { createRun } from '@/lib/content-upload/staging/runs';
import { guardUploadStorage } from '@/lib/content-upload/staging/storage';
import {
  answers,
  localConfig,
  reply,
  startFakeSokrates,
  type FakeSokrates,
} from '../../../helpers/fakeSokrates';
import {
  GOOD_ANSWER,
  ambiguousQuiz,
  structureless,
} from '../../../helpers/kiFixtures';
import { MemoryUploadStorage } from '../../../helpers/memoryUploadStorage';
import { uploadFiles } from '../../../helpers/reviewFixtures';
import { SUPER } from '../../../helpers/uploadServiceFixtures';
import { CANARY_WORDS } from '../../../helpers/uploadFixtures';

const url = process.env.CONTENT_UPLOAD_TEST_DB;
const ADMIN = SUPER.id;

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'CONTENT_UPLOAD_TEST_DB must point at a database on this machine'
    );
  }
}

if (!url) {
  describe.skip('the model stage on PostgreSQL (set CONTENT_UPLOAD_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  assertLocal(url);
  const client = postgres(url, { max: 12, prepare: false, onnotice: () => {} });
  const db = drizzle(client);
  const upload = new PgUploadRepo(db as any);
  const review = new PgReviewRepo(db as any);
  const ki = new PgKiRepo(db as any);

  let fake: FakeSokrates;
  beforeEach(async () => {
    resetCorpusCache();
    fake = await startFakeSokrates(answers(() => GOOD_ANSWER));
  });
  afterEach(async () => {
    await fake.close();
  });
  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  const rows = async <T>(query: ReturnType<typeof sql>) =>
    (await db.execute(query)) as unknown as T[];

  async function seed() {
    await db.execute(sql`truncate content_upload_runs cascade`);
    await db.execute(
      sql`insert into auth.users (id, email) values (${ADMIN}::uuid, 'ki-e2e@example.test') on conflict (id) do nothing`
    );
    await db.execute(
      sql`insert into profiles (id, email, role) values (${ADMIN}::uuid, 'ki-e2e@example.test', 'ADMIN') on conflict (id) do nothing`
    );
    await db.execute(
      sql`insert into training_catalogs (code, title, is_active)
          values ('KFBM', 'KfBM', true) on conflict (code) do nothing`
    );
    const [catalog] = await rows<{ id: string }>(
      sql`select id from training_catalogs where code = 'KFBM'`
    );
    const cid = String(catalog.id);
    await db.execute(
      sql`delete from enablers where training_catalog_id = ${cid}::uuid`
    );
    await db.execute(
      sql`delete from courses where training_catalog_id = ${cid}::uuid`
    );
    await db.execute(
      sql`delete from training_components where training_catalog_id = ${cid}::uuid`
    );
    let order = 0;
    for (const [code, title] of [
      ['K1', 'Eins'],
      ['K6.1', 'Sechs Eins'],
      ['K6.2', 'Sechs Zwei'],
    ] as const) {
      order += 1;
      await db.execute(
        sql`insert into training_components
              (training_catalog_id, code, title, total_weeks, total_hours, phase, kind, order_index)
            values (${cid}::uuid, ${code}, ${title}, 1, 40, 1, 'pflicht', ${order})`
      );
      const [component] = await rows<{ id: string }>(
        sql`select id from training_components where training_catalog_id = ${cid}::uuid and code = ${code}`
      );
      await db.execute(
        sql`insert into courses (training_catalog_id, code, training_component_id, title, created_by_id)
            values (${cid}::uuid, ${code}, ${component.id}::uuid, ${title}, ${ADMIN}::uuid)`
      );
      const [course] = await rows<{ id: string }>(
        sql`select id from courses where training_catalog_id = ${cid}::uuid and code = ${code}`
      );
      await db.execute(
        sql`insert into enablers (course_id, training_catalog_id, code, title, order_index)
            values (${course.id}::uuid, ${cid}::uuid, ${code + '-a'}, ${code + '-a'}, 1)`
      );
    }
  }

  async function harness(files: Parameters<typeof uploadFiles>[2]) {
    await seed();
    const mem = new MemoryUploadStorage();
    const storage = guardUploadStorage(mem, 'public');
    const deps = { repo: upload, storage: () => storage };
    const reviewDeps = { ...deps, review, ki };
    const created = await createRun(deps, SUPER, {
      label: 'ki e2e',
      declarationAccepted: true,
      kiEnabled: true,
    });
    if (!created.ok) throw new Error(created.error);
    const ctx = { deps, repo: upload, mem } as any;
    const ids = await uploadFiles(ctx, created.data, files);
    const config = localConfig(fake);
    const env = () =>
      reviewStepEnv(reviewDeps, created.data.id, {
        config: () => ({ ok: true as const, config }),
        available: () => true,
        env: () => ({}),
      });
    const pump = (options: { concurrency?: number } = {}) =>
      pumpReviewRun(
        reviewDeps,
        created.data.id,
        { closeUpload: true, retryDelaySeconds: 0, ...options },
        env()
      );
    return { run: created.data, ids, pump, reviewDeps };
  }

  async function pumpUntilDone(h: Awaited<ReturnType<typeof harness>>) {
    for (let i = 0; i < 20; i += 1) {
      const result = await h.pump();
      if (result.done) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('The queue did not finish');
  }

  describe('the model stage on PostgreSQL', () => {
    it('takes an ambiguous file through the model to a proposal, logs it, and leaves the run in review', async () => {
      const h = await harness([await ambiguousQuiz()]);
      const done = await pumpUntilDone(h);
      expect(done.runStatus).toBe('review');
      const [file] = await rows<{
        status: string;
        parse_summary: Record<string, unknown>;
        attempts: number;
        claim_id: string | null;
      }>(
        sql`select status, parse_summary, attempts, claim_id from content_upload_files where run_id = ${h.run.id}::uuid`
      );
      expect(file.status).toBe('proposed_ki');
      expect(file.parse_summary[KI_STATE_KEY]).toBe('proposed');
      expect(file.attempts).toBe(0);
      expect(file.claim_id).toBeNull();

      const proposals = await rows<{
        source: string;
        band: string;
        confidence: string;
        is_current: boolean;
        model: string | null;
        component_code: string | null;
      }>(
        sql`select p.source, p.band, p.confidence, p.is_current, p.model, p.component_code
            from content_upload_proposals p join content_upload_files f on f.id = p.file_id
            where f.run_id = ${h.run.id}::uuid order by p.created_at, p.id`
      );
      expect(proposals.map(p => [p.source, p.is_current])).toEqual([
        ['content', false],
        ['ki', true],
      ]);
      expect(proposals[1]).toMatchObject({
        band: 'medium',
        model: 'test-model',
        component_code: 'K6.2',
      });
      expect(Number(proposals[1].confidence)).toBeLessThanOrEqual(0.8);

      const calls = await rows<Record<string, unknown>>(
        sql`select * from content_upload_ki_calls where run_id = ${h.run.id}::uuid`
      );
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        status: 'ok',
        model: 'test-model',
        endpoint_host: new URL(fake.url).host,
        excerpt: null,
        attempt: 1,
        stage: 'type_component',
      });
      expect(String(calls[0].excerpt_sha256)).toMatch(/^[0-9a-f]{64}$/);
      expect(Number(calls[0].excerpt_chars)).toBeGreaterThan(0);
      const dump = JSON.stringify(calls);
      expect(dump).not.toContain('test-key-NOT-A-SECRET');
      for (const word of CANARY_WORDS) expect(dump).not.toContain(word);
    });

    it('does not call the model twice for one file when two pumps run at the same time', async () => {
      const files = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          ambiguousQuiz(`Quiz-${i}.docx`, { questions: 2 + i })
        )
      );
      const h = await harness(files);
      // the rules first, the model stage off
      const off = reviewStepEnv(h.reviewDeps, h.run.id, {
        config: () => ({ ok: false as const, code: 'DISABLED' as const }),
        available: () => true,
        env: () => ({}),
      });
      await pumpReviewRun(
        h.reviewDeps,
        h.run.id,
        { closeUpload: true, retryDelaySeconds: 0 },
        off
      );
      await Promise.all([h.pump(), h.pump(), h.pump()]);
      await pumpUntilDone(h);
      const perFile = await rows<{ file_id: string; n: number }>(
        sql`select file_id, count(*)::int as n from content_upload_ki_calls
            where run_id = ${h.run.id}::uuid group by file_id`
      );
      expect(perFile).toHaveLength(6);
      expect(perFile.every(r => r.n === 1)).toBe(true);
      expect(fake.requests).toHaveLength(6);
      const states = await rows<{ status: string }>(
        sql`select status from content_upload_files where run_id = ${h.run.id}::uuid`
      );
      expect(states.every(s => s.status === 'proposed_ki')).toBe(true);
    });

    it('marks a file the stage could not help, and does not take it again', async () => {
      fake.setHandler((_s, res) => reply(res, 401, 'no'));
      const h = await harness([await ambiguousQuiz(), await structureless()]);
      await pumpUntilDone(h);
      const first = await rows<{ status: string; s: string | null }>(
        sql`select status, parse_summary ->> ${KI_STATE_KEY} as s
            from content_upload_files where run_id = ${h.run.id}::uuid order by rel_path`
      );
      expect(first.map(r => [r.status, r.s])).toEqual([
        ['unclear', 'not_sent'], // Notizen.docx: no structure
        ['unclear', 'failed'], // Quiz-A.docx: the server refused the key
      ]);
      const callsBefore = fake.requests.length;
      await h.pump();
      await h.pump();
      expect(fake.requests).toHaveLength(callsBefore);
      const logged = await rows<{ status: string }>(
        sql`select status from content_upload_ki_calls where run_id = ${h.run.id}::uuid order by requested_at, id`
      );
      // a refused key is a problem of the run, so the file was asked up to its own limit
      expect(logged.map(l => l.status).sort()).toEqual([
        'http_error',
        'http_error',
        'http_error',
        'refused_by_guard',
      ]);
    });

    it('holds the cost brake from the numbers in the database, over all runs', async () => {
      const first = await harness([await ambiguousQuiz()]);
      await pumpUntilDone(first);
      expect(fake.requests).toHaveLength(1);
      // a second run on the same day: the day limit counts the calls of the first one
      const configLimited = localConfig(fake, { maxCallsPerDay: 1 });
      const mem = new MemoryUploadStorage();
      const storage = guardUploadStorage(mem, 'public');
      const deps = { repo: upload, storage: () => storage };
      const reviewDeps = { ...deps, review, ki };
      const created = await createRun(deps, SUPER, {
        label: 'second',
        declarationAccepted: true,
        kiEnabled: true,
      });
      if (!created.ok) throw new Error(created.error);
      await uploadFiles({ deps, repo: upload, mem } as any, created.data, [
        await ambiguousQuiz('Quiz-Zwei.docx', { questions: 5 }),
      ]);
      const env = () =>
        reviewStepEnv(reviewDeps, created.data.id, {
          config: () => ({ ok: true as const, config: configLimited }),
          available: () => true,
          env: () => ({}),
        });
      for (let i = 0; i < 4; i += 1) {
        await pumpReviewRun(
          reviewDeps,
          created.data.id,
          { closeUpload: true, retryDelaySeconds: 0 },
          env()
        );
      }
      expect(fake.requests).toHaveLength(1);
      const [state] = await rows<{ status: string }>(
        sql`select status from content_upload_files where run_id = ${created.data.id}::uuid`
      );
      expect(state.status).toBe('unclear');
      const [runRow] = await rows<{ status: string }>(
        sql`select status from content_upload_runs where id = ${created.data.id}::uuid`
      );
      expect(runRow.status).toBe('review');
    });
  });
}
