/**
 * @jest-environment node
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  SOLUTION_PDF_MAX_BYTES,
  readPrivateSolution,
  solutionStorageOrigin,
  solutionStorageProblems,
} from '@/lib/hai/privateSolutionReader';

// The reader of the private model solutions: the bytes of ONE object of the
// bucket content-solutions, fetched with the server key. No real network: the
// fetch is a stub. The key and the address never appear in a result.

const BASE = 'https://abc.supabase.co';
const KEY = 'sb_secret_TESTKEY_never_in_output';
const OBJECT = {
  bucket: 'content-solutions' as const,
  path: 'preview/kfbm/UC-01/musterloesung/loesung.pdf',
};
const PREFIX = 'preview/kfbm/';

const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

function config(extra: Record<string, unknown> = {}) {
  return {
    supabaseUrl: BASE,
    secretKey: KEY,
    prefix: PREFIX,
    ...extra,
  };
}

function stubFetch(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>
) {
  return jest.fn(async (url: unknown, init?: RequestInit) =>
    respond(String(url), init ?? {})
  ) as unknown as typeof fetch & jest.Mock;
}

const ok = (bytes: Uint8Array | Buffer = PDF_BYTES) =>
  new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
  });

beforeEach(() => jest.clearAllMocks());

describe('solutionStorageOrigin', () => {
  it('takes the https address of the hosted project', () => {
    expect(solutionStorageOrigin('https://abc.supabase.co')).toBe(
      'https://abc.supabase.co'
    );
    expect(solutionStorageOrigin('https://abc.supabase.co/rest/v1/')).toBe(
      'https://abc.supabase.co'
    );
  });

  it('takes a local address only when the run is local', () => {
    expect(solutionStorageOrigin('http://localhost:54321')).toBeNull();
    expect(solutionStorageOrigin('http://localhost:54321', true)).toBe(
      'http://localhost:54321'
    );
    expect(solutionStorageOrigin('http://127.0.0.1:54321', true)).toBe(
      'http://127.0.0.1:54321'
    );
  });

  it.each([
    undefined,
    '',
    'not an address',
    'http://abc.supabase.co',
    'https://user:pass@abc.supabase.co',
    'https://abc.supabase.co:8443',
    'https://localhost',
    'https://127.0.0.1',
    'ftp://abc.supabase.co',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://evil.example',
  ])('refuses %p', value => {
    expect(solutionStorageOrigin(value as never)).toBeNull();
    expect(solutionStorageOrigin(value as never, true)).toBeNull();
  });
});

describe('readPrivateSolution', () => {
  it('fetches one object of the bucket with the key, as an authenticated read', async () => {
    const fetchImpl = stubFetch(() => ok());
    const result = await readPrivateSolution(OBJECT, config({ fetchImpl }));
    expect(result).toEqual({ ok: true, buffer: PDF_BYTES });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${BASE}/storage/v1/object/authenticated/content-solutions/preview/kfbm/UC-01/musterloesung/loesung.pdf`
    );
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers.apikey).toBe(KEY);
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('never follows a redirect and does not cache', async () => {
    const fetchImpl = stubFetch(() => ok());
    await readPrivateSolution(OBJECT, config({ fetchImpl }));
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeDefined();
  });

  it('percent-encodes each segment of the path (the alphabet is strict anyway)', async () => {
    const fetchImpl = stubFetch(() => ok());
    await readPrivateSolution(
      { bucket: OBJECT.bucket, path: 'preview/kfbm/a_b-c.1/x.pdf' },
      config({ fetchImpl })
    );
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(
      /\/preview\/kfbm\/a_b-c\.1\/x\.pdf$/
    );
  });

  it.each([
    ['another bucket', { bucket: 'content', path: OBJECT.path }],
    [
      'a path outside the folder',
      { bucket: OBJECT.bucket, path: 'kfbm/a.pdf' },
    ],
    [
      'a path with dot segments',
      { bucket: OBJECT.bucket, path: 'preview/kfbm/../kfbm/a.pdf' },
    ],
    [
      'a path with a query',
      { bucket: OBJECT.bucket, path: 'preview/kfbm/a.pdf?token=1' },
    ],
    [
      'a file that is no pdf',
      { bucket: OBJECT.bucket, path: 'preview/kfbm/a.txt' },
    ],
    [
      'an encoded separator',
      { bucket: OBJECT.bucket, path: 'preview/kfbm/a%2Fb.pdf' },
    ],
  ])('does not fetch anything for %s', async (_name, object) => {
    const fetchImpl = stubFetch(() => ok());
    const result = await readPrivateSolution(
      object as never,
      config({ fetchImpl })
    );
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'http://abc.supabase.co',
    'https://user:pass@abc.supabase.co',
    'https://abc.supabase.co:8443',
    'http://localhost:54321',
    '',
  ])(
    'does not fetch from the address %p (the key goes nowhere else)',
    async url => {
      const fetchImpl = stubFetch(() => ok());
      const result = await readPrivateSolution(
        OBJECT,
        config({ fetchImpl, supabaseUrl: url })
      );
      expect(result.ok).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it('reads from a local storage only when the run is local', async () => {
    const fetchImpl = stubFetch(() => ok());
    const result = await readPrivateSolution(
      { bucket: OBJECT.bucket, path: 'kfbm/a.pdf' },
      config({
        fetchImpl,
        supabaseUrl: 'http://127.0.0.1:54321',
        prefix: 'kfbm/',
        allowLoopback: true,
      })
    );
    expect(result.ok).toBe(true);
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(
      /^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/authenticated\//
    );
  });

  it('does not fetch without a key', async () => {
    const fetchImpl = stubFetch(() => ok());
    for (const secretKey of ['', undefined]) {
      const result = await readPrivateSolution(
        OBJECT,
        config({ fetchImpl, secretKey })
      );
      expect(result.ok).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives a plain error for a refusal of the storage, without address, path or key', async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      const fetchImpl = stubFetch(
        () => new Response(`body with ${KEY} and ${OBJECT.path}`, { status })
      );
      const result = await readPrivateSolution(OBJECT, config({ fetchImpl }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain(String(status));
        expect(result.error).not.toContain(KEY);
        expect(result.error).not.toContain(OBJECT.path);
        expect(result.error).not.toContain('abc.supabase');
      }
    }
  });

  it('treats a redirect response and a network error as a failure without details', async () => {
    const redirect = stubFetch(() => new Response(null, { status: 302 }));
    expect(
      (await readPrivateSolution(OBJECT, config({ fetchImpl: redirect }))).ok
    ).toBe(false);
    const boom = stubFetch(() => {
      throw new TypeError(`fetch failed ${KEY} ${BASE}`);
    });
    const result = await readPrivateSolution(
      OBJECT,
      config({ fetchImpl: boom })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain(KEY);
      expect(result.error).not.toContain('supabase');
    }
  });

  it('refuses a file above the size limit by its declared length, without reading it', async () => {
    const arrayBuffer = jest.fn();
    const fetchImpl = stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({
            'content-length': String(SOLUTION_PDF_MAX_BYTES + 1),
          }),
          arrayBuffer,
          body: null,
        }) as unknown as Response
    );
    const result = await readPrivateSolution(OBJECT, config({ fetchImpl }));
    expect(result).toEqual({ ok: false, error: 'The file is too large.' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('stops reading a stream that grows past the limit (a wrong declared length)', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
        if (pulled > 100_000) controller.close();
      },
    });
    const fetchImpl = stubFetch(() => new Response(stream, { status: 200 }));
    const result = await readPrivateSolution(
      OBJECT,
      config({ fetchImpl, maxBytes: 4096 })
    );
    expect(result).toEqual({ ok: false, error: 'The file is too large.' });
    expect(pulled).toBeLessThan(50);
  });

  it('refuses a file that is no PDF even if the name says so', async () => {
    for (const bytes of [
      Buffer.from('<html>login</html>'),
      Buffer.from('PK\u0003\u0004 docx'),
      Buffer.alloc(0),
      Buffer.from('%PDF'),
    ]) {
      const fetchImpl = stubFetch(() => ok(bytes));
      const result = await readPrivateSolution(OBJECT, config({ fetchImpl }));
      expect(result).toEqual({ ok: false, error: 'The file is no PDF.' });
    }
  });
});

describe('readPrivateSolutionText', () => {
  const textOf = (text: string, pages = 3) => ({
    parse: jest.fn(async () => ({ text, numpages: pages })),
  });

  async function read(
    parse: jest.Mock,
    fetchImpl: typeof fetch,
    extra: Record<string, unknown> = {}
  ) {
    jest.resetModules();
    jest.doMock('pdf-parse/lib/pdf-parse', () => parse);
    const mod = await import('@/lib/hai/privateSolutionReader');
    return mod.readPrivateSolutionText(OBJECT, config({ fetchImpl, ...extra }));
  }

  it('gives the cleaned text and the pages of a PDF', async () => {
    const { parse } = textOf('Schritt 1: Fahrtkosten\n\n12\n\nSeite 2 von 3');
    const result = await read(
      parse as never,
      stubFetch(() => ok())
    );
    expect(result).toEqual({
      ok: true,
      text: 'Schritt 1: Fahrtkosten',
      pageCount: 3,
    });
  });

  it('gives an error and no text when the file is no PDF or cannot be parsed', async () => {
    const { parse } = textOf('x');
    const html = await read(
      parse as never,
      stubFetch(() => ok(Buffer.from('<html></html>')))
    );
    expect(html).toEqual({ ok: false, error: 'The file is no PDF.' });
    expect(parse).not.toHaveBeenCalled();

    const broken = jest.fn(async () => {
      throw new Error(`parse error with ${KEY}`);
    });
    const failed = await read(
      broken as never,
      stubFetch(() => ok())
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).not.toContain(KEY);
  });

  it('refuses a text that is far too long (one file must not be a cost trap)', async () => {
    const { parse } = textOf('a '.repeat(300_000));
    const result = await read(
      parse as never,
      stubFetch(() => ok())
    );
    expect(result).toEqual({ ok: false, error: 'The text is too long.' });
  });
});

describe('solutionStorageProblems', () => {
  const base = {
    target: 'preview' as const,
    supabaseUrl: BASE,
    secretKey: KEY,
    confirmedHost: 'abc.supabase.co',
  };

  it('has no problem for a hosted project, a key and the confirmed host', () => {
    expect(solutionStorageProblems(base)).toEqual([]);
    expect(solutionStorageProblems({ ...base, target: 'production' })).toEqual(
      []
    );
  });

  it('needs the secret key', () => {
    expect(
      solutionStorageProblems({ ...base, secretKey: undefined }).join()
    ).toMatch(/secret key/i);
  });

  it('needs the host to be confirmed, and the right one', () => {
    expect(
      solutionStorageProblems({ ...base, confirmedHost: null }).join()
    ).toMatch(/confirm-storage-host/);
    expect(
      solutionStorageProblems({ ...base, confirmedHost: 'other.supabase.co' })
        .length
    ).toBeGreaterThan(0);
  });

  it('keeps local and hosted apart', () => {
    expect(
      solutionStorageProblems({
        ...base,
        target: 'local',
        supabaseUrl: 'http://localhost:54321',
        confirmedHost: 'localhost:54321',
      })
    ).toEqual([]);
    expect(
      solutionStorageProblems({ ...base, target: 'local' }).length
    ).toBeGreaterThan(0);
    expect(
      solutionStorageProblems({
        ...base,
        target: 'preview',
        supabaseUrl: 'http://localhost:54321',
        confirmedHost: 'localhost:54321',
      }).length
    ).toBeGreaterThan(0);
  });

  it('never repeats the key in a problem', () => {
    const all = [
      ...solutionStorageProblems({ ...base, supabaseUrl: 'nope' }),
      ...solutionStorageProblems({ ...base, confirmedHost: null }),
    ].join('\n');
    expect(all).not.toContain(KEY);
  });
});
