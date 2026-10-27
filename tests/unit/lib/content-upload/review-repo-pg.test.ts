/**
 * @jest-environment node
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { PgReviewRepo } from '@/lib/content-upload/review/repo-pg';
import { PgUploadRepo } from '@/lib/content-upload/staging/repo-pg';
import { runReviewContract, type ReviewHarness } from './review-contract';

// The SQL review repository against a REAL, LOCAL, throwaway PostgreSQL (the schema
// of the migrations up to 20261030000100 applied). It only runs when the variable
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
  describe.skip('ReviewRepo contract: postgres (set CONTENT_UPLOAD_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  assertLocal(url);
  const client = postgres(url, { max: 12, prepare: false, onnotice: () => {} });
  const db = drizzle(client);
  const upload = new PgUploadRepo(db as any);
  const review = new PgReviewRepo(db as any);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  runReviewContract('postgres', async (): Promise<ReviewHarness> => {
    await db.execute(sql`truncate content_upload_runs cascade`);
    for (const [id, email, name] of [
      [USER_A, 'rv-a@example.test', 'Erika Muster'],
      [USER_B, 'rv-b@example.test', null],
    ]) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}::uuid, ${email}) on conflict (id) do nothing`
      );
      await db.execute(
        sql`insert into profiles (id, email, role, full_name) values (${id}::uuid, ${email}, 'ADMIN', ${name}) on conflict (id) do update set full_name = excluded.full_name`
      );
    }
    await db.execute(
      sql`insert into training_catalogs (code, title, is_active)
          values ('KFBM', 'KfBM', true) on conflict (code) do nothing`
    );
    const catalog = (await db.execute(
      sql`select id from training_catalogs where code = 'KFBM'`
    )) as unknown as { id: string }[];
    const catalogId = String(catalog[0].id);

    return {
      upload,
      review,
      userA: USER_A,
      userB: USER_B,
      catalogId,
      async forceRunStatus(id, status) {
        await db.execute(
          sql`update content_upload_runs set status = ${status} where id = ${id}::uuid`
        );
      },
      async forceFileStatus(id, status) {
        await db.execute(
          sql`update content_upload_files set status = ${status} where id = ${id}::uuid`
        );
      },
      async setDryRunHash(runId, hash) {
        await db.execute(
          sql`update content_upload_runs set last_dry_run_hash = ${hash} where id = ${runId}::uuid`
        );
      },
      async dryRunHash(runId) {
        const rows = (await db.execute(
          sql`select last_dry_run_hash as h from content_upload_runs where id = ${runId}::uuid`
        )) as unknown as { h: string | null }[];
        return rows[0]?.h ?? null;
      },
      async seedCatalog() {
        await db.execute(
          sql`delete from enablers where training_catalog_id = ${catalogId}::uuid`
        );
        await db.execute(
          sql`delete from courses where training_catalog_id = ${catalogId}::uuid`
        );
        await db.execute(
          sql`delete from training_components where training_catalog_id = ${catalogId}::uuid`
        );
        const comps = [
          ['K1', 'Eins', 'pflicht', 1],
          ['K12', 'Zwölf', 'wahl', null],
        ] as const;
        let order = 0;
        for (const [code, title, kind, phase] of comps) {
          order += 1;
          await db.execute(
            sql`insert into training_components
                  (training_catalog_id, code, title, total_weeks, total_hours, phase, kind, order_index)
                values (${catalogId}::uuid, ${code}, ${title}, 1, 40, ${phase}, ${kind}, ${order})`
          );
        }
        const [k1] = (await db.execute(
          sql`select id from training_components where training_catalog_id = ${catalogId}::uuid and code = 'K1'`
        )) as unknown as { id: string }[];
        await db.execute(
          sql`insert into courses (training_catalog_id, code, training_component_id, title, created_by_id)
              values (${catalogId}::uuid, 'K1', ${k1.id}::uuid, 'Eins', ${USER_A}::uuid)`
        );
        const [course] = (await db.execute(
          sql`select id from courses where training_catalog_id = ${catalogId}::uuid and code = 'K1'`
        )) as unknown as { id: string }[];
        for (const [i, code] of ['K1-a', 'K1-b'].entries()) {
          await db.execute(
            sql`insert into enablers (course_id, training_catalog_id, code, title, order_index)
                values (${course.id}::uuid, ${catalogId}::uuid, ${code}, ${code}, ${i + 1})`
          );
        }
      },
      async rawDecisions(runId) {
        const rows = (await db.execute(
          sql`select file_id, action, is_current, decisions_version
              from content_upload_decisions where run_id = ${runId}::uuid
              order by decided_at, id`
        )) as unknown as {
          file_id: string;
          action: string;
          is_current: boolean;
          decisions_version: number;
        }[];
        return rows.map(r => ({
          fileId: String(r.file_id),
          action: r.action,
          isCurrent: r.is_current,
          version: Number(r.decisions_version),
        }));
      },
      async rawProposals(fileId) {
        const rows = (await db.execute(
          sql`select id, is_current, band from content_upload_proposals
              where file_id = ${fileId}::uuid order by created_at, id`
        )) as unknown as { id: string; is_current: boolean; band: string }[];
        return rows.map(r => ({
          id: String(r.id),
          isCurrent: r.is_current,
          band: r.band,
        }));
      },
      async close() {},
    };
  });
}
