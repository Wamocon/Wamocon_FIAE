/**
 * @jest-environment node
 */
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { PgKiRepo } from '@/lib/content-upload/ki/repo-pg';
import { PgReviewRepo } from '@/lib/content-upload/review/repo-pg';
import { PgUploadRepo } from '@/lib/content-upload/staging/repo-pg';
import { sha256 } from '../../../helpers/kiFixtures';
import { candidate } from './repo-contract';
import { runKiRepoContract, type KiHarness } from './ki-repo-contract';

// The SQL repositories of the model stage against a REAL, LOCAL, throwaway
// PostgreSQL (the schema of the migrations up to 20261030000100 applied). It only
// runs when CONTENT_UPLOAD_TEST_DB names such a database, and it refuses every host
// but the own machine: never a hosted database. The test empties the content
// upload tables first.

const url = process.env.CONTENT_UPLOAD_TEST_DB;
const USER_A = '11111111-1111-4111-8111-1111111111aa';

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'CONTENT_UPLOAD_TEST_DB must point at a database on this machine'
    );
  }
}

if (!url) {
  describe.skip('KiRepo contract: postgres (set CONTENT_UPLOAD_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  assertLocal(url);
  const client = postgres(url, { max: 6, prepare: false, onnotice: () => {} });
  const db = drizzle(client);
  const upload = new PgUploadRepo(db as any);
  const ki = new PgKiRepo(db as any);
  const review = new PgReviewRepo(db as any);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function prepare() {
    await db.execute(sql`truncate content_upload_runs cascade`);
    await db.execute(
      sql`insert into auth.users (id, email) values (${USER_A}::uuid, 'ki-a@example.test') on conflict (id) do nothing`
    );
    await db.execute(
      sql`insert into profiles (id, email, role) values (${USER_A}::uuid, 'ki-a@example.test', 'ADMIN') on conflict (id) do nothing`
    );
    await db.execute(
      sql`insert into training_catalogs (code, title, is_active)
          values ('KFBM', 'KfBM', true) on conflict (code) do nothing`
    );
    const rows = (await db.execute(
      sql`select id from training_catalogs where code = 'KFBM'`
    )) as unknown as { id: string }[];
    return String(rows[0].id);
  }

  let counter = 0;
  async function runWithFile(catalogId: string) {
    const runId = randomUUID();
    const created = await upload.createRun(
      {
        id: runId,
        catalogId,
        createdById: USER_A,
        label: `ki ${++counter}`,
        kiEnabled: true,
        storagePrefix: `upload/${runId}/`,
      },
      100
    );
    if (!created.ok) throw new Error('could not create the run');
    return runId;
  }
  async function addFile(runId: string) {
    const c = candidate(runId, counter * 100 + Math.floor(Math.random() * 90));
    const announced = await upload.announce(runId, [c]);
    if (!announced.ok) throw new Error('announce failed');
    return c.id;
  }

  runKiRepoContract('postgres', async (): Promise<KiHarness> => {
    const catalogId = await prepare();
    // The clock of the database is the clock of the repository: moving time means
    // moving the stored times back
    let moved = 0;
    return {
      repo: ki,
      async newFile() {
        const runId = await runWithFile(catalogId);
        return { runId, fileId: await addFile(runId) };
      },
      moreFile: runId => addFile(runId),
      async advance(ms) {
        moved += ms;
        await db.execute(
          sql`update content_upload_ki_calls
              set requested_at = requested_at - make_interval(secs => ${ms / 1000}::double precision)`
        );
      },
      async rawCalls(runId) {
        const rows = (await db.execute(
          sql`select status, excerpt, excerpt_chars, endpoint_host, model, answer_excerpt
              from content_upload_ki_calls where run_id = ${runId}::uuid
              order by requested_at, id`
        )) as unknown as {
          status: string;
          excerpt: string | null;
          excerpt_chars: number;
          endpoint_host: string | null;
          model: string | null;
          answer_excerpt: string | null;
        }[];
        return rows.map(r => ({
          status: r.status,
          excerpt: r.excerpt,
          excerptChars: Number(r.excerpt_chars),
          endpointHost: r.endpoint_host,
          model: r.model,
          answer: r.answer_excerpt,
        }));
      },
      async close() {
        void moved;
      },
    };
  });

  describe('PgKiRepo, what only the database can show', () => {
    it('refuses ids that are no uuids and a hash that is no hash', async () => {
      await expect(
        ki.recordCall({
          runId: 'x',
          fileId: 'y',
          stage: 'type_component',
          model: null,
          endpointHost: null,
          excerptChars: 0,
          excerptSha256: sha256(''),
          redactions: 0,
          status: 'skipped',
          httpStatus: null,
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          attempt: 1,
          answer: null,
        })
      ).rejects.toThrow();
      const catalogId = await prepare();
      const runId = await runWithFile(catalogId);
      const fileId = await addFile(runId);
      await expect(
        ki.recordCall({
          runId,
          fileId,
          stage: 'type_component',
          model: 'm',
          endpointHost: 'host.example',
          excerptChars: 1,
          excerptSha256: 'not-a-hash',
          redactions: 0,
          status: 'ok',
          httpStatus: 200,
          latencyMs: 1,
          promptTokens: 1,
          completionTokens: 1,
          attempt: 1,
          answer: null,
        })
      ).rejects.toThrow();
      expect(await ki.usage('not-a-uuid', null, 5)).toEqual({
        run: 0,
        day: 0,
        file: 0,
        recent: [],
      });
    });

    it('lets the database check a host with a path or a password', async () => {
      const catalogId = await prepare();
      const runId = await runWithFile(catalogId);
      const fileId = await addFile(runId);
      for (const host of ['https://host.example/api', 'user:pw@host.example']) {
        await expect(
          ki.recordCall({
            runId,
            fileId,
            stage: 'type_component',
            model: 'm',
            endpointHost: host,
            excerptChars: 1,
            excerptSha256: sha256('x'),
            redactions: 0,
            status: 'ok',
            httpStatus: 200,
            latencyMs: 1,
            promptTokens: 1,
            completionTokens: 1,
            attempt: 1,
            answer: null,
          })
        ).rejects.toThrow();
      }
    });
  });

  describe('PgReviewRepo, solution texts of the database', () => {
    it('hands back rationales, long correct options and trainer solutions, not short or empty ones', async () => {
      const catalogId = await prepare();
      void catalogId;
      const [user] = [USER_A];
      const long = (s: string) => `${s} ${'x'.repeat(30)}`;
      await db.execute(sql`delete from options`);
      await db.execute(sql`delete from questions`);
      await db.execute(sql`delete from quizzes where code = 'ZZ-KI-TEST'`);
      const [quiz] = (await db.execute(
        sql`insert into quizzes (code, title, quiz_type, created_by_id)
            values ('ZZ-KI-TEST', 'Test', 'LESSON', ${user}::uuid) returning id`
      )) as unknown as { id: string }[];
      const [question] = (await db.execute(
        sql`insert into questions (quiz_id, question_text, order_index)
            values (${quiz.id}::uuid, 'Frage?', 1) returning id`
      )) as unknown as { id: string }[];
      for (const [text, correct, explanation] of [
        [long('Richtige Option lang'), true, long('Begründung lang')],
        ['kurz', true, 'kurz'],
        [long('Falsche Option lang'), false, null],
      ] as const) {
        await db.execute(
          sql`insert into options (question_id, option_text, is_correct, explanation)
              values (${question.id}::uuid, ${text}, ${correct}, ${explanation})`
        );
      }
      const texts = await review.existingSolutionTexts(100);
      expect(texts).toEqual(
        expect.arrayContaining([
          long('Richtige Option lang'),
          long('Begründung lang'),
        ])
      );
      expect(texts).not.toContain('kurz');
      expect(texts).not.toContain(long('Falsche Option lang'));
      expect(await review.existingSolutionTexts(1)).toHaveLength(1);
      expect(await review.existingSolutionTexts(0)).toEqual([]);
    });
  });
}
