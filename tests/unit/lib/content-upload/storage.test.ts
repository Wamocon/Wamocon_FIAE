/**
 * @jest-environment node
 */
import {
  SupabaseUploadStorage,
  UploadStorageError,
  createUploadStorage,
  guardUploadStorage,
} from '@/lib/content-upload/storage';
import { MemoryUploadStorage } from '../../../helpers/memoryUploadStorage';

const RUN = '0b8f4c1e-5d7a-4b1c-9d2e-1a2b3c4d5e6f';
const FILE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PATH = `upload/${RUN}/${FILE}.pdf`;
const URL_BASE = 'https://proj.supabase.co';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function streamOf(parts: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

type FakeBucket = {
  createSignedUploadUrl: jest.Mock;
  createSignedUrl: jest.Mock;
  remove: jest.Mock;
  list: jest.Mock;
};

function fakeClient(overrides: Partial<FakeBucket> = {}) {
  const bucket: FakeBucket = {
    createSignedUploadUrl: jest.fn(async (path: string) => ({
      data: {
        signedUrl: `${URL_BASE}/storage/v1/object/upload/sign/content-upload/${path}?token=abc`,
        token: 'abc',
        path,
      },
      error: null,
    })),
    createSignedUrl: jest.fn(async (path: string) => ({
      data: {
        signedUrl: `${URL_BASE}/storage/v1/object/sign/content-upload/${path}?token=read.token-1`,
      },
      error: null,
    })),
    remove: jest.fn(async () => ({ data: [], error: null })),
    list: jest.fn(async () => ({ data: [], error: null })),
    ...overrides,
  };
  const from = jest.fn(() => bucket);
  const createClientImpl = jest.fn(() => ({ storage: { from } })) as any;
  return { bucket, from, createClientImpl };
}

function make(
  fetchImpl: jest.Mock,
  clientOverrides: Partial<FakeBucket> = {},
  schema: 'public' | 'public_preview' = 'public'
) {
  const client = fakeClient(clientOverrides);
  const storage = new SupabaseUploadStorage({
    supabaseUrl: URL_BASE,
    secretKey: 'secret',
    schema,
    fetchImpl: fetchImpl as any,
    createClientImpl: client.createClientImpl,
  });
  return { storage, ...client };
}

describe('SupabaseUploadStorage', () => {
  it('fails closed without a url or a key', () => {
    const before = { ...process.env };
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(
        () => new SupabaseUploadStorage({ supabaseUrl: URL_BASE })
      ).toThrow(UploadStorageError);
      expect(
        () => new SupabaseUploadStorage({ secretKey: 'k', supabaseUrl: '' })
      ).toThrow(UploadStorageError);
    } finally {
      process.env = before;
    }
  });

  describe('createSignedUploadUrl', () => {
    it('never asks for upsert: true (an object is never overwritten)', async () => {
      const { storage, bucket, from } = make(jest.fn());
      const out = await storage.createSignedUploadUrl(PATH);
      expect(out).toEqual({
        ok: true,
        path: PATH,
        token: 'abc',
        signedUrl: expect.stringContaining(
          '/object/upload/sign/content-upload/'
        ),
      });
      expect(from).toHaveBeenCalledWith('content-upload');
      expect(bucket.createSignedUploadUrl).toHaveBeenCalledTimes(1);
      const [calledPath, options] = bucket.createSignedUploadUrl.mock.calls[0];
      expect(calledPath).toBe(PATH);
      expect(options).toEqual({ upsert: false });
      for (const call of bucket.createSignedUploadUrl.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('"upsert":true');
      }
    });

    it('reports an object that exists as OBJECT_EXISTS', async () => {
      for (const message of [
        'The resource already exists',
        'Duplicate',
        'a 409 happened',
      ]) {
        const { storage } = make(jest.fn(), {
          createSignedUploadUrl: jest.fn(async () => ({
            data: null,
            error: { message },
          })),
        });
        expect(await storage.createSignedUploadUrl(PATH)).toEqual({
          ok: false,
          path: PATH,
          code: 'OBJECT_EXISTS',
        });
      }
    });

    it('reports any other failure as ERROR without its text', async () => {
      const { storage } = make(jest.fn(), {
        createSignedUploadUrl: jest.fn(async () => ({
          data: null,
          error: { message: 'secret detail of the storage' },
        })),
      });
      const out = await storage.createSignedUploadUrl(PATH);
      expect(out).toEqual({ ok: false, path: PATH, code: 'ERROR' });
      expect(JSON.stringify(out)).not.toContain('secret detail');
    });
  });

  describe('probe', () => {
    it('reads the first bytes with a range request and takes the size from content-range', async () => {
      const fetchImpl = jest.fn(
        async () =>
          new Response(bytes('%PDF-1.7'), {
            status: 206,
            headers: { 'content-range': 'bytes 0-7/12345' },
          })
      );
      const { storage } = make(fetchImpl);
      const result = await storage.probe(PATH, 8);
      expect(result).toEqual({ size: 12345, head: bytes('%PDF-1.7') });
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, any];
      expect(url).toContain('/storage/v1/object/sign/content-upload/');
      expect(init.headers).toEqual({ Range: 'bytes=0-7' });
      // no redirects: a redirect would leave the checked host
      expect(init.redirect).toBe('error');
    });

    it('cuts a full answer to the bytes asked for and never reads on', async () => {
      const big = new Uint8Array(100_000).fill(65);
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(big.slice(0, 10_000));
          if (pulled > 50) controller.close();
        },
      });
      const fetchImpl = jest.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: { 'content-length': '500000' },
          })
      );
      const { storage } = make(fetchImpl);
      const result = await storage.probe(PATH, 8);
      expect(result?.size).toBe(500000);
      expect(result?.head).toHaveLength(8);
      expect(pulled).toBeLessThan(10);
    });

    it('is null when the object does not exist', async () => {
      const missing = make(jest.fn(), {
        createSignedUrl: jest.fn(async () => ({
          data: null,
          error: { message: 'Object not found' },
        })),
      });
      expect(await missing.storage.probe(PATH, 8)).toBeNull();

      for (const status of [404, 400]) {
        const { storage } = make(
          jest.fn(async () => new Response('{}', { status }))
        );
        expect(await storage.probe(PATH, 8)).toBeNull();
      }
    });

    it('reads an empty object as size 0 (answer 416)', async () => {
      const { storage } = make(
        jest.fn(
          async () =>
            new Response('', {
              status: 416,
              headers: { 'content-range': 'bytes */0' },
            })
        )
      );
      expect(await storage.probe(PATH, 8)).toEqual({
        size: 0,
        head: new Uint8Array(0),
      });
    });

    it('fails on a server error or an unknown size', async () => {
      for (const response of [
        () => new Response('x', { status: 500 }),
        () => new Response('x', { status: 416 }),
        () => new Response('x', { status: 206 }),
        () => new Response('x', { status: 200 }),
      ]) {
        const { storage } = make(jest.fn(async () => response()));
        await expect(storage.probe(PATH, 8)).rejects.toMatchObject({
          code: 'READ_FAILED',
        });
      }
    });

    it('turns a network error into READ_FAILED without its text', async () => {
      const { storage } = make(
        jest.fn(async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.1');
        })
      );
      const error = await storage.probe(PATH, 8).catch(e => e);
      expect(error).toBeInstanceOf(UploadStorageError);
      expect(error.code).toBe('READ_FAILED');
      expect(error.message).not.toContain('ECONNREFUSED');
    });

    it('does not fetch an address outside of the own project', async () => {
      const fetchImpl = jest.fn();
      const { storage } = make(fetchImpl, {
        createSignedUrl: jest.fn(async () => ({
          data: {
            signedUrl:
              'https://evil.example/storage/v1/object/sign/x/y?token=t',
          },
          error: null,
        })),
      });
      await expect(storage.probe(PATH, 8)).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('fails when the signed url cannot be made', async () => {
      const { storage } = make(jest.fn(), {
        createSignedUrl: jest.fn(async () => ({
          data: null,
          error: { message: 'boom' },
        })),
      });
      await expect(storage.probe(PATH, 8)).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });
  });

  describe('download', () => {
    it('reads the whole object up to the limit', async () => {
      const { storage } = make(
        jest.fn(
          async () =>
            new Response(streamOf([bytes('abc'), bytes('def')]), {
              status: 200,
              headers: { 'content-length': '6' },
            })
        )
      );
      expect(await storage.download(PATH, 100)).toEqual(bytes('abcdef'));
    });

    it('refuses an object that announces more than the limit before reading it', async () => {
      const read = jest.spyOn(ReadableStream.prototype, 'getReader');
      const { storage } = make(
        jest.fn(
          async () =>
            new Response(streamOf([bytes('x')]), {
              status: 200,
              headers: { 'content-length': '1000' },
            })
        )
      );
      await expect(storage.download(PATH, 10)).rejects.toMatchObject({
        code: 'TOO_LARGE',
      });
      expect(read).not.toHaveBeenCalled();
      read.mockRestore();
    });

    it('stops reading an object that is larger than it said', async () => {
      const { storage } = make(
        jest.fn(
          async () =>
            new Response(streamOf([bytes('0123456789'), bytes('0123456789')]), {
              status: 200,
            })
        )
      );
      await expect(storage.download(PATH, 12)).rejects.toMatchObject({
        code: 'TOO_LARGE',
      });
    });

    it('is null for a missing object and fails on other answers', async () => {
      const gone = make(jest.fn(async () => new Response('', { status: 404 })));
      expect(await gone.storage.download(PATH, 10)).toBeNull();
      const broken = make(
        jest.fn(async () => new Response('', { status: 503 }))
      );
      await expect(broken.storage.download(PATH, 10)).rejects.toMatchObject({
        code: 'READ_FAILED',
      });
      const absent = make(jest.fn(), {
        createSignedUrl: jest.fn(async () => ({
          data: null,
          error: { message: 'Object not found' },
        })),
      });
      expect(await absent.storage.download(PATH, 10)).toBeNull();
    });
  });

  describe('remove', () => {
    it('removes the given paths in one call and does nothing for none', async () => {
      const { storage, bucket } = make(jest.fn());
      await storage.remove([]);
      expect(bucket.remove).not.toHaveBeenCalled();
      await storage.remove([PATH]);
      expect(bucket.remove).toHaveBeenCalledWith([PATH]);
    });

    it('fails on an error of the storage', async () => {
      const { storage } = make(jest.fn(), {
        remove: jest.fn(async () => ({ data: null, error: { message: 'x' } })),
      });
      await expect(storage.remove([PATH])).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });
  });

  describe('list', () => {
    function lister(tree: Record<string, any[]>) {
      return jest.fn(async (folder: string, options: any) => {
        const all = tree[folder] ?? [];
        const offset = options?.offset ?? 0;
        return {
          data: all.slice(offset, offset + (options?.limit ?? 100)),
          error: null,
        };
      });
    }

    it('lists the objects of the run folders under upload/, nothing deeper', async () => {
      const list = lister({
        upload: [
          { name: RUN, id: null },
          { name: 'stray-file.pdf', id: 'x', metadata: { size: 1 } },
        ],
        [`upload/${RUN}`]: [
          {
            name: `${FILE}.pdf`,
            id: 'obj-1',
            created_at: '2026-10-01T10:00:00Z',
            metadata: { size: 123 },
          },
          { name: 'sub', id: null },
        ],
      });
      const { storage } = make(jest.fn(), { list });
      expect(await storage.list()).toEqual([
        {
          path: `upload/${RUN}/${FILE}.pdf`,
          size: 123,
          createdAt: new Date('2026-10-01T10:00:00Z'),
        },
      ]);
    });

    it('lists under preview/upload on the Preview schema', async () => {
      const list = lister({});
      const { storage } = make(jest.fn(), { list }, 'public_preview');
      await storage.list();
      expect(list.mock.calls[0][0]).toBe('preview/upload');
    });

    it('pages through long folders and stops at the maximum', async () => {
      const files = Array.from({ length: 250 }, (_, i) => ({
        name: `f${i}.pdf`,
        id: `id${i}`,
        metadata: { size: i },
      }));
      const list = lister({
        upload: [{ name: RUN, id: null }],
        [`upload/${RUN}`]: files,
      });
      const { storage } = make(jest.fn(), { list });
      expect(await storage.list()).toHaveLength(250);
      expect(await storage.list({ maxObjects: 120 })).toHaveLength(120);
    });

    it('fails on an error of the storage', async () => {
      const { storage } = make(jest.fn(), {
        list: jest.fn(async () => ({ data: null, error: { message: 'x' } })),
      });
      await expect(storage.list()).rejects.toMatchObject({
        code: 'STORAGE_ERROR',
      });
    });
  });
});

describe('guardUploadStorage: the exact path form before every access', () => {
  const BAD = [
    `upload/${RUN}/${FILE}.exe`,
    `upload/${RUN}/../${FILE}.pdf`,
    `preview/upload/${RUN}/${FILE}.pdf`,
    `content/${FILE}.pdf`,
    `${RUN}/${FILE}.pdf`,
    '',
    `upload/${RUN}/${FILE}.pdf?x`,
  ];

  it.each(BAD)(
    'refuses %j for every operation and never reaches the storage',
    async path => {
      const inner = new MemoryUploadStorage();
      const spies = {
        sign: jest.spyOn(inner, 'createSignedUploadUrl'),
        probe: jest.spyOn(inner, 'probe'),
        download: jest.spyOn(inner, 'download'),
        remove: jest.spyOn(inner, 'remove'),
      };
      const storage = guardUploadStorage(inner, 'public');
      expect(() => storage.createSignedUploadUrl(path)).toThrow(
        UploadStorageError
      );
      expect(() => storage.probe(path, 8)).toThrow(UploadStorageError);
      expect(() => storage.download(path, 8)).toThrow(UploadStorageError);
      expect(() => storage.remove([PATH, path])).toThrow(UploadStorageError);
      for (const spy of Object.values(spies))
        expect(spy).not.toHaveBeenCalled();
    }
  );

  it('lets the exact form of the schema through and lists without a path', async () => {
    const inner = new MemoryUploadStorage();
    const storage = guardUploadStorage(inner, 'public');
    expect((await storage.createSignedUploadUrl(PATH)).ok).toBe(true);
    expect(await storage.probe(PATH, 8)).toBeNull();
    expect(await storage.download(PATH, 8)).toBeNull();
    await storage.remove([PATH]);
    expect(await storage.list()).toEqual([]);
    // the Preview form is not valid in Production
    expect(() =>
      storage.probe(`preview/upload/${RUN}/${FILE}.pdf`, 8)
    ).toThrow();
  });

  it('createUploadStorage puts the guard in front of Supabase', async () => {
    const fetchImpl = jest.fn();
    const client = fakeClient();
    const storage = createUploadStorage({
      supabaseUrl: URL_BASE,
      secretKey: 'secret',
      schema: 'public',
      fetchImpl: fetchImpl as any,
      createClientImpl: client.createClientImpl,
    });
    expect(() => storage.remove(['../x.pdf'])).toThrow(UploadStorageError);
    expect(client.bucket.remove).not.toHaveBeenCalled();
    await storage.remove([PATH]);
    expect(client.bucket.remove).toHaveBeenCalledWith([PATH]);
  });
});
