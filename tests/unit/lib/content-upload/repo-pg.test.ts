/**
 * @jest-environment node
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { PgUploadRepo } from '@/lib/content-upload/staging/repo-pg';
import { runRepoContract, type RepoHarness } from './repo-contract';

// The SQL repository against a REAL, LOCAL, throwaway PostgreSQL (the schema of
// the migrations up to 20261030000100 applied). It only runs when the variable
// CONTENT_UPLOAD_TEST_DB names such a database, for example
//
//   CONTENT_UPLOAD_TEST_DB=postgresql://postgres:pw@127.0.0.1:54343/postgres
//
// and it refuses every host but the own machine: never a hosted database. The
// test empties the content upload tables first.

const url = process.env.CONTENT_UPLOAD_TEST_DB;

const USER_A = '11111111-1111-4111-8111-1111111111aa';
const USER_B = '22222222-2222-4222-8222-2222222222bb';

function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'CONTENT_UPLOAD_TEST_DB must point at a database on this machine'
    );
  }
}

if (!url) {
  describe.skip('UploadRepo contract: postgres (set CONTENT_UPLOAD_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  assertLocal(url);
  const client = postgres(url, { max: 12, prepare: false, onnotice: () => {} });
  const db = drizzle(client);
  const repo = new PgUploadRepo(db as any);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  runRepoContract('postgres', async (): Promise<RepoHarness> => {
    await db.execute(sql`truncate content_upload_runs cascade`);
    await db.execute(
      sql`delete from auth_attempts where scope = 'content-upload-url'`
    );
    for (const [id, email] of [
      [USER_A, 'cu-a@example.test'],
      [USER_B, 'cu-b@example.test'],
    ]) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}::uuid, ${email}) on conflict (id) do nothing`
      );
      await db.execute(
        sql`insert into profiles (id, email, role) values (${id}::uuid, ${email}, 'ADMIN') on conflict (id) do nothing`
      );
    }
    await db.execute(
      sql`insert into training_catalogs (code, title, is_active)
          values ('KFBM', 'KfBM', true) on conflict (code) do nothing`
    );
    const catalog = (await db.execute(
      sql`select id from training_catalogs where code = 'KFBM'`
    )) as unknown as { id: string }[];

    const shift = (ms: number) =>
      sql`make_interval(secs => ${ms / 1000}::double precision)`;
    return {
      repo,
      userA: USER_A,
      userB: USER_B,
      catalogId: String(catalog[0].id),
      async advance(ms) {
        const by = shift(ms);
        await db.execute(sql`update content_upload_files set
          created_at = created_at - ${by}, locked_until = locked_until - ${by},
          completed_at = completed_at - ${by}, processed_at = processed_at - ${by}`);
        await db.execute(sql`update content_upload_runs set
          created_at = created_at - ${by}, updated_at = updated_at - ${by},
          purge_after = purge_after - ${by}`);
        await db.execute(sql`update auth_attempts set
          last_attempt_at = last_attempt_at - ${by} where scope = 'content-upload-url'`);
      },
      async forceRunStatus(id, status, purgeAfterDays) {
        await db.execute(
          sql`update content_upload_runs set status = ${status},
              purge_after = case when ${purgeAfterDays ?? null}::int is null then purge_after
                else now() + make_interval(days => ${purgeAfterDays ?? null}::int) end
              where id = ${id}::uuid`
        );
      },
      async forceFileStatus(id, status) {
        await db.execute(
          sql`update content_upload_files set status = ${status} where id = ${id}::uuid`
        );
      },
      async addApply(runId, mode, userId) {
        await db.execute(
          sql`insert into content_upload_applies
                (run_id, mode, started_by_id, decisions_version, decisions_hash, status, target_schema)
              values (${runId}::uuid, ${mode}, ${userId}::uuid, 0, 'test', 'ok', 'public')`
        );
      },
      async rawFiles(runId) {
        return repo.listFiles(runId, { offset: 0, limit: 5000 });
      },
      async rawRunExists(runId) {
        const rows = (await db.execute(
          sql`select 1 from content_upload_runs where id = ${runId}::uuid`
        )) as unknown as unknown[];
        return rows.length > 0;
      },
      async close() {},
    };
  });
}
