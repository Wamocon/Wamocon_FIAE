// A real, local, throwaway PostgreSQL for the tests of the transfer (package U7):
// every migration up to 20261030000100 applied, set up by the scratch scripts of
// the packages (u1_build.sh). Tests that use it only run when CONTENT_UPLOAD_TEST_DB
// names such a database, and they refuse every host but the own machine.
import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import { fromPostgresJs } from '@/lib/content-upload/connection';
import {
  PgTransferStore,
  queryableOfPool,
} from '@/lib/content-upload/transfer/store';
import type { TransferDeps } from '@/lib/content-upload/transfer/run';

import type { FixtureFile } from './transferFixtures';

export const USER = '11111111-0000-4000-8000-0000000000a7';
export const ORG = 'aaaaaaaa-0000-4000-8000-0000000000a7';

export function assertLocal(connection: string) {
  const host = new URL(connection).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(
      'CONTENT_UPLOAD_TEST_DB must point at a database on this machine'
    );
  }
}

export type Sql = ReturnType<typeof postgres>;

/** Tables of the content import, children first. */
export const CONTENT_TABLES = [
  'content_documents',
  'enabler_quiz_links',
  'options',
  'questions',
  'quizzes',
  'use_cases',
  'enablers',
  'courses',
  'training_components',
] as const;

/**
 * The schema the tests run in: public (a plain local database) or public_preview (a
 * database that was rebuilt like the Preview, tried as the role app_preview).
 */
export const SCHEMA = process.env.CONTENT_UPLOAD_TEST_SCHEMA ?? 'public';

/** Host the transfer is told it runs against (a hosted host for the Preview shape). */
export const HOST = process.env.CONTENT_UPLOAD_TEST_HOST ?? '127.0.0.1';

export function connect(url: string): Sql {
  assertLocal(url);
  return postgres(url, {
    max: 12,
    prepare: false,
    onnotice: () => undefined,
    ...(SCHEMA === 'public' ? {} : { connection: { search_path: SCHEMA } }),
  });
}

/** Empties the content and the upload tables and makes sure the catalog and the user exist. */
export async function reset(sql: Sql) {
  await sql`truncate content_upload_runs cascade`;
  await sql.unsafe(
    `truncate ${[...CONTENT_TABLES].join(', ')}, quiz_submissions, use_case_submissions cascade`
  );
  await sql`insert into organizations (id, name, slug, subscription_plan, max_trainee_seats, max_trainer_seats, is_platform_owner)
            values (${ORG}, 'Plattform', 'u7-p', 'PRO', 10, 10, true) on conflict (id) do nothing`;
  await sql`insert into auth.users (id, email) values (${USER}, 'u7@t.test') on conflict (id) do nothing`;
  await sql`insert into profiles (id, email, role, organization_id, is_active, trainer_activated)
            values (${USER}, 'u7@t.test', 'SUPER_ADMIN', ${ORG}, true, true) on conflict (id) do nothing`;
  await sql`insert into training_catalogs (code, title, is_active) values ('KFBM', 'KfBM', true)
            on conflict (code) do update set is_active = true`;
}

export interface SeededRun {
  runId: string;
  files: FixtureFile[];
  bytes: Map<string, Uint8Array>;
}

/** A run in the state review with files that have a current decision. */
export async function seedRun(
  sql: Sql,
  files: FixtureFile[],
  options: { version?: number; status?: string } = {}
): Promise<SeededRun> {
  const runId = randomUUID();
  const [catalog] =
    await sql`select id from training_catalogs where code = 'KFBM'`;
  await sql`insert into content_upload_runs
    (id, training_catalog_id, created_by_id, label, status, ki_enabled, declaration_accepted_at, storage_prefix, decisions_version)
    values (${runId}, ${catalog.id}, ${USER}, 'u7 test', ${options.status ?? 'review'}, false, now(), ${`upload/${runId}/`}, ${options.version ?? 1})`;
  const bytes = new Map<string, Uint8Array>();
  for (const { file, bytes: content } of files) {
    bytes.set(file.id, content);
    await sql`insert into content_upload_files
      (id, run_id, rel_path, file_name, ext, size_bytes, sha256, client_mtime_ms, storage_path, status, dup_key)
      values (${file.id}, ${runId}, ${file.relPath}, ${file.fileName}, ${file.ext}, ${file.sizeBytes}, ${file.sha256}, ${file.mtimeMs}, ${file.storagePath}, ${file.status}, ${file.dupKey})`;
    const d = file.decision;
    await sql`insert into content_upload_decisions
      (id, run_id, file_id, decisions_version, decided_by_id, action, doc_type, component_code, enabler_code, quiz_level, dup_choice, is_current)
      values (${d.id}, ${runId}, ${file.id}, ${options.version ?? 1}, ${USER}, ${d.action}, ${d.docType}, ${d.componentCode}, ${d.enablerCode}, ${d.quizLevel}, ${d.dupChoice}, true)`;
  }
  return { runId, files, bytes };
}

export function transferDeps(
  sql: Sql,
  seeded: SeededRun,
  extra: Partial<TransferDeps> = {}
): TransferDeps {
  return {
    store: new PgTransferStore(queryableOfPool(sql as any)),
    connections: fromPostgresJs(sql as any),
    readBytes: async file => seeded.bytes.get(file.id) ?? null,
    host: HOST,
    ...extra,
  };
}

/** Number of rows and a hash of all columns, by content table (to compare two states). */
export async function snapshot(sql: Sql): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const table of CONTENT_TABLES) {
    const [row] = await sql.unsafe(
      `select count(*)::int as n, coalesce(md5(string_agg((to_jsonb(t) - 'updated_at')::text, '|' order by t.id)), '') as h from ${table} t`
    );
    out[table] = `${row.n}:${row.h}`;
  }
  return out;
}

export async function counts(sql: Sql): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of CONTENT_TABLES) {
    const [row] = await sql.unsafe(`select count(*)::int as n from ${table}`);
    out[table] = row.n;
  }
  return out;
}
