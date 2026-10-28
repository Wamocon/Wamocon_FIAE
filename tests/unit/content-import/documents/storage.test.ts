import { describe, expect, it } from '@jest/globals';

import { ImportAbort } from '@/lib/content-import/apply/db';
import { parseDocumentsArgs } from '@/lib/content-import/documents/args';
import { runDocumentJob } from '@/lib/content-import/documents/job';
import {
  CONTENT_BUCKET,
  SOLUTIONS_BUCKET,
  SOLUTIONS_BUCKET_SETTINGS,
  StorageError,
  bucketOf,
  checkConfirmStorageHost,
  checkStorageTarget,
  createSupabaseStorage,
  parsePrivateReference,
  privateReference,
  publicObjectUrl,
  safeFileName,
  storagePathFor,
  storagePrefix,
} from '@/lib/content-import/documents/storage';
import { documentPublicUrl, readableStorageUrl } from '@/lib/document-storage';

const SUPABASE = 'https://proj.supabase.co';
const KEY = 'sb-secret-key-value';

describe('paths and urls', () => {
  it('has its own prefix per target', () => {
    expect(storagePrefix('preview')).toBe('preview/kfbm/');
    expect(storagePrefix('local')).toBe('kfbm/');
  });

  it('turns a file name into one that the storage takes', () => {
    expect(safeFileName('24_2e).pdf')).toBe('24_2e.pdf');
    expect(safeFileName('UC_6d_Störungen_Musterlösung.pdf')).toBe(
      'UC_6d_Stoerungen_Musterloesung.pdf'
    );
    expect(safeFileName('Szenario_23c (aus 23b).pdf')).toBe(
      'Szenario_23c_aus_23b.pdf'
    );
    expect(safeFileName('Maßnahmen é.pdf')).toBe('Massnahmen_e.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(safeFileName('???')).toBe('document.pdf');
    expect(safeFileName('a b.pdf')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('puts a file under the enabler and the folder of its kind', () => {
    const item = (kind: any) => ({
      enablerCode: 'K6.2-d',
      kind,
      rel: 'x/y/Datei Ä.pdf',
    });
    expect(storagePathFor('preview', item('enabler'))).toBe(
      'preview/kfbm/K6.2-d/enabler/Datei_Ae.pdf'
    );
    expect(storagePathFor('local', item('scenario'))).toBe(
      'kfbm/K6.2-d/szenario/Datei_Ae.pdf'
    );
    expect(storagePathFor('local', item('usecase_task'))).toContain(
      '/aufgabe/'
    );
    expect(storagePathFor('local', item('usecase_solution'))).toContain(
      '/musterloesung/'
    );
  });

  it('chooses the private bucket for the model solutions only', () => {
    expect(bucketOf('usecase_solution')).toBe(SOLUTIONS_BUCKET);
    for (const kind of ['enabler', 'scenario', 'usecase_task'] as const) {
      expect(bucketOf(kind)).toBe(CONTENT_BUCKET);
    }
    expect(SOLUTIONS_BUCKET_SETTINGS).toMatchObject({
      name: 'content-solutions',
      public: false,
      allowedMimeTypes: ['application/pdf'],
    });
  });

  it('the public url is the one of every FIAE row', () => {
    const path = 'preview/kfbm/K6.2-d/enabler/a.pdf';
    expect(publicObjectUrl(SUPABASE, CONTENT_BUCKET, path)).toBe(
      documentPublicUrl(path, { supabaseUrl: SUPABASE })
    );
    // and the server may read it like any other file of the project
    expect(
      readableStorageUrl(publicObjectUrl(SUPABASE, CONTENT_BUCKET, path), {
        supabaseUrl: SUPABASE,
      }).ok
    ).toBe(true);
  });

  it('a private reference is no url: the server never fetches it', () => {
    const ref = privateReference(SOLUTIONS_BUCKET, 'preview/kfbm/K1-a/x.pdf');
    expect(ref).toBe('private://content-solutions/preview/kfbm/K1-a/x.pdf');
    expect(parsePrivateReference(ref)).toEqual({
      bucket: 'content-solutions',
      path: 'preview/kfbm/K1-a/x.pdf',
    });
    expect(readableStorageUrl(ref, { supabaseUrl: SUPABASE }).ok).toBe(false);
    for (const bad of [
      'https://proj.supabase.co/x.pdf',
      'private://bucket',
      'private:///x',
      'private://bucket/',
      '',
      null,
      42,
    ]) {
      expect(parsePrivateReference(bad)).toBeNull();
    }
  });
});

describe('checkStorageTarget', () => {
  it('a local database gets a local storage, the Preview the hosted https project', () => {
    expect(checkStorageTarget('local', 'http://127.0.0.1:54321')).toEqual([]);
    expect(checkStorageTarget('local', 'http://localhost:54321')).toEqual([]);
    expect(checkStorageTarget('local', SUPABASE)).not.toEqual([]);
    expect(checkStorageTarget('preview', SUPABASE)).toEqual([]);
    expect(checkStorageTarget('preview', 'http://127.0.0.1:54321')).not.toEqual(
      []
    );
    expect(
      checkStorageTarget('preview', 'http://proj.supabase.co')
    ).not.toEqual([]);
  });

  it('refuses a missing, broken or credentialed address', () => {
    expect(checkStorageTarget('preview', null)).not.toEqual([]);
    expect(checkStorageTarget('preview', '')).not.toEqual([]);
    expect(checkStorageTarget('preview', 'not an address')).not.toEqual([]);
    expect(
      checkStorageTarget('preview', 'https://user:pw@proj.supabase.co')
    ).not.toEqual([]);
  });
});

describe('checkConfirmStorageHost', () => {
  it('wants the host of the storage address, case does not matter', () => {
    expect(checkConfirmStorageHost('proj.supabase.co', SUPABASE)).toEqual([]);
    expect(checkConfirmStorageHost('PROJ.supabase.co', SUPABASE)).toEqual([]);
    expect(
      checkConfirmStorageHost('127.0.0.1:54321', 'http://127.0.0.1:54321')
    ).toEqual([]);
    expect(checkConfirmStorageHost('other.supabase.co', SUPABASE)).not.toEqual(
      []
    );
    expect(checkConfirmStorageHost(null, SUPABASE)).not.toEqual([]);
    expect(checkConfirmStorageHost('', SUPABASE)).not.toEqual([]);
    expect(checkConfirmStorageHost('proj.supabase.co', null)).not.toEqual([]);
  });
});

describe('createSupabaseStorage', () => {
  type Call = { url: string; init: RequestInit };
  function fakeFetch(status: number | ((call: Call) => number)) {
    const calls: Call[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      const code = typeof status === 'function' ? status(call) : status;
      return { ok: code >= 200 && code < 300, status: code } as Response;
    }) as unknown as typeof fetch;
    return { calls, impl };
  }

  it('puts an object with the key, the type and the upsert flag, and follows no redirect', async () => {
    const f = fakeFetch(200);
    const storage = createSupabaseStorage({
      url: `${SUPABASE}/`,
      key: KEY,
      fetchImpl: f.impl,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    await storage.put(
      'content',
      'preview/kfbm/K1-a/a b.pdf',
      bytes,
      'application/pdf',
      {
        upsert: false,
      }
    );
    await storage.put('content', 'p.pdf', bytes, 'application/pdf', {
      upsert: true,
    });
    expect(f.calls[0].url).toBe(
      `${SUPABASE}/storage/v1/object/content/preview/kfbm/K1-a/a%20b.pdf`
    );
    expect(f.calls[0].init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      body: bytes,
    });
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': 'application/pdf',
      'x-upsert': 'false',
    });
    expect(
      (f.calls[1].init.headers as Record<string, string>)['x-upsert']
    ).toBe('true');
  });

  it('an error names the status only, never the key or the address', async () => {
    const storage = createSupabaseStorage({
      url: SUPABASE,
      key: KEY,
      fetchImpl: fakeFetch(409).impl,
    });
    const error = await storage
      .put('content', 'a.pdf', new Uint8Array([1]), 'application/pdf', {
        upsert: false,
      })
      .catch(e => e);
    expect(error).toBeInstanceOf(StorageError);
    expect(error.code).toBe('HTTP_409');
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain('supabase.co');
  });

  it('asks whether an object exists: 200 yes, 404 and 400 no, anything else is an error', async () => {
    for (const [status, answer] of [
      [200, true],
      [404, false],
      [400, false],
    ] as const) {
      const storage = createSupabaseStorage({
        url: SUPABASE,
        key: KEY,
        fetchImpl: fakeFetch(status).impl,
      });
      expect(await storage.exists('content-solutions', 'a/b.pdf')).toBe(answer);
    }
    const f = fakeFetch(200);
    await createSupabaseStorage({
      url: SUPABASE,
      key: KEY,
      fetchImpl: f.impl,
    }).exists('content', 'a/b.pdf');
    expect(f.calls[0].url).toBe(
      `${SUPABASE}/storage/v1/object/info/content/a/b.pdf`
    );
    const broken = createSupabaseStorage({
      url: SUPABASE,
      key: KEY,
      fetchImpl: fakeFetch(500).impl,
    });
    await expect(broken.exists('content', 'a.pdf')).rejects.toMatchObject({
      code: 'HTTP_500',
    });
  });

  it('removes objects with one call, and nothing for an empty list', async () => {
    const f = fakeFetch(200);
    const storage = createSupabaseStorage({
      url: SUPABASE,
      key: KEY,
      fetchImpl: f.impl,
    });
    await storage.remove('content', []);
    expect(f.calls).toHaveLength(0);
    await storage.remove('content', ['a.pdf', 'b.pdf']);
    expect(f.calls[0].url).toBe(`${SUPABASE}/storage/v1/object/content`);
    expect(f.calls[0].init.method).toBe('DELETE');
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({
      prefixes: ['a.pdf', 'b.pdf'],
    });
    const broken = createSupabaseStorage({
      url: SUPABASE,
      key: KEY,
      fetchImpl: fakeFetch(403).impl,
    });
    await expect(broken.remove('content', ['a.pdf'])).rejects.toMatchObject({
      code: 'HTTP_403',
    });
  });
});

describe('parseDocumentsArgs', () => {
  const uuid = '11111111-2222-4333-8444-555555555555';
  const ok = (argv: string[]) => {
    const parsed = parseDocumentsArgs(argv);
    expect(parsed).toMatchObject({ ok: true });
    return (parsed as any).args;
  };
  const refused = (argv: string[]) => {
    const parsed = parseDocumentsArgs(argv);
    expect(parsed.ok).toBe(false);
    return (parsed as any).errors.join(' | ');
  };

  it('takes plan, check and run with a source folder', () => {
    expect(
      ok(['plan', 'src', '--out', 'p.json', '--components', 'k6.2,K1'])
    ).toMatchObject({
      command: 'plan',
      source: 'src',
      components: ['K6.2', 'K1'],
      overwriteFiles: false,
    });
    expect(
      ok(['check', 'src', '--target', 'local', '--created-by', uuid])
    ).toMatchObject({
      command: 'check',
      target: 'local',
    });
    expect(
      ok(['run', 'src', '--target', 'local', '--created-by', uuid])
    ).toMatchObject({
      apply: false,
    });
    expect(
      ok([
        'run',
        'src',
        '--target',
        'preview',
        '--created-by',
        uuid,
        '--apply',
        '--confirm-host',
        'H.example',
        '--confirm-storage-host=Proj.supabase.co',
        '--overwrite-files',
      ])
    ).toMatchObject({
      apply: true,
      overwriteFiles: true,
      confirmHost: 'h.example',
      confirmStorageHost: 'proj.supabase.co',
    });
  });

  it('refuses production in every spelling, a missing target, author or source', () => {
    expect(
      refused(['check', 'src', '--target', 'production', '--created-by', uuid])
    ).toMatch(/Production/);
    expect(refused(['check', 'src', '--created-by', uuid])).toMatch(/--target/);
    expect(refused(['check', 'src', '--target', 'local'])).toMatch(
      /--created-by/
    );
    expect(refused(['plan'])).toMatch(/source folder/);
    expect(refused(['run', '--target', 'local', '--created-by', uuid])).toMatch(
      /source folder/
    );
    expect(refused([])).toMatch(/first argument/);
  });

  it('knows no plan file, no decisions, no update of rows and no scenario solutions', () => {
    const base = ['run', 'src', '--target', 'local', '--created-by', uuid];
    for (const flag of ['--update-existing', '--scenario-solutions']) {
      expect(refused([...base, flag])).toContain(`Unknown argument: ${flag}`);
    }
    expect(refused([...base, '--plan', 'x.json'])).toContain(
      'Unknown argument: --plan'
    );
    expect(refused([...base, '--decisions', 'd.json'])).toContain(
      'Unknown argument: --decisions'
    );
  });

  it('--overwrite-files belongs to run --apply, the Preview needs the confirmed host', () => {
    expect(
      refused([
        'run',
        'src',
        '--target',
        'local',
        '--created-by',
        uuid,
        '--overwrite-files',
      ])
    ).toMatch(/overwrite-files belongs to run --apply/);
    expect(
      refused([
        'check',
        'src',
        '--target',
        'local',
        '--created-by',
        uuid,
        '--overwrite-files',
      ])
    ).toMatch(/overwrite-files/);
    expect(
      refused([
        'run',
        'src',
        '--target',
        'preview',
        '--created-by',
        uuid,
        '--apply',
      ])
    ).toMatch(/confirm-host/);
  });

  it('wants .json for the plan and .md for the report', () => {
    expect(refused(['plan', 'src', '--out', 'plan.txt'])).toMatch(/\.json/);
    expect(
      refused([
        'check',
        'src',
        '--target',
        'local',
        '--created-by',
        uuid,
        '--report-out',
        'r.txt',
      ])
    ).toMatch(/\.md/);
  });
});

describe('runDocumentJob', () => {
  const never = {
    query: async () => {
      throw new Error('the database must not be touched');
    },
  };
  const storage = {
    exists: async () => false,
    put: async () => undefined,
    remove: async () => undefined,
  };
  const input = (over: Record<string, unknown>) => ({
    mode: 'apply' as const,
    target: 'local' as const,
    createdBy: '11111111-2222-4333-8444-555555555555',
    overwriteFiles: false,
    supabaseUrl: SUPABASE,
    bytesOf: async () => new Uint8Array(),
    ...over,
  });

  it('a real run refuses a storage that does not fit the target before the first statement', async () => {
    const error = await runDocumentJob(
      never,
      storage,
      { version: 1, items: [] },
      input({}) as any
    ).catch(e => e);
    expect(error).toBeInstanceOf(ImportAbort);
    expect(error.code).toBe('STORAGE_TARGET');
    const preview = await runDocumentJob(
      never,
      storage,
      { version: 1, items: [] },
      input({ target: 'preview', supabaseUrl: 'http://127.0.0.1:54321' }) as any
    ).catch(e => e);
    expect(preview.code).toBe('STORAGE_TARGET');
  });
});
