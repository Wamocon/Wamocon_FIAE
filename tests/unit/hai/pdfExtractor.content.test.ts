/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

// A PDF of the bucket content is read with the secret key straight from the
// storage (public and private bucket alike). Without the key the extractor keeps
// the way it had before: the checked public address is fetched.

const SUPABASE = 'https://abc.supabase.co';
const PATH = 'preview/kfbm/K6.2-d/szenario/a.pdf';
const PUBLIC = `${SUPABASE}/storage/v1/object/public/content/${PATH}`;

const mockParse = jest.fn(async (_buffer: unknown, _options?: unknown) => ({
  text: 'Seite eins mit genug Text',
  numpages: 1,
  info: {},
}));
const mockFetch = jest.fn<typeof fetch>();
const download =
  jest.fn<(path: string) => Promise<{ data: unknown; error: unknown }>>();
const savedFetch = global.fetch;
const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const savedKey = process.env.SUPABASE_SECRET_KEY;

async function load(withKey: boolean) {
  jest.resetModules();
  jest.doMock('pdf-parse/lib/pdf-parse', () => mockParse);
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({
      storage: {
        from: (bucket: string) => ({
          download: (p: string) => {
            expect(bucket).toBe('content');
            return download(p);
          },
        }),
      },
    }),
  }));
  if (withKey) process.env.SUPABASE_SECRET_KEY = 'sb-secret';
  else delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  return import('@/lib/hai/pdfExtractor');
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  global.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as Response);
  download.mockResolvedValue({
    data: { size: 8, arrayBuffer: async () => new ArrayBuffer(8) },
    error: null,
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  global.fetch = savedFetch;
  if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
  if (savedKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = savedKey;
});

describe('pdfExtractor reads a file of the bucket content with the secret key', () => {
  it.each([
    ['the public url', PUBLIC],
    ['the private reference', `private://content/${PATH}`],
    ['the bare path', PATH],
  ])(
    '%s: the bytes come from the storage, no public request is made',
    async (_n, ref) => {
      const { extractTextByPage, extractTextFromPDF } = await load(true);
      const byPage = await extractTextByPage(ref);
      expect(byPage.success).toBe(true);
      const whole = await extractTextFromPDF(ref);
      expect(whole.success).toBe(true);
      expect(download).toHaveBeenCalledWith(PATH);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  );

  it('a private bucket: the public address would not answer, the read still works', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response);
    const { extractTextByPage } = await load(true);
    expect((await extractTextByPage(PUBLIC)).success).toBe(true);
  });

  it('a failing storage is a failed result, the public address is not tried', async () => {
    download.mockResolvedValue({ data: null, error: new Error('missing') });
    const { extractTextByPage } = await load(true);
    const result = await extractTextByPage(PUBLIC);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to read PDF');
    expect(result.error).not.toContain(PATH);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('a file that is too large is refused', async () => {
    download.mockResolvedValue({
      data: {
        size: 60 * 1024 * 1024,
        arrayBuffer: async () => new ArrayBuffer(8),
      },
      error: null,
    });
    const { extractTextByPage } = await load(true);
    expect((await extractTextByPage(PUBLIC)).success).toBe(false);
  });

  it('without the secret key the checked public address is fetched as before', async () => {
    const { extractTextByPage } = await load(false);
    expect((await extractTextByPage(PUBLIC)).success).toBe(true);
    expect(download).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      PUBLIC,
      expect.objectContaining({ redirect: 'error' })
    );
  });

  it('without the key a private reference has no address to fetch: refused, no request', async () => {
    const { extractTextByPage } = await load(false);
    const result = await extractTextByPage(`private://content/${PATH}`);
    expect(result.success).toBe(false);
    expect(result.rejected).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('an address that is no file of the bucket content never goes to the storage client', async () => {
    const { extractTextByPage } = await load(true);
    for (const url of [
      'https://evil.example/storage/v1/object/public/content/a.pdf',
      'http://169.254.169.254/latest/meta-data/',
      `${SUPABASE}/storage/v1/object/public/content/../x.pdf`,
      'private://content-solutions/preview/kfbm/x.pdf',
    ]) {
      const result = await extractTextByPage(url);
      expect(result.success).toBe(false);
    }
    expect(download).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
