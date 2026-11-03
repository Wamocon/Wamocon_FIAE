/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkTarget,
  hashAddress,
  mapLimit,
  parseArgs,
  runHash,
  sha256Of,
  writeChecksums,
  writeReport,
  type Db,
  type Options,
  type StorageAccess,
} from '../../../scripts/content/lib/hash-documents';

const HOST = 'https://project.example.supabase.co';
const addr = (file: string) =>
  `${HOST}/storage/v1/object/public/content/kfbm/${file}`;
const SHA_ABC =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

const parse = (argv: string[]) => parseArgs(argv);
const options = (over: Partial<Options> = {}): Options => ({
  target: 'preview',
  apply: false,
  confirmHost: null,
  dbUrlEnv: 'PREVIEW_IMPORT_DB_URL',
  iKnowThisIsProduction: false,
  limit: null,
  blockSize: 2,
  concurrency: 2,
  maxBytes: 1024,
  reportDir: os.tmpdir(),
  ...over,
});

describe('hash-documents: arguments', () => {
  it('needs --target and has no default', () => {
    const r = parse([]);
    expect(r.ok).toBe(false);
    expect(parse(['--target', 'staging']).ok).toBe(false);
  });

  it('a preview run is a dry run by default with the Preview connection', () => {
    const r = parse(['--target', 'preview']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options).toMatchObject({
      target: 'preview',
      apply: false,
      dbUrlEnv: 'PREVIEW_IMPORT_DB_URL',
      limit: null,
    });
  });

  it('production is refused without --i-know-this-is-production, also as a dry run', () => {
    const r = parse(['--target', 'production']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/i-know-this-is-production/);
    expect(parse(['--target', 'production', '--apply']).ok).toBe(false);
    const ok = parse(['--target', 'production', '--i-know-this-is-production']);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.options.dbUrlEnv).toBe('PRODUCTION_ADMIN_DB_URL');
      expect(ok.options.apply).toBe(false);
    }
  });

  it('the production flag does not belong to a preview run', () => {
    expect(
      parse(['--target', 'preview', '--i-know-this-is-production']).ok
    ).toBe(false);
  });

  it('refuses unknown options, a bad number and a bad variable name', () => {
    expect(parse(['--target', 'preview', '--force']).ok).toBe(false);
    expect(parse(['--target', 'preview', '--limit', 'x']).ok).toBe(false);
    expect(parse(['--target', 'preview', '--limit', '0']).ok).toBe(false);
    expect(parse(['--target', 'preview', '--concurrency', '99']).ok).toBe(
      false
    );
    expect(parse(['--target', 'preview', '--db-url-env', 'a b']).ok).toBe(
      false
    );
    expect(parse(['--target', 'preview', '--confirm-host']).ok).toBe(false);
  });

  it('reads limit, block size and the confirmed host', () => {
    const r = parse([
      '--target',
      'preview',
      '--apply',
      '--confirm-host',
      'db.example.com',
      '--limit',
      '20',
      '--block-size',
      '10',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.options).toMatchObject({
        apply: true,
        confirmHost: 'db.example.com',
        limit: 20,
        blockSize: 10,
      });
    }
  });
});

describe('hash-documents: the target check', () => {
  const base = { apply: false, confirmHost: null };

  it('a preview run needs the Preview role', () => {
    expect(
      checkTarget({
        role: 'postgres',
        dbHost: 'h',
        options: { ...base, target: 'preview' },
      })
    ).toMatch(/app_preview_migrator/);
    expect(
      checkTarget({
        role: 'app_preview_migrator.abc',
        dbHost: 'h',
        options: { ...base, target: 'preview' },
      })
    ).toBeNull();
  });

  it('a production run refuses the Preview role', () => {
    expect(
      checkTarget({
        role: 'app_preview_migrator',
        dbHost: 'h',
        options: { ...base, target: 'production' },
      })
    ).toMatch(/Preview role/);
  });

  it('a real run needs the host of the connection', () => {
    const apply = { apply: true, target: 'preview' as const };
    const role = 'app_preview_migrator';
    expect(
      checkTarget({
        role,
        dbHost: 'h',
        options: { ...apply, confirmHost: null },
      })
    ).toMatch(/confirm-host/);
    expect(
      checkTarget({
        role,
        dbHost: 'h',
        options: { ...apply, confirmHost: 'other' },
      })
    ).toMatch(/does not match/);
    expect(
      checkTarget({
        role,
        dbHost: 'h',
        options: { ...apply, confirmHost: 'h' },
      })
    ).toBeNull();
  });
});

describe('hash-documents: writing', () => {
  it('writes a block in one statement and only where no checksum exists', async () => {
    const calls: { query: string; params?: unknown[] }[] = [];
    const db: Db = {
      unsafe: async (query, params) => {
        calls.push({ query, params });
        return [{ id: 'a' }, { id: 'b' }];
      },
    };
    const written = await writeChecksums(db, 'preview', [
      { id: '00000000-0000-4000-8000-000000000001', sha256: SHA_ABC },
      { id: '00000000-0000-4000-8000-000000000002', sha256: SHA_ABC },
    ]);
    expect(written).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain('public_preview.content_documents');
    expect(calls[0].query).toMatch(/content_sha256 is null/);
    expect(calls[0].query).not.toMatch(/\bdelete\b|\binsert\b/i);
    expect(calls[0].params).toHaveLength(4);
  });

  it('production names the schema public', async () => {
    let query = '';
    const db: Db = {
      unsafe: async q => {
        query = q;
        return [];
      },
    };
    await writeChecksums(db, 'production', [
      { id: '00000000-0000-4000-8000-000000000001', sha256: SHA_ABC },
    ]);
    expect(query).toContain('public.content_documents');
    expect(query).not.toContain('public_preview');
  });

  it('refuses a value that is no SHA-256 and writes nothing for an empty block', async () => {
    const db: Db = {
      unsafe: async () => {
        throw new Error('must not be called');
      },
    };
    await expect(
      writeChecksums(db, 'preview', [{ id: 'x', sha256: 'abc' }])
    ).rejects.toThrow(/SHA-256/);
    expect(await writeChecksums(db, 'preview', [])).toBe(0);
  });
});

/** Storage with the given files; a file that is not listed is missing. */
function fakeStorage(
  files: Record<string, string>,
  over: {
    exists?: (path: string) => boolean | 'unknown';
    failDownload?: string[];
  } = {}
): StorageAccess & { downloads: string[] } {
  const downloads: string[] = [];
  return {
    supabaseUrl: HOST,
    downloads,
    reading: {
      storage: {
        from: () => ({
          download: async (p: string) => {
            downloads.push(p);
            const body = files[p];
            if (body === undefined || over.failDownload?.includes(p)) {
              return { data: null, error: { message: 'not found' } };
            }
            const buffer = Buffer.from(body);
            return {
              data: {
                size: buffer.length,
                arrayBuffer: async () =>
                  buffer.buffer.slice(
                    buffer.byteOffset,
                    buffer.byteOffset + buffer.byteLength
                  ) as ArrayBuffer,
              },
              error: null,
            };
          },
        }),
      },
    },
    exists: async p => (over.exists ? over.exists(p) : Object.hasOwn(files, p)),
  };
}

describe('hash-documents: one address', () => {
  it('hashes the file', async () => {
    const storage = fakeStorage({ 'kfbm/a.pdf': 'abc' });
    expect(await hashAddress(addr('a.pdf'), storage, 1024)).toEqual({
      kind: 'hashed',
      sha256: SHA_ABC,
      bytes: 3,
    });
    expect(sha256Of(Buffer.from('abc'))).toBe(SHA_ABC);
  });

  it('a file that is not in the storage is missing, with its path', async () => {
    const storage = fakeStorage({});
    expect(await hashAddress(addr('gone.pdf'), storage, 1024)).toEqual({
      kind: 'missing',
      path: 'kfbm/gone.pdf',
    });
  });

  it('a file that exists but cannot be read is failed, not missing', async () => {
    const storage = fakeStorage(
      { 'kfbm/a.pdf': 'abc' },
      { failDownload: ['kfbm/a.pdf'] }
    );
    const outcome = await hashAddress(addr('a.pdf'), storage, 1024);
    expect(outcome.kind).toBe('failed');
  });

  it('a storage that does not answer on the existence question is failed', async () => {
    const storage = fakeStorage({}, { exists: () => 'unknown' });
    expect(await hashAddress(addr('x.pdf'), storage, 1024)).toMatchObject({
      kind: 'failed',
    });
  });

  it('a file over the size limit is failed', async () => {
    const storage = fakeStorage({ 'kfbm/big.pdf': 'x'.repeat(50) });
    expect(await hashAddress(addr('big.pdf'), storage, 10)).toMatchObject({
      kind: 'failed',
      reason: expect.stringMatching(/too large/),
    });
  });

  it('an external link is no file and an unsafe path is invalid', async () => {
    const storage = fakeStorage({});
    expect(
      await hashAddress('https://example.com/video.mp4', storage, 1024)
    ).toEqual({ kind: 'external' });
    expect(await hashAddress(addr('..%2f..%2fsecret'), storage, 1024)).toEqual({
      kind: 'invalid',
    });
    expect(storage.downloads).toEqual([]);
  });

  it('no client means the whole run stops', async () => {
    const storage = fakeStorage({});
    const outcome = await hashAddress(
      addr('a.pdf'),
      { ...storage, reading: null as never },
      1024
    );
    expect(outcome.kind).toBe('unavailable');
  });
});

describe('hash-documents: mapLimit', () => {
  it('keeps the order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4, 5, 6], 2, async n => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 2));
      running -= 1;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(await mapLimit([], 3, async n => n)).toEqual([]);
  });
});

interface Row {
  id: string;
  title: string;
  storage_url: string;
  sha: string | null;
}

/** An in-memory content_documents that answers the statements of the script. */
function fakeDb(rows: Row[], columnExists = true) {
  const writes: string[][] = [];
  const queries: string[] = [];
  const db: Db = {
    unsafe: async (query, params = []) => {
      queries.push(query);
      if (query.includes('information_schema.columns')) {
        return columnExists ? [{ '?column?': 1 }] : [];
      }
      if (query.includes('count(*)')) {
        const withAddress = rows.filter(r => r.storage_url.trim());
        return [
          {
            total: withAddress.length,
            hashed: columnExists
              ? withAddress.filter(r => r.sha !== null).length
              : 0,
          },
        ];
      }
      if (query.trimStart().startsWith('select id::text')) {
        const [after, count] = params as [string | null, number];
        return rows
          .filter(r => r.sha === null && r.storage_url.trim())
          .filter(r => after === null || r.id > after)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, count);
      }
      if (query.trimStart().startsWith('update')) {
        const ids: string[] = [];
        for (let i = 0; i < params.length; i += 2) {
          const row = rows.find(r => r.id === params[i]);
          if (row && row.sha === null) {
            row.sha = params[i + 1] as string;
            ids.push(row.id);
          }
        }
        writes.push(ids);
        return ids.map(id => ({ id }));
      }
      throw new Error(`unexpected statement: ${query.slice(0, 40)}`);
    },
  };
  return { db, writes, queries, rows };
}

const row = (n: number, file: string, sha: string | null = null): Row => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  title: `Dokument ${n}`,
  storage_url: file === '' ? '' : addr(file),
  sha,
});

describe('hash-documents: the run', () => {
  const files = { 'kfbm/a.pdf': 'abc', 'kfbm/b.pdf': 'abd' };

  it('a dry run counts and reads no file, writes nothing', async () => {
    const f = fakeDb([
      row(1, 'a.pdf'),
      row(2, 'b.pdf'),
      row(3, ''),
      row(4, 'c.pdf', SHA_ABC),
    ]);
    const storage = fakeStorage(files);
    const report = await runHash(options(), { db: f.db, storage, host: 'h' });
    expect(report.mode).toBe('dry-run');
    expect(report.counts).toMatchObject({
      withAddress: 3,
      alreadyHashed: 1,
      pending: 2,
      read: 0,
    });
    expect(storage.downloads).toEqual([]);
    expect(f.writes).toEqual([]);
  });

  it('a dry run with --limit reads that many files and still writes nothing', async () => {
    const f = fakeDb([row(1, 'a.pdf'), row(2, 'b.pdf'), row(3, 'gone.pdf')]);
    const storage = fakeStorage(files);
    const report = await runHash(options({ limit: 2 }), {
      db: f.db,
      storage,
      host: 'h',
    });
    expect(report.mode).toBe('dry-run-read');
    expect(report.counts).toMatchObject({ read: 2, hashed: 2, written: 0 });
    expect(f.writes).toEqual([]);
    expect(f.rows.every(r => r.sha === null)).toBe(true);
  });

  it('a real run writes the checksums, lists the missing files and the second run finds nothing', async () => {
    const f = fakeDb([
      row(1, 'a.pdf'),
      row(2, 'b.pdf'),
      row(3, 'gone.pdf'),
      row(4, 'a.pdf'),
      row(5, ''),
    ]);
    const storage = fakeStorage(files);
    const report = await runHash(options({ apply: true }), {
      db: f.db,
      storage,
      host: 'h',
    });
    expect(report.mode).toBe('apply');
    expect(report.counts).toMatchObject({
      pending: 4,
      read: 4,
      hashed: 3,
      written: 3,
      missing: 1,
    });
    expect(report.missing).toEqual([
      { id: f.rows[2].id, title: 'Dokument 3', path: 'kfbm/gone.pdf' },
    ]);
    // blocks of two documents, so the writes are in blocks
    expect(f.writes.length).toBeGreaterThan(1);
    expect(f.rows.map(r => r.sha)).toEqual([
      SHA_ABC,
      sha256Of(Buffer.from('abd')),
      null,
      SHA_ABC,
      null,
    ]);
    // the same address is read once
    expect(storage.downloads.filter(p => p === 'kfbm/a.pdf')).toHaveLength(1);

    const again = await runHash(options({ apply: true }), {
      db: f.db,
      storage: fakeStorage(files),
      host: 'h',
    });
    // only the document whose file is missing is still without a checksum
    expect(again.counts).toMatchObject({ pending: 1, read: 1, written: 0 });
  });

  it('never overwrites a checksum that exists', async () => {
    const f = fakeDb([row(1, 'a.pdf', 'f'.repeat(64)), row(2, 'b.pdf')]);
    const report = await runHash(options({ apply: true }), {
      db: f.db,
      storage: fakeStorage(files),
      host: 'h',
    });
    expect(report.counts.written).toBe(1);
    expect(f.rows[0].sha).toBe('f'.repeat(64));
  });

  it('without the column a dry run counts all documents and a real run refuses', async () => {
    const f = fakeDb([row(1, 'a.pdf'), row(2, 'b.pdf')], false);
    const report = await runHash(options(), {
      db: f.db,
      storage: fakeStorage(files),
      host: 'h',
    });
    expect(report.columnExists).toBe(false);
    expect(report.counts).toMatchObject({ withAddress: 2, pending: 2 });
    await expect(
      runHash(options({ apply: true }), {
        db: f.db,
        storage: fakeStorage(files),
        host: 'h',
      })
    ).rejects.toThrow(/migration/i);
    expect(f.writes).toEqual([]);
  });

  it('a read needs a storage key', async () => {
    const f = fakeDb([row(1, 'a.pdf')]);
    await expect(
      runHash(options({ limit: 1 }), { db: f.db, storage: null, host: 'h' })
    ).rejects.toThrow(/storage access/i);
  });

  it('the report holds ids, titles and paths, never file contents', async () => {
    const f = fakeDb([row(1, 'a.pdf'), row(2, 'gone.pdf')]);
    const report = await runHash(options({ apply: true }), {
      db: f.db,
      storage: fakeStorage({ 'kfbm/a.pdf': 'SECRET-CONTENT' }),
      host: 'db.example.com',
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-report-'));
    const file = writeReport(report, dir);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain('SECRET-CONTENT');
    expect(JSON.parse(text)).toMatchObject({
      target: 'preview',
      host: 'db.example.com',
      counts: { missing: 1 },
    });
    expect(path.basename(file)).toMatch(/^hash-documents-preview-.*\.json$/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
