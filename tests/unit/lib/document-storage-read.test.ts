/**
 * @jest-environment node
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { readableStorageUrl } from '@/lib/document-storage';

// The server fetches the file of a document (PageIndex, solution ingestion).
// The url comes from a row of content_documents, which may be an old row, so
// it is checked before every fetch: only the own Supabase project, https, no
// credentials, default port, path below /storage/v1/object/ (public or sign).

const SUPABASE = 'https://abc.supabase.co';
const OBJECT = `${SUPABASE}/storage/v1/object`;
const USER = '99999999-9999-4999-8999-999999999999';
const FILE = '1700000000000_skript.pdf';

const check = (raw: unknown, schema?: any) =>
  readableStorageUrl(raw, { supabaseUrl: SUPABASE, schema });

describe('readableStorageUrl accepts', () => {
  it('the public object url of the own project', () => {
    const url = `${OBJECT}/public/content/${USER}/${FILE}`;
    expect(check(url)).toEqual({ ok: true, url });
  });

  it('the public url of a file in another folder or bucket of the own project', () => {
    for (const path of [
      'content/use-cases/FIAE/Aufgabe%201.pdf',
      'content/curriculum/lernfeld-1/skript.pdf',
      'other-bucket/a/b/c.pdf',
    ]) {
      const url = `${OBJECT}/public/${path}`;
      expect(check(url)).toEqual({ ok: true, url });
    }
  });

  it('a signed object url with a token', () => {
    const url = `${OBJECT}/sign/content/${USER}/${FILE}?token=eyJhbGciOi.abc_DEF-123.sig`;
    expect(check(url)).toEqual({ ok: true, url });
  });

  it('the bare path of an upload and returns the public url of it', () => {
    expect(check(`${USER}/${FILE}`)).toEqual({
      ok: true,
      url: `${OBJECT}/public/content/${USER}/${FILE}`,
    });
  });

  it('the bare path with the preview/ prefix only in Preview', () => {
    const path = `preview/${USER}/${FILE}`;
    expect(check(path, 'public_preview')).toEqual({
      ok: true,
      url: `${OBJECT}/public/content/${path}`,
    });
    expect(check(path, 'public')).toMatchObject({ ok: false });
    expect(check(`${USER}/${FILE}`, 'public_preview')).toMatchObject({
      ok: false,
    });
  });
});

describe('readableStorageUrl refuses attack urls', () => {
  const attacks: Array<[string, unknown]> = [
    ['cloud metadata address', 'http://169.254.169.254/latest/meta-data/'],
    [
      'cloud metadata address over https',
      'https://169.254.169.254/storage/v1/object/public/content/a.pdf',
    ],
    ['localhost', 'http://localhost:3000/api/admin'],
    ['localhost without port', 'https://localhost/storage/v1/object/public/a/b'],
    ['loopback address', 'http://127.0.0.1/'],
    ['private address', 'https://10.0.0.5/storage/v1/object/public/a/b.pdf'],
    ['private address 192.168', 'http://192.168.1.1/admin'],
    ['ipv6 loopback', 'http://[::1]/storage/v1/object/public/a/b.pdf'],
    ['ipv6 mapped address', 'http://[::ffff:127.0.0.1]/'],
    ['decimal ip', 'http://2130706433/'],
    ['octal ip', 'http://0177.0.0.1/'],
    ['hex ip', 'http://0x7f.1/'],
    [
      'other host with the right path',
      'https://evil.example/storage/v1/object/public/content/a.pdf',
    ],
    [
      'host that starts like the project',
      'https://abc.supabase.co.evil.example/storage/v1/object/public/content/a.pdf',
    ],
    [
      'host that ends like the project',
      'https://evilabc.supabase.co/storage/v1/object/public/content/a.pdf',
    ],
    [
      'project name as user name of another host',
      'https://abc.supabase.co@evil.example/storage/v1/object/public/content/a.pdf',
    ],
    [
      'other name as user name of the project host',
      'https://evil.example@abc.supabase.co/storage/v1/object/public/content/a.pdf',
    ],
    [
      'user name and password',
      'https://user:secret@abc.supabase.co/storage/v1/object/public/content/a.pdf',
    ],
    [
      'backslash before the host separator',
      'https://evil.example\\@abc.supabase.co/storage/v1/object/public/content/a.pdf',
    ],
    [
      'non standard port',
      `${SUPABASE}:8443/storage/v1/object/public/content/a.pdf`,
    ],
    [
      'default port written out',
      `${SUPABASE}:443/storage/v1/object/public/content/a.pdf`,
    ],
    [
      'http scheme',
      'http://abc.supabase.co/storage/v1/object/public/content/a.pdf',
    ],
    [
      'upper case scheme and host',
      'HTTPS://ABC.SUPABASE.CO/storage/v1/object/public/content/a.pdf',
    ],
    [
      'scheme relative url',
      '//abc.supabase.co/storage/v1/object/public/content/a.pdf',
    ],
    ['file scheme', 'file:///etc/passwd'],
    ['file scheme windows', 'file:///C:/Windows/win.ini'],
    ['ftp scheme', 'ftp://abc.supabase.co/storage/v1/object/public/a/b.pdf'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:application/pdf;base64,AAAA'],
    ['rest api of the project', `${SUPABASE}/rest/v1/profiles?select=*`],
    ['auth api of the project', `${SUPABASE}/auth/v1/admin/users`],
    ['storage list api', `${SUPABASE}/storage/v1/object/list/content`],
    [
      'authenticated object route',
      `${OBJECT}/authenticated/content/${USER}/${FILE}`,
    ],
    ['info route', `${OBJECT}/info/public/content/a.pdf`],
    ['no bucket and file', `${OBJECT}/public/`],
    ['bucket without file', `${OBJECT}/public/content`],
    [
      'dot segments out of the object path',
      `${OBJECT}/public/../../../rest/v1/profiles`,
    ],
    [
      'encoded dot segments',
      `${OBJECT}/public/%2e%2e/%2e%2e/rest/v1/profiles`,
    ],
    ['encoded slash', `${OBJECT}/public/content%2f..%2f..%2fa.pdf`],
    ['encoded backslash', `${OBJECT}/public/content/..%5c..%5ca.pdf`],
    ['encoded nul', `${OBJECT}/public/content/a.pdf%00.png`],
    ['backslash in path', `${OBJECT}/public/content\\..\\a.pdf`],
    ['empty segment', `${OBJECT}/public/content//a.pdf`],
    ['single dot segment', `${OBJECT}/public/content/./a.pdf`],
    ['fragment', `${OBJECT}/public/content/a.pdf#x`],
    ['query on a public url', `${OBJECT}/public/content/a.pdf?next=http://x`],
    ['signed url without token', `${OBJECT}/sign/content/a.pdf`],
    ['signed url with other query', `${OBJECT}/sign/content/a.pdf?x=1`],
    [
      'signed url with extra parameter',
      `${OBJECT}/sign/content/a.pdf?token=abc&url=http://x`,
    ],
    ['space in the url', `${OBJECT}/public/content/a b.pdf`],
    ['newline in the url', `${OBJECT}/public/content/a.pdf\n`],
    ['tab in the url', `${OBJECT}/public/content/a\t.pdf`],
    ['non ascii character', `${OBJECT}/public/content/Aufgabe\u00e4.pdf`],
    ['empty string', ''],
    ['too long', `${OBJECT}/public/content/${'a'.repeat(3000)}.pdf`],
    ['local absolute path', '/etc/passwd'],
    ['local windows path', 'C:\\Windows\\win.ini'],
    ['relative path with dots', '../../etc/passwd'],
    ['bare path of another shape', 'use-cases/FIAE/a.pdf'],
    ['bare path with dot segments', `${USER}/../${FILE}`],
    ['bare path of nested folders', `${USER}/x/${FILE}`],
    ['bare path with a query', `${USER}/${FILE}?x=1`],
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['object', { url: `${OBJECT}/public/content/a.pdf` }],
    ['array', [`${OBJECT}/public/content/a.pdf`]],
  ];

  it.each(attacks)('%s', (_name, raw) => {
    const result = check(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toEqual(expect.any(String));
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('never repeats the url in the reason', () => {
    const result = check('http://169.254.169.254/secret-path');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toMatch(/169|secret-path/);
  });
});

describe('readableStorageUrl without or with a wrong project url', () => {
  const withProject = (supabaseUrl: string | null | undefined) =>
    readableStorageUrl(`${OBJECT}/public/content/a.pdf`, { supabaseUrl });

  it('refuses every url and every path when no project url is configured', () => {
    expect(withProject(null).ok).toBe(false);
    expect(withProject('').ok).toBe(false);
    expect(
      readableStorageUrl(`${USER}/${FILE}`, { supabaseUrl: null }).ok
    ).toBe(false);
  });

  it('refuses a project url that is not usable', () => {
    expect(withProject('not a url').ok).toBe(false);
    expect(withProject('ftp://abc.supabase.co').ok).toBe(false);
    expect(withProject('http://abc.supabase.co').ok).toBe(false);
    expect(withProject('https://abc.supabase.co:8443').ok).toBe(false);
    expect(withProject('https://user:pw@abc.supabase.co').ok).toBe(false);
  });

  it('reads the project url from NEXT_PUBLIC_SUPABASE_URL by default', () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
      expect(readableStorageUrl(`${OBJECT}/public/content/a.pdf`).ok).toBe(
        true
      );
      expect(
        readableStorageUrl('https://evil.example/storage/v1/object/public/a/b')
          .ok
      ).toBe(false);
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      expect(readableStorageUrl(`${OBJECT}/public/content/a.pdf`).ok).toBe(
        false
      );
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });
});

describe('readableStorageUrl for local development', () => {
  const LOCAL = 'http://127.0.0.1:54321';
  const url = `${LOCAL}/storage/v1/object/public/content/a.pdf`;
  const env = process.env as Record<string, string | undefined>;
  const savedNodeEnv = env.NODE_ENV;

  afterEach(() => {
    env.NODE_ENV = savedNodeEnv;
  });

  it('reads from the local Supabase of the Supabase CLI outside production', () => {
    env.NODE_ENV = 'development';
    expect(readableStorageUrl(url, { supabaseUrl: LOCAL })).toEqual({
      ok: true,
      url,
    });
    // nothing else on the machine
    expect(
      readableStorageUrl('http://127.0.0.1:3000/storage/v1/object/public/a/b', {
        supabaseUrl: LOCAL,
      }).ok
    ).toBe(false);
    expect(
      readableStorageUrl('http://localhost:54321/storage/v1/object/public/a/b', {
        supabaseUrl: LOCAL,
      }).ok
    ).toBe(false);
  });

  it('never reads from http in production', () => {
    env.NODE_ENV = 'production';
    expect(readableStorageUrl(url, { supabaseUrl: LOCAL }).ok).toBe(false);
  });

  it('does not read from an http project on another host, not even outside production', () => {
    env.NODE_ENV = 'development';
    const other = 'http://10.0.0.5:54321';
    expect(
      readableStorageUrl(`${other}/storage/v1/object/public/a/b`, {
        supabaseUrl: other,
      }).ok
    ).toBe(false);
  });
});
