/**
 * Checksums of the stored files of the content documents (content_documents.content_sha256,
 * migration 20261103000200) and the check of the storage that comes with it.
 *
 * For every document without a checksum the script reads the file from the bucket `content`
 * (readContentObject, the same reader the server uses), computes the SHA-256 and writes it
 * to the column. A file that is not in the storage is NOT an error of the run: it is listed
 * in the report (document id, title, path in the bucket), so the content team can upload
 * it again. File contents are never logged or kept, only the hash and the byte count.
 *
 *   npm run content:hash -- --target preview
 *   npm run content:hash -- --target preview --apply --confirm-host <host of the database>
 *   npm run content:hash -- --target preview --limit 20          read 20 files, write nothing
 *   npm run content:hash -- --target production --i-know-this-is-production ...
 *
 * Safety:
 *  - the default is a dry run: the documents without a checksum are counted, no file is read
 *    (with --limit n, n files are read and hashed, still nothing is written)
 *  - a real run needs --apply and --confirm-host <host of the database connection>
 *  - --target is an option and has no default. Preview needs the role app_preview_migrator
 *    and works on the schema public_preview. Production works on the schema public, refuses
 *    to run without --i-know-this-is-production (also as a dry run) and is only ever run by a
 *    person on purpose
 *  - purely additive and repeatable: only rows with content_sha256 null are written, a value
 *    that exists is never overwritten, a second run finds nothing to do
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONTENT_BUCKET,
  parseContentReference,
} from '../../../src/lib/storage/contentPath';
import {
  readContentObject,
  type ContentReadingClient,
} from '../../../src/lib/storage/contentRead';

export type Target = 'preview' | 'production';

export const TARGETS: Record<
  Target,
  { schema: string; defaultDbUrlEnv: string }
> = {
  preview: {
    schema: 'public_preview',
    defaultDbUrlEnv: 'PREVIEW_IMPORT_DB_URL',
  },
  production: { schema: 'public', defaultDbUrlEnv: 'PRODUCTION_ADMIN_DB_URL' },
};

/** The only database role a Preview run may use (owns public_preview, no rights on public). */
export const PREVIEW_ROLE_PATTERN = /^app_preview_migrator(\.|$)/;

export const DEFAULT_BLOCK_SIZE = 50;
export const DEFAULT_CONCURRENCY = 4;
/** Largest file that is read (the content upload allows 25 MB, this leaves room). */
export const DEFAULT_MAX_MB = 100;

export interface Options {
  target: Target;
  apply: boolean;
  confirmHost: string | null;
  dbUrlEnv: string;
  iKnowThisIsProduction: boolean;
  /** Read at most this many documents (also in a dry run, which then reads and writes nothing). */
  limit: number | null;
  blockSize: number;
  concurrency: number;
  maxBytes: number;
  reportDir: string;
}

export type ParsedArgs =
  | { ok: true; options: Options }
  | { ok: false; error: string };

const KNOWN = new Set([
  '--target',
  '--apply',
  '--confirm-host',
  '--db-url-env',
  '--i-know-this-is-production',
  '--limit',
  '--block-size',
  '--concurrency',
  '--max-mb',
  '--report-dir',
]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const valueOf = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const value = argv[i + 1];
    return value && !value.startsWith('--') ? value : '';
  };
  for (const a of argv) {
    if (a.startsWith('--') && !KNOWN.has(a)) {
      return { ok: false, error: `Unknown option ${a}.` };
    }
  }
  const targetRaw = valueOf('--target');
  if (targetRaw !== 'preview' && targetRaw !== 'production') {
    return {
      ok: false,
      error: 'Every run needs --target preview or --target production.',
    };
  }
  const target: Target = targetRaw;
  const iKnow = argv.includes('--i-know-this-is-production');
  if (target === 'production' && !iKnow) {
    return {
      ok: false,
      error:
        'Production needs --i-know-this-is-production, also for a dry run. Nothing was done.',
    };
  }
  if (target === 'preview' && iKnow) {
    return {
      ok: false,
      error: '--i-know-this-is-production belongs to --target production.',
    };
  }
  const confirmHost = valueOf('--confirm-host');
  if (confirmHost === '') {
    return { ok: false, error: '--confirm-host needs a value.' };
  }
  const dbUrlEnv = valueOf('--db-url-env') ?? TARGETS[target].defaultDbUrlEnv;
  if (!/^[A-Z][A-Z0-9_]*$/.test(dbUrlEnv)) {
    return { ok: false, error: '--db-url-env must be a variable name.' };
  }
  const number = (
    flag: string,
    min: number,
    max: number,
    fallback: number | null
  ) => {
    const raw = valueOf(flag);
    if (raw === null) return fallback;
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < min || n > max) {
      return NaN;
    }
    return n;
  };
  const limit = number('--limit', 1, 1_000_000, null);
  const blockSize = number('--block-size', 1, 500, DEFAULT_BLOCK_SIZE);
  const concurrency = number('--concurrency', 1, 8, DEFAULT_CONCURRENCY);
  const maxMb = number('--max-mb', 1, 500, DEFAULT_MAX_MB);
  for (const [flag, n] of [
    ['--limit', limit],
    ['--block-size', blockSize],
    ['--concurrency', concurrency],
    ['--max-mb', maxMb],
  ] as const) {
    if (typeof n === 'number' && Number.isNaN(n)) {
      return { ok: false, error: `${flag} needs a whole number in range.` };
    }
  }
  const reportDir = valueOf('--report-dir');
  if (reportDir === '') {
    return { ok: false, error: '--report-dir needs a value.' };
  }
  return {
    ok: true,
    options: {
      target,
      apply: argv.includes('--apply'),
      confirmHost,
      dbUrlEnv,
      iKnowThisIsProduction: iKnow,
      limit,
      blockSize: blockSize as number,
      concurrency: concurrency as number,
      maxBytes: (maxMb as number) * 1024 * 1024,
      reportDir: reportDir ?? path.join(os.tmpdir(), 'wamocon-content-hash'),
    },
  };
}

export const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/** An error text when the run must not go on, null when the target fits. */
export function checkTarget(facts: {
  role: string;
  dbHost: string | null;
  options: Pick<Options, 'target' | 'apply' | 'confirmHost'>;
}): string | null {
  const isPreviewRole = PREVIEW_ROLE_PATTERN.test(facts.role);
  if (facts.options.target === 'preview' && !isPreviewRole) {
    return 'The database role is not app_preview_migrator. Nothing was done.';
  }
  if (facts.options.target === 'production' && isPreviewRole) {
    return 'The connection is the Preview role, but --target production was given. Nothing was done.';
  }
  if (facts.options.apply) {
    if (!facts.options.confirmHost) {
      return 'A real run needs --confirm-host <host of the database>. Nothing was done.';
    }
    if (facts.options.confirmHost !== facts.dbHost) {
      return '--confirm-host does not match the host of the connection. Nothing was done.';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unsafe: (query: string, params?: any[]) => PromiseLike<any>;
}

export interface PendingDocument {
  id: string;
  title: string;
  storageUrl: string;
}

const qualified = (target: Target) =>
  `${TARGETS[target].schema}.content_documents`;

/** Whether the migration 20261103000200 is applied in the schema of the target. */
export async function hasChecksumColumn(
  db: Db,
  target: Target
): Promise<boolean> {
  const rows = await db.unsafe(
    `select 1 from information_schema.columns
      where table_schema = $1 and table_name = 'content_documents'
        and column_name = 'content_sha256'`,
    [TARGETS[target].schema]
  );
  return rows.length > 0;
}

export interface DocumentCounts {
  /** Documents with a stored address (a document with a text only has none). */
  withAddress: number;
  /** Of those, the ones that already have a checksum (0 when the column is missing). */
  hashed: number;
}

export async function countDocuments(
  db: Db,
  target: Target,
  columnExists: boolean
): Promise<DocumentCounts> {
  const rows = await db.unsafe(
    columnExists
      ? `select count(*)::int as total,
                count(*) filter (where content_sha256 is not null)::int as hashed
           from ${qualified(target)}
          where nullif(btrim(storage_url), '') is not null`
      : `select count(*)::int as total, 0 as hashed
           from ${qualified(target)}
          where nullif(btrim(storage_url), '') is not null`
  );
  return { withAddress: Number(rows[0].total), hashed: Number(rows[0].hashed) };
}

/** The next documents without a checksum after `afterId` (keyset paging, stable on a rerun). */
export async function loadPending(
  db: Db,
  target: Target,
  afterId: string | null,
  count: number
): Promise<PendingDocument[]> {
  const rows = await db.unsafe(
    `select id::text as id, title, storage_url
       from ${qualified(target)}
      where content_sha256 is null
        and nullif(btrim(storage_url), '') is not null
        and ($1::uuid is null or id > $1::uuid)
      order by id
      limit $2`,
    [afterId, count]
  );
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    title: typeof r.title === 'string' ? r.title : '',
    storageUrl: typeof r.storage_url === 'string' ? r.storage_url : '',
  }));
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Writes a block of checksums in ONE statement. Only rows that still have no checksum are
 * touched, so a value that exists is never overwritten and the run can be repeated.
 */
export async function writeChecksums(
  db: Db,
  target: Target,
  items: ReadonlyArray<{ id: string; sha256: string }>
): Promise<number> {
  if (items.length === 0) return 0;
  for (const item of items) {
    if (!SHA256.test(item.sha256)) throw new Error('Not a SHA-256 value.');
  }
  const params: string[] = [];
  const values = items
    .map((item, i) => {
      params.push(item.id, item.sha256);
      return `($${i * 2 + 1}::uuid, $${i * 2 + 2}::text)`;
    })
    .join(', ');
  const rows = await db.unsafe(
    `update ${qualified(target)} d
        set content_sha256 = v.sha
       from (values ${values}) as v(id, sha)
      where d.id = v.id and d.content_sha256 is null
  returning d.id`,
    params
  );
  return rows.length;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** The part of the storage client the script needs: download (via the reader) and existence. */
export interface StorageAccess {
  reading: ContentReadingClient;
  exists(path: string): Promise<boolean | 'unknown'>;
  supabaseUrl: string;
}

export type DocumentOutcome =
  | { kind: 'hashed'; sha256: string; bytes: number }
  /** The file is not in the storage. */
  | { kind: 'missing'; path: string }
  /** The stored address is no usable address of the bucket (unsafe path). */
  | { kind: 'invalid' }
  /** An address outside of the bucket (an external link): no file to hash. */
  | { kind: 'external' }
  /** The file exists or could not be told, but was not readable (too large, storage error). */
  | { kind: 'failed'; reason: string }
  /** No key for the storage: the whole run stops. */
  | { kind: 'unavailable' };

export const sha256Of = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex');

/** Hashes the file of one stored address. Never throws for an expected failure. */
export async function hashAddress(
  raw: string,
  storage: StorageAccess,
  maxBytes: number
): Promise<DocumentOutcome> {
  const ref = parseContentReference(raw, { supabaseUrl: storage.supabaseUrl });
  if (ref.kind === 'other') return { kind: 'external' };
  if (ref.kind === 'invalid') return { kind: 'invalid' };

  const read = await readContentObject(raw, maxBytes, {
    supabaseUrl: storage.supabaseUrl,
    client: () => storage.reading,
  });
  if (read.status === 'ok') {
    return {
      kind: 'hashed',
      sha256: sha256Of(read.buffer),
      bytes: read.buffer.length,
    };
  }
  if (read.status === 'unavailable') return { kind: 'unavailable' };
  if (read.status === 'not-content') return { kind: 'external' };
  // The reader does not say why a download failed: ask the storage whether the object exists
  const exists = await storage.exists(ref.path);
  if (exists === false) return { kind: 'missing', path: ref.path };
  return {
    kind: 'failed',
    reason: exists === true ? read.reason : 'The storage did not answer.',
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export interface MissingEntry {
  id: string;
  title: string;
  path: string;
}

export interface HashReport {
  generatedAt: string;
  target: Target;
  /** Host of the database connection (no user, no password). */
  host: string | null;
  mode: 'dry-run' | 'dry-run-read' | 'apply';
  columnExists: boolean;
  counts: {
    withAddress: number;
    alreadyHashed: number;
    pending: number;
    read: number;
    hashed: number;
    written: number;
    missing: number;
    invalid: number;
    external: number;
    failed: number;
  };
  /** Documents whose file is not in the storage. */
  missing: MissingEntry[];
  invalid: Array<{ id: string; title: string }>;
  failed: Array<{ id: string; title: string; reason: string }>;
  durationMs: number;
}

export interface RunDeps {
  db: Db;
  storage: StorageAccess | null;
  host: string | null;
  now?: () => number;
  log?: (line: string) => void;
}

/** Runs `worker` over `items` with at most `concurrency` at the same time, results in order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i]);
      }
    }
  );
  await Promise.all(lanes);
  return results;
}

export async function runHash(
  options: Options,
  deps: RunDeps
): Promise<HashReport> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const started = now();
  const { db, storage } = deps;

  const columnExists = await hasChecksumColumn(db, options.target);
  const counts = await countDocuments(db, options.target, columnExists);
  const report: HashReport = {
    generatedAt: new Date(started).toISOString(),
    target: options.target,
    host: deps.host,
    mode: options.apply
      ? 'apply'
      : options.limit !== null
        ? 'dry-run-read'
        : 'dry-run',
    columnExists,
    counts: {
      withAddress: counts.withAddress,
      alreadyHashed: counts.hashed,
      pending: counts.withAddress - counts.hashed,
      read: 0,
      hashed: 0,
      written: 0,
      missing: 0,
      invalid: 0,
      external: 0,
      failed: 0,
    },
    missing: [],
    invalid: [],
    failed: [],
    durationMs: 0,
  };
  log(
    `Documents with a stored address: ${counts.withAddress}, with checksum: ${counts.hashed}, without: ${report.counts.pending}`
  );
  if (!columnExists) {
    log(
      'The column content_sha256 does not exist in this schema yet (migration 20261103000200 is not applied).'
    );
    if (options.apply) {
      throw new Error(
        'The column content_sha256 is missing. Apply the migration first. Nothing was written.'
      );
    }
  }

  const reads = options.apply || options.limit !== null;
  if (!reads) {
    log(
      'Dry run: no file was read, nothing was written (--limit n reads n files).'
    );
    report.durationMs = now() - started;
    return report;
  }
  if (!columnExists) {
    // a dry run with reading cannot page by the column: stop with the counts above
    log('No file was read because the column is missing.');
    report.durationMs = now() - started;
    return report;
  }
  if (!storage) {
    throw new Error(
      'No storage access: NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SECRET_KEY are needed to read files.'
    );
  }

  const byAddress = new Map<string, DocumentOutcome>();
  let afterId: string | null = null;
  let remaining = options.limit ?? Number.POSITIVE_INFINITY;
  while (remaining > 0) {
    const take = Math.min(options.blockSize, remaining);
    const block = await loadPending(db, options.target, afterId, take);
    if (block.length === 0) break;
    afterId = block[block.length - 1].id;
    remaining -= block.length;

    const outcomes = await mapLimit(block, options.concurrency, async doc => {
      // two documents with the same address are read once
      const known = byAddress.get(doc.storageUrl);
      if (known) return known;
      const outcome = await hashAddress(
        doc.storageUrl,
        storage,
        options.maxBytes
      );
      if (outcome.kind !== 'unavailable')
        byAddress.set(doc.storageUrl, outcome);
      return outcome;
    });

    const toWrite: Array<{ id: string; sha256: string }> = [];
    block.forEach((doc, i) => {
      const outcome = outcomes[i];
      report.counts.read += 1;
      switch (outcome.kind) {
        case 'hashed':
          report.counts.hashed += 1;
          toWrite.push({ id: doc.id, sha256: outcome.sha256 });
          break;
        case 'missing':
          report.counts.missing += 1;
          report.missing.push({
            id: doc.id,
            title: doc.title,
            path: outcome.path,
          });
          break;
        case 'invalid':
          report.counts.invalid += 1;
          report.invalid.push({ id: doc.id, title: doc.title });
          break;
        case 'external':
          report.counts.external += 1;
          break;
        case 'failed':
          report.counts.failed += 1;
          report.failed.push({
            id: doc.id,
            title: doc.title,
            reason: outcome.reason,
          });
          break;
        case 'unavailable':
          throw new Error(
            'No storage access: SUPABASE_SECRET_KEY is missing. Nothing more was read.'
          );
      }
    });
    if (options.apply) {
      report.counts.written += await writeChecksums(
        db,
        options.target,
        toWrite
      );
    }
    log(
      `Read ${report.counts.read}, hashed ${report.counts.hashed}, missing ${report.counts.missing}, failed ${report.counts.failed}${options.apply ? `, written ${report.counts.written}` : ''}`
    );
  }
  report.durationMs = now() - started;
  return report;
}

/** Writes the report as JSON (never file contents) and returns its path. */
export function writeReport(report: HashReport, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const file = path.join(dir, `hash-documents-${report.target}-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

export const BUCKET = CONTENT_BUCKET;
