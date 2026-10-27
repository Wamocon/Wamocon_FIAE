/**
 * @jest-environment node
 */
import { webcrypto } from 'crypto';
import {
  HASH_CONCURRENCY,
  UPLOAD_CONCURRENCY,
  UploadAbortedError,
  UploadApiError,
  candidatesFromFiles,
  createUploadClient,
  makeBatches,
  mapLimit,
  relativePathOf,
  sha256OfFile,
  toHex,
  withRetries,
  type UploadClientDeps,
} from '@/lib/content-upload/staging/client';
import {
  announceFiles,
  completeFiles,
  issueUploadUrls,
  listRunFiles,
} from '@/lib/content-upload/staging/files';
import { pumpRun } from '@/lib/content-upload/staging/queue';
import { resetRateLimits } from '@/lib/rate-limit';
import { getRunWithProgress, loadRun } from '@/lib/content-upload/staging/runs';
import { SUPER, newRun, setup, sha256 } from '../../../helpers/uploadServiceFixtures';

const digest = (data: ArrayBuffer) => webcrypto.subtle.digest('SHA-256', data);

function file(
  name: string,
  content: string | Uint8Array,
  relativePath?: string
): File {
  const f = new File([content as BlobPart], name, {
    lastModified: 1_700_000_000_000,
  });
  if (relativePath) {
    Object.defineProperty(f, 'webkitRelativePath', { value: relativePath });
  }
  return f;
}

const PDF = (tail: string) => `%PDF-1.7\n${tail}`;
const DOCX = (tail: string) =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new TextEncoder().encode(tail)]);

/**
 * A server for the client: the real services on the in-memory repository, behind a
 * fetch that answers like the routes do.
 */
function fakeServer(ctx: ReturnType<typeof setup>, runId: string) {
  const calls: { method: string; path: string; body: any }[] = [];
  let urlStatus: (() => Response | null) | undefined;
  const reply = (
    status: number,
    data: unknown,
    headers: Record<string, string> = {}
  ) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  const fromResult = (result: any) =>
    result.ok
      ? reply(200, result.data)
      : reply(
          result.status,
          { error: result.error, code: result.code },
          result.retryAfterSec
            ? { 'Retry-After': String(result.retryAfterSec) }
            : {}
        );

  const fetchMock = jest.fn(async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const url = new URL(input, 'http://localhost');
    calls.push({ method, path: url.pathname + url.search, body });
    const loaded = await loadRun(ctx.deps, SUPER, runId);
    if (!loaded.ok) return fromResult(loaded);
    const run = loaded.data;
    const tail = url.pathname.replace(
      `/api/trainer/content-upload/runs/${runId}`,
      ''
    );
    if (tail === '' && method === 'GET') {
      return reply(200, await getRunWithProgress(ctx.deps, run));
    }
    if (tail === '/files' && method === 'POST') {
      return fromResult(await announceFiles(ctx.deps, run, body));
    }
    if (tail === '/files' && method === 'GET') {
      return fromResult(
        await listRunFiles(ctx.deps, run, {
          offset: url.searchParams.get('offset'),
          limit: url.searchParams.get('limit'),
        })
      );
    }
    if (tail === '/upload-urls') {
      const override = urlStatus?.();
      if (override) return override;
      return fromResult(await issueUploadUrls(ctx.deps, SUPER, run, body));
    }
    if (tail === '/complete')
      return fromResult(await completeFiles(ctx.deps, run, body));
    if (tail === '/pump') {
      return reply(
        200,
        await pumpRun(ctx.deps, runId, {
          closeUpload: body?.closeUpload === true,
        })
      );
    }
    return reply(404, { error: 'Not found' });
  });
  return {
    fetchMock,
    calls,
    failUrlsOnce(response: () => Response) {
      let used = false;
      urlStatus = () => {
        if (used) return null;
        used = true;
        return response();
      };
    },
  };
}

type Setup = {
  ctx: ReturnType<typeof setup>;
  runId: string;
  server: ReturnType<typeof fakeServer>;
  sleeps: number[];
  uploads: { path: string; size: number }[];
  uploadMock: jest.Mock;
  deps: Partial<UploadClientDeps>;
  stats: { concurrent: number; max: number };
};

async function boot(
  uploadBehavior?: (
    call: number,
    path: string
  ) => Promise<{ error: any } | null>
): Promise<Setup> {
  const ctx = setup();
  const run = await newRun(ctx.deps);
  const server = fakeServer(ctx, run.id);
  const sleeps: number[] = [];
  const uploads: { path: string; size: number }[] = [];
  const stats = { concurrent: 0, max: 0 };
  let calls = 0;
  const uploadMock = jest.fn(
    async (path: string, token: string, blob: Blob, contentType: string) => {
      calls += 1;
      stats.concurrent += 1;
      stats.max = Math.max(stats.max, stats.concurrent);
      try {
        await new Promise(resolve => setImmediate(resolve));
        const custom = await uploadBehavior?.(calls, path);
        if (custom) return custom;
        expect(token).toBe(`token-for-${path}`);
        expect([
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ]).toContain(contentType);
        ctx.mem.put(path, new Uint8Array(await blob.arrayBuffer()));
        uploads.push({ path, size: blob.size });
        return { error: null };
      } finally {
        stats.concurrent -= 1;
      }
    }
  );
  return {
    ctx,
    runId: run.id,
    server,
    sleeps,
    uploads,
    uploadMock,
    stats,
    deps: {
      fetch: server.fetchMock as any,
      uploadToSignedUrl: uploadMock as any,
      digest,
      sleep: async ms => {
        sleeps.push(ms);
      },
    },
  };
}

beforeEach(() => {
  resetRateLimits();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('building blocks', () => {
  it('hashes a file with SHA-256 like the server does', async () => {
    expect(await sha256OfFile(new Blob(['abc']), digest)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(await sha256OfFile(new Blob([PDF('x')]), digest)).toBe(
      sha256(PDF('x'))
    );
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff');
  });

  it('hashes with Web Crypto by default', async () => {
    expect(await sha256OfFile(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('forms batches of at most 50', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(makeBatches(items).map(b => b.length)).toEqual([50, 50, 20]);
    expect(makeBatches([])).toEqual([]);
    expect(makeBatches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(() => makeBatches([1], 0)).toThrow();
  });

  it('works on at most the given number of items at the same time, in order', async () => {
    let running = 0;
    let max = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async n => {
      running += 1;
      max = Math.max(max, running);
      await new Promise(resolve => setImmediate(resolve));
      running -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(max).toBe(3);
    expect(await mapLimit([], 3, async n => n)).toEqual([]);
  });

  it('repeats a failing call up to three times with a growing wait', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls += 1;
          throw new Error('nope');
        },
        { sleep }
      )
    ).rejects.toThrow('nope');
    expect(calls).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);

    sleeps.length = 0;
    calls = 0;
    const value = await withRetries(
      async attempt => {
        calls += 1;
        if (attempt < 2) throw new Error('flaky');
        return 'ok';
      },
      { sleep }
    );
    expect(value).toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('knows the relative path of a folder upload and the name of a single file', () => {
    const a = file('a.pdf', PDF('a'), 'K1/Enabler/a.pdf');
    const b = file('b.docx', DOCX('b'));
    expect(relativePathOf(a)).toBe('K1/Enabler/a.pdf');
    expect(relativePathOf(b)).toBe('b.docx');
    expect(candidatesFromFiles([a, b]).map(c => c.path)).toEqual([
      'K1/Enabler/a.pdf',
      'b.docx',
    ]);
  });
});

describe('uploadFiles', () => {
  function manyFiles(count: number, tag = 'n') {
    return Array.from({ length: count }, (_, i) =>
      i % 3 === 2
        ? file(`f${i}.docx`, DOCX(`${tag} ${i}`), `K1/${tag}/f${i}.docx`)
        : file(`f${i}.pdf`, PDF(`${tag} ${i}`), `K1/${tag}/f${i}.pdf`)
    );
  }

  it('takes 120 files through hash, announce, upload and report in batches of 50', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    const files = manyFiles(120);
    const events: string[] = [];
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(files),
      {
        onProgress: e => events.push(`${e.phase}:${e.done}/${e.total}`),
      }
    );
    expect(summary).toMatchObject({
      announced: 120,
      merged: 0,
      existing: 0,
      uploaded: 120,
      rejected: [],
      failed: [],
    });
    const announceSizes = t.server.calls
      .filter(c => c.path.endsWith('/files') && c.method === 'POST')
      .map(c => c.body.files.length);
    expect(announceSizes).toEqual([50, 50, 20]);
    const urlSizes = t.server.calls
      .filter(c => c.path.endsWith('/upload-urls'))
      .map(c => c.body.fileIds.length);
    expect(urlSizes).toEqual([50, 50, 20]);
    const completeSizes = t.server.calls
      .filter(c => c.path.endsWith('/complete'))
      .map(c => c.body.fileIds.length);
    expect(completeSizes).toEqual([50, 50, 20]);
    expect(t.ctx.mem.objects.size).toBe(120);
    expect(events).toContain('hashing:120/120');
    expect(events).toContain('announcing:120/120');
    expect(events).toContain('uploading:120/120');
    // everything is queued
    const progress = await t.ctx.repo.runProgress(t.runId);
    expect(progress.counts).toEqual({ uploaded: 120 });
  });

  it('reports a file the browser cannot read and uploads all the others', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    const files = manyFiles(5);
    // the browser refuses to read this one (a path over the limit of the system)
    Object.defineProperty(files[1], 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('not readable')),
    });
    const events: string[] = [];
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(files),
      { onProgress: e => events.push(`${e.phase}:${e.done}/${e.total}`) }
    );
    expect(summary.failed).toEqual([
      { path: 'K1/n/f1.pdf', code: 'UNREADABLE' },
    ]);
    expect(summary.announced).toBe(4);
    expect(summary.uploaded).toBe(4);
    expect(events).toContain('hashing:5/5');
    expect(events).toContain('announcing:4/4');
    const announced = t.server.calls
      .filter(c => c.path.endsWith('/files') && c.method === 'POST')
      .flatMap(c => c.body.files.map((f: { path: string }) => f.path));
    expect(announced).toHaveLength(4);
    expect(announced).not.toContain('K1/n/f1.pdf');
  });

  it('sends the announce with path, size, hash and change time of every file', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    const f = file('a.pdf', PDF('content'), 'K1/a.pdf');
    await client.uploadFiles(t.runId, candidatesFromFiles([f]));
    const announce = t.server.calls.find(
      c => c.path.endsWith('/files') && c.method === 'POST'
    )!;
    expect(announce.body.files).toEqual([
      {
        path: 'K1/a.pdf',
        size: f.size,
        sha256: sha256(PDF('content')),
        lastModified: 1_700_000_000_000,
      },
    ]);
  });

  it('calls the app only through the fetch it is given (authFetch), on the upload routes', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    await client.uploadFiles(t.runId, candidatesFromFiles(manyFiles(3)));
    await client.processRun(t.runId);
    await client.getRun(t.runId);
    await client.getRunFiles(t.runId);
    expect(t.server.calls.length).toBeGreaterThan(5);
    for (const c of t.server.calls) {
      expect(
        c.path.startsWith(`/api/trainer/content-upload/runs/${t.runId}`)
      ).toBe(true);
    }
  });

  it('reports refused files and copies, and does not upload a copy', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    const files = [
      file('a.pdf', PDF('same'), 'one/a.pdf'),
      file('copy.pdf', PDF('same'), 'two/copy.pdf'),
      file('sheet.xlsx', 'xlsx', 'one/sheet.xlsx'),
      file('b.docx', DOCX('b'), 'one/b.docx'),
    ];
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(files)
    );
    expect(summary).toMatchObject({
      announced: 2,
      merged: 1,
      uploaded: 2,
      failed: [],
    });
    expect(summary.rejected).toEqual([
      { path: 'one/sheet.xlsx', code: 'UNSUPPORTED_EXTENSION' },
    ]);
    expect(t.uploads).toHaveLength(2);
  });

  it('uploads three files at the same time and no more', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    await client.uploadFiles(t.runId, candidatesFromFiles(manyFiles(12)));
    expect(t.stats.max).toBe(UPLOAD_CONCURRENCY);
    expect(UPLOAD_CONCURRENCY).toBe(3);
    expect(HASH_CONCURRENCY).toBe(3);
  });

  it('repeats a failed upload with a growing wait and succeeds', async () => {
    const t = await boot(async call =>
      call <= 2 ? { error: { message: 'network' } } : null
    );
    const client = createUploadClient(t.deps);
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(manyFiles(1))
    );
    expect(summary.uploaded).toBe(1);
    expect(summary.failed).toEqual([]);
    expect(t.uploadMock).toHaveBeenCalledTimes(3);
    expect(t.sleeps).toEqual([1000, 2000]);
  });

  it('gives up after three repeats and reports the file as failed, the others go on', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    const original = t.uploadMock.getMockImplementation()!;
    let victim: string | undefined;
    t.uploadMock.mockImplementation(async (path, token, blob, type) => {
      victim ??= path;
      if (path === victim) return { error: { message: 'network' } };
      return original(path, token, blob, type);
    });
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(manyFiles(3))
    );
    expect(summary.uploaded).toBe(2);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].code).toBe('UPLOAD_FAILED');
    // four tries for the one that failed: the first and three repeats
    expect(t.uploadMock.mock.calls.filter(c => c[0] === victim)).toHaveLength(
      4
    );
    expect(t.sleeps).toEqual([1000, 2000, 4000]);
    // the file that failed is still announced: a resume gives it a new url
    const rows = await t.ctx.repo.listFiles(t.runId, { offset: 0, limit: 10 });
    expect(rows.filter(r => r.status === 'announced')).toHaveLength(1);
  });

  it('treats "already exists" as done: an earlier try got through', async () => {
    const t = await boot(async (_call, path) => {
      t.ctx.mem.put(path, new TextEncoder().encode(PDF('n 0')));
      return { error: { message: 'The resource already exists' } };
    });
    const client = createUploadClient(t.deps);
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(manyFiles(1))
    );
    expect(summary.uploaded).toBe(1);
    expect(t.uploadMock).toHaveBeenCalledTimes(1);
  });

  it('waits out a 429 on the upload urls (Retry-After) and goes on', async () => {
    const t = await boot();
    t.server.failUrlsOnce(
      () =>
        new Response(
          JSON.stringify({ error: 'Too many', code: 'RATE_LIMITED' }),
          {
            status: 429,
            headers: { 'Retry-After': '12' },
          }
        )
    );
    const client = createUploadClient(t.deps);
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(manyFiles(2))
    );
    expect(summary.uploaded).toBe(2);
    expect(t.sleeps).toContain(12_000);
  });

  it('reports a file the server could not sign a url for', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    const real = t.server.fetchMock.getMockImplementation()!;
    t.server.fetchMock.mockImplementation(async (input, init) => {
      const res = await real(input, init);
      if (!String(input).endsWith('/upload-urls')) return res;
      const data = await res.json();
      data.items[0] = {
        fileId: data.items[0].fileId,
        ok: false,
        code: 'STORAGE_UNAVAILABLE',
      };
      return new Response(JSON.stringify(data), { status: 200 });
    });
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles(manyFiles(2))
    );
    expect(summary.uploaded).toBe(1);
    expect(summary.failed).toEqual([
      { path: 'K1/n/f0.pdf', code: 'STORAGE_UNAVAILABLE' },
    ]);
  });

  it('reports a file that the server rejected after the upload', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    // the first file is announced as a pdf, but the object holds a docx
    t.uploadMock.mockImplementation(async (path, _token, blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const sameLength = new Uint8Array(bytes.length);
      sameLength.set([0x50, 0x4b, 0x03, 0x04]);
      t.ctx.mem.put(path, path.endsWith('.pdf') ? sameLength : bytes);
      return { error: null };
    });
    const summary = await client.uploadFiles(
      t.runId,
      candidatesFromFiles([file('a.pdf', PDF('abcdef'), 'a.pdf')])
    );
    expect(summary.uploaded).toBe(0);
    expect(summary.failed).toEqual([{ path: 'a.pdf', code: 'NOT_A_PDF' }]);
  });

  describe('resuming after an abort', () => {
    it('announces the same files again and uploads only what is missing', async () => {
      const t = await boot();
      const client = createUploadClient(t.deps);
      const files = manyFiles(120);
      const controller = new AbortController();
      let completes = 0;
      const real = t.server.fetchMock.getMockImplementation()!;
      t.server.fetchMock.mockImplementation(async (input, init) => {
        const res = await real(input, init);
        // the page is closed after the first batch was reported as done
        if (String(input).endsWith('/complete') && ++completes === 1)
          controller.abort();
        return res;
      });
      await expect(
        client.uploadFiles(t.runId, candidatesFromFiles(files), {
          signal: controller.signal,
        })
      ).rejects.toBeInstanceOf(UploadAbortedError);
      const firstUploads = t.uploads.length;
      expect(firstUploads).toBeGreaterThanOrEqual(50);
      expect(firstUploads).toBeLessThan(120);

      // the run as the server knows it
      const state = await client.getRunFiles(t.runId);
      expect(state).toHaveLength(120);
      expect(state.filter(f => f.status === 'uploaded').length).toBe(
        firstUploads
      );

      // later: the same files again
      const again = createUploadClient(t.deps);
      const summary = await again.uploadFiles(
        t.runId,
        candidatesFromFiles(files)
      );
      expect(summary.existing).toBe(120);
      expect(summary.alreadyPast).toBe(firstUploads);
      expect(summary.announced).toBe(0);
      expect(summary.uploaded).toBe(120 - firstUploads);
      expect(t.uploads).toHaveLength(120);
      expect(new Set(t.uploads.map(u => u.path)).size).toBe(120);
      expect(t.ctx.mem.objects.size).toBe(120);
      expect((await t.ctx.repo.runProgress(t.runId)).counts).toEqual({
        uploaded: 120,
      });
    });

    it('does nothing the second time when everything is done', async () => {
      const t = await boot();
      const client = createUploadClient(t.deps);
      const files = manyFiles(4);
      await client.uploadFiles(t.runId, candidatesFromFiles(files));
      const before = t.uploadMock.mock.calls.length;
      const summary = await client.uploadFiles(
        t.runId,
        candidatesFromFiles(files)
      );
      expect(summary).toMatchObject({
        existing: 4,
        alreadyPast: 4,
        uploaded: 0,
        announced: 0,
      });
      expect(t.uploadMock.mock.calls.length).toBe(before);
    });

    it('stops at once when it is paused before it starts', async () => {
      const t = await boot();
      const client = createUploadClient(t.deps);
      const controller = new AbortController();
      controller.abort();
      await expect(
        client.uploadFiles(t.runId, candidatesFromFiles(manyFiles(3)), {
          signal: controller.signal,
        })
      ).rejects.toBeInstanceOf(UploadAbortedError);
      expect(t.server.calls).toEqual([]);
    });
  });
});

describe('processRun', () => {
  it('calls the pump until the queue is empty', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    await client.uploadFiles(
      t.runId,
      candidatesFromFiles(
        Array.from({ length: 7 }, (_, i) =>
          file(`f${i}.pdf`, PDF(`p ${i}`), `d/f${i}.pdf`)
        )
      )
    );
    const seen: boolean[] = [];
    const last = await client.processRun(t.runId, {
      onProgress: r => seen.push(r.done),
    });
    expect(last).toMatchObject({ done: true, runStatus: 'review' });
    expect(seen[seen.length - 1]).toBe(true);
    const pumpCalls = t.server.calls.filter(c => c.path.endsWith('/pump'));
    expect(pumpCalls.every(c => c.body.closeUpload === true)).toBe(true);
    expect((await t.ctx.repo.runProgress(t.runId)).counts).toEqual({
      verified: 7,
    });
  });

  it('waits when nothing could be taken and goes on, and pauses on abort', async () => {
    const t = await boot();
    const client = createUploadClient(t.deps);
    const answers = [
      { processed: 0, done: false },
      { processed: 0, done: false },
      { processed: 2, done: true, runStatus: 'review' },
    ];
    jest
      .spyOn(client, 'pump')
      .mockImplementation(async () => answers.shift() as any);
    const last = await client.processRun(t.runId, { idleMs: 1234 });
    expect(last.done).toBe(true);
    expect(t.sleeps).toEqual([1234, 1234]);

    const controller = new AbortController();
    jest.spyOn(client, 'pump').mockImplementation(async () => {
      controller.abort();
      return { processed: 1, done: false } as any;
    });
    const paused = await client.processRun(t.runId, {
      signal: controller.signal,
    });
    expect(paused.done).toBe(false);

    const never = new AbortController();
    never.abort();
    await expect(
      client.processRun(t.runId, { signal: never.signal })
    ).rejects.toBeInstanceOf(UploadAbortedError);
  });
});

describe('errors of the routes', () => {
  it('turns a failed answer into an UploadApiError with status, code and Retry-After', async () => {
    const client = createUploadClient({
      fetch: async () =>
        new Response(
          JSON.stringify({ error: 'Too many', code: 'RATE_LIMITED' }),
          {
            status: 429,
            headers: { 'Retry-After': '30' },
          }
        ),
    });
    const error = await client.getRun('x').catch(e => e);
    expect(error).toBeInstanceOf(UploadApiError);
    expect(error).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSec: 30,
      message: 'Too many',
    });
  });

  it('copes with an answer that is not JSON', async () => {
    const client = createUploadClient({
      fetch: async () => new Response('<html>', { status: 502 }),
    });
    const error = await client.listRuns().catch(e => e);
    expect(error).toMatchObject({
      status: 502,
      message: 'Request failed (502)',
    });
  });

  it('creates a run with the declaration and discards it', async () => {
    const sent: any[] = [];
    const client = createUploadClient({
      fetch: async (input, init) => {
        sent.push([
          input,
          init?.method,
          init?.body ? JSON.parse(String(init.body)) : null,
        ]);
        return new Response(JSON.stringify({ run: { id: 'r1' } }), {
          status: 201,
        });
      },
    });
    await client.createRun({ label: 'Lauf', kiEnabled: false });
    await client.discardRun('r1');
    expect(sent).toEqual([
      [
        '/api/trainer/content-upload/runs',
        'POST',
        { label: 'Lauf', declarationAccepted: true, kiEnabled: false },
      ],
      ['/api/trainer/content-upload/runs/r1/discard', 'POST', {}],
    ]);
  });

  it('gives up on a 429 for the urls after three waits', async () => {
    const sleeps: number[] = [];
    const client = createUploadClient({
      fetch: async () =>
        new Response(JSON.stringify({ error: 'x', code: 'RATE_LIMITED' }), {
          status: 429,
          headers: { 'Retry-After': '100' },
        }),
      sleep: async ms => {
        sleeps.push(ms);
      },
    });
    await expect(client.requestUrls('r', ['a'])).rejects.toMatchObject({
      status: 429,
    });
    // never longer than 65 seconds, three waits
    expect(sleeps).toEqual([65_000, 65_000, 65_000]);
  });

  it('pages through a long list of files', async () => {
    const pages: string[] = [];
    const client = createUploadClient({
      fetch: async input => {
        pages.push(String(input));
        const offset = Number(
          new URL(String(input), 'http://x').searchParams.get('offset')
        );
        const count = offset === 0 ? 500 : 20;
        return new Response(
          JSON.stringify({
            files: Array.from({ length: count }, (_, i) => ({
              id: `${offset + i}`,
            })),
          }),
          { status: 200 }
        );
      },
    });
    expect(await client.getRunFiles('r')).toHaveLength(520);
    expect(pages).toHaveLength(2);
  });
});
