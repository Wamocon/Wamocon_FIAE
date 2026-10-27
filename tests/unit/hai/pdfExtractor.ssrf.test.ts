/**
 * @jest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// The storage url of a document row is fetched by the server. Old rows may
// hold any url, so the extractor checks the url before every fetch and never
// follows a redirect. A refused url is a result (success false, rejected true),
// not an exception, so a batch can skip it and go on.

const SUPABASE = 'https://abc.supabase.co';
const GOOD = `${SUPABASE}/storage/v1/object/public/content/1700000000000_a.pdf`;
const USER = '99999999-9999-4999-8999-999999999999';

const mockParse = jest.fn(async (_buffer: unknown, _options?: unknown) => ({
  text: 'Seite eins mit genug Text',
  numpages: 1,
  info: {},
}));
const mockFetch = jest.fn<typeof fetch>();
const savedFetch = global.fetch;
const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

async function load() {
  jest.resetModules();
  jest.doMock('pdf-parse/lib/pdf-parse', () => mockParse);
  return import('@/lib/hai/pdfExtractor');
}

function pdfResponse(init: { status?: number; statusText?: string } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue(pdfResponse());
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  global.fetch = savedFetch;
  if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
});

const attacks = [
  'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
  'http://localhost:3000/api/admin/users',
  'http://127.0.0.1:54321/rest/v1/profiles',
  'https://10.0.0.5/storage/v1/object/public/content/a.pdf',
  'http://[::1]/',
  'http://2130706433/',
  'https://evil.example/storage/v1/object/public/content/a.pdf',
  'https://abc.supabase.co@evil.example/storage/v1/object/public/content/a.pdf',
  'https://evil.example@abc.supabase.co/storage/v1/object/public/content/a.pdf',
  'https://user:pw@abc.supabase.co/storage/v1/object/public/content/a.pdf',
  'https://abc.supabase.co:8443/storage/v1/object/public/content/a.pdf',
  'http://abc.supabase.co/storage/v1/object/public/content/a.pdf',
  'https://abc.supabase.co/rest/v1/profiles',
  'https://abc.supabase.co/storage/v1/object/public/../../../rest/v1/x',
  'file:///etc/passwd',
  'file:///C:/Windows/win.ini',
  '/etc/passwd',
  'C:\\Windows\\win.ini',
  '../../secrets.pdf',
  'use-cases/FIAE/a.pdf',
  '',
];

describe.each([
  ['extractTextFromPDF', 'extractTextFromPDF'],
  ['extractTextByPage', 'extractTextByPage'],
] as const)('%s', (_label, fn) => {
  it.each(attacks)('refuses %s without a request', async url => {
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(url);
    expect(result.success).toBe(false);
    expect(result.rejected).toBe(true);
    expect(result.error).toMatch(/^Storage url rejected: /);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('refuses a url that is no text', async () => {
    const mod = await load();
    const result = await (mod[fn] as (u: unknown) => Promise<any>)(null);
    expect(result).toMatchObject({ success: false, rejected: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not read a local file for a path or file url', async () => {
    const fs = require('fs');
    const exists = jest.spyOn(fs, 'existsSync');
    const read = jest.spyOn(fs, 'readFileSync');
    const mod = await load();
    for (const url of ['file:///etc/passwd', '/etc/passwd', 'C:\\x.pdf']) {
      const result = await (mod[fn] as (u: string) => Promise<any>)(url);
      expect(result.success).toBe(false);
    }
    expect(exists).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('fetches a url of the own project and never follows a redirect', async () => {
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      GOOD,
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('fetches the public url of a bare path', async () => {
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(
      `${USER}/1700000000000_a.pdf`
    );
    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      `${SUPABASE}/storage/v1/object/public/content/${USER}/1700000000000_a.pdf`,
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('fails without reading when the fetch refuses a redirect', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    expect(result.success).toBe(false);
    expect(result.rejected).toBeUndefined();
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('does not use the body of a redirect answer', async () => {
    mockFetch.mockResolvedValue(
      pdfResponse({ status: 302, statusText: 'Found' })
    );
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    expect(result.success).toBe(false);
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('gives the download a time limit', async () => {
    const mod = await load();
    await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not read a file that declares more than 50 MB', async () => {
    mockFetch.mockResolvedValue({
      ...pdfResponse(),
      headers: { get: () => String(60 * 1024 * 1024) },
    } as unknown as Response);
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    expect(result).toMatchObject({ success: false });
    expect(result.error).toMatch(/too large/);
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('does not read a file that is larger than it declared', async () => {
    mockFetch.mockResolvedValue({
      ...pdfResponse(),
      headers: { get: () => '10' },
      arrayBuffer: async () => new ArrayBuffer(51 * 1024 * 1024),
    } as unknown as Response);
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    expect(result).toMatchObject({ success: false });
    expect(mockParse).not.toHaveBeenCalled();
  });

  it('reports a failed download', async () => {
    mockFetch.mockResolvedValue(
      pdfResponse({ status: 404, statusText: 'Not Found' })
    );
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/404/);
  });

  it('refuses everything when the project url is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const mod = await load();
    const result = await (mod[fn] as (u: string) => Promise<any>)(GOOD);
    expect(result).toMatchObject({ success: false, rejected: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('extractFromMultiplePDFs and extractByPageFromMultiplePDFs', () => {
  it('skip a refused url and go on with the others', async () => {
    jest.useFakeTimers();
    try {
      const mod = await load();
      const run = mod.extractFromMultiplePDFs([
        'http://169.254.169.254/',
        GOOD,
      ]);
      await jest.runAllTimersAsync();
      const { results } = await run;
      expect(results.map(r => r.success)).toEqual([false, true]);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      mockFetch.mockClear();
      const runPages = mod.extractByPageFromMultiplePDFs([
        { url: 'file:///etc/passwd', documentId: 'd1', title: 'a' },
        { url: GOOD, documentId: 'd2', title: 'b' },
      ]);
      await jest.runAllTimersAsync();
      const pages = await runPages;
      expect(pages.results.map(r => r.success)).toEqual([false, true]);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
