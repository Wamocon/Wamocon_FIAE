/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  SubmissionStorageError,
  createSubmissionStorage,
  guardSubmissionStorage,
  type SubmissionFileStorage,
} from '@/lib/submission-file/storage';
import {
  filePath,
  fileFolder,
  incomingFolder,
  incomingPath,
  submissionFolder,
} from '@/lib/submission-file/rules';

const scope = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  traineeId: '22222222-2222-4222-8222-222222222222',
  useCaseId: '33333333-3333-4333-8333-333333333333',
};
const folder = submissionFolder(scope, 'public') as string;
const goodFile = filePath(folder, 1761700000000, 'a.pdf');
const goodIncoming = incomingPath(
  folder,
  '44444444-4444-4444-8444-444444444444.pdf'
);

describe('guardSubmissionStorage', () => {
  const makeInner = () => {
    const inner: SubmissionFileStorage = {
      createSignedUploadUrl: jest.fn(async () => ({
        ok: true as const,
        token: 't',
      })),
      list: jest.fn(async () => []),
      download: jest.fn(async () => null),
      move: jest.fn(async () => undefined),
      remove: jest.fn(async () => undefined),
      createSignedUrl: jest.fn(async () => 'https://x.example.invalid/u'),
    };
    return inner;
  };

  it('passes the exact forms through', async () => {
    const inner = makeInner();
    const guarded = guardSubmissionStorage(inner, 'public');
    await guarded.createSignedUploadUrl(goodIncoming);
    await guarded.list(fileFolder(folder));
    await guarded.list(incomingFolder(folder));
    await guarded.download(goodFile);
    await guarded.move(goodIncoming, goodFile);
    await guarded.remove([goodFile, goodIncoming]);
    await guarded.createSignedUrl(goodFile, 120, 'a.pdf');
    expect(inner.remove).toHaveBeenCalledWith([goodFile, goodIncoming]);
  });

  it('throws INVALID_PATH for anything else, before the inner storage is asked', () => {
    const inner = makeInner();
    const guarded = guardSubmissionStorage(inner, 'public');
    const bad = '../etc/passwd';
    const expectInvalid = (call: () => unknown) => {
      try {
        call();
      } catch (error) {
        expect(error).toBeInstanceOf(SubmissionStorageError);
        expect((error as SubmissionStorageError).code).toBe('INVALID_PATH');
        return;
      }
      throw new Error('expected INVALID_PATH');
    };
    expectInvalid(() => guarded.createSignedUploadUrl(bad));
    expectInvalid(() => guarded.list(folder));
    expectInvalid(() => guarded.download(bad));
    expectInvalid(() => guarded.move(goodIncoming, bad));
    expectInvalid(() => guarded.move(bad, goodFile));
    expectInvalid(() => guarded.remove([goodFile, bad]));
    expectInvalid(() => guarded.createSignedUrl(bad, 120, 'a.pdf'));
    for (const fn of Object.values(inner)) expect(fn).not.toHaveBeenCalled();
  });
});

type Bucket = Record<string, jest.Mock<(...args: any[]) => Promise<any>>>;

function fakeClient(bucket: Bucket) {
  const from = jest.fn((_name: string) => bucket);
  const createClientImpl = jest.fn(() => ({ storage: { from } })) as any;
  return { from, createClientImpl };
}

const deps = (createClientImpl: unknown) => ({
  supabaseUrl: 'https://project.supabase.example.invalid',
  secretKey: 'secret',
  schema: 'public' as const,
  createClientImpl: createClientImpl as any,
});

describe('createSubmissionStorage (Supabase)', () => {
  it('needs a url and a key', () => {
    const saved = { ...process.env };
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => createSubmissionStorage({ schema: 'public' })).toThrow(
        expect.objectContaining({ code: 'NOT_CONFIGURED' })
      );
    } finally {
      process.env = saved;
    }
  });

  it('uses the private bucket and never overwrites when it creates an upload url', async () => {
    const bucket: Bucket = {
      createSignedUploadUrl: jest.fn(async () => ({
        data: { token: 'tok' },
        error: null,
      })),
    };
    const { from, createClientImpl } = fakeClient(bucket);
    const storage = createSubmissionStorage(deps(createClientImpl));
    expect(await storage.createSignedUploadUrl(goodIncoming)).toEqual({
      ok: true,
      token: 'tok',
    });
    expect(from).toHaveBeenCalledWith('submission-files');
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith(goodIncoming, {
      upsert: false,
    });
  });

  it('tells an existing object from another failure', async () => {
    const answers = [
      {
        data: null,
        error: { message: 'The resource already exists', statusCode: '409' },
      },
      { data: null, error: { message: 'boom' } },
    ];
    const bucket: Bucket = {
      createSignedUploadUrl: jest.fn(async () => answers.shift()),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    expect(await storage.createSignedUploadUrl(goodIncoming)).toEqual({
      ok: false,
      code: 'OBJECT_EXISTS',
    });
    expect(await storage.createSignedUploadUrl(goodIncoming)).toEqual({
      ok: false,
      code: 'ERROR',
    });
  });

  it('lists the objects of a folder and skips sub folders', async () => {
    const bucket: Bucket = {
      list: jest.fn(async () => ({
        data: [
          { name: 'a.pdf', id: 'x', metadata: { size: 10 } },
          { name: 'sub', id: null, metadata: null },
          { name: 'b.pdf', id: 'y', metadata: null },
        ],
        error: null,
      })),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    expect(await storage.list(fileFolder(folder))).toEqual([
      { name: 'a.pdf', size: 10 },
      { name: 'b.pdf', size: null },
    ]);
  });

  it('fails the listing with STORAGE_ERROR and gives nothing of the cause', async () => {
    const bucket: Bucket = {
      list: jest.fn(async () => ({
        data: null,
        error: { message: 'secret detail' },
      })),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    await expect(storage.list(fileFolder(folder))).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
      message: 'The folder could not be listed.',
    });
  });

  it('handles an empty list answer', async () => {
    const bucket: Bucket = {
      list: jest.fn(async () => ({ data: null, error: null })),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    expect(await storage.list(fileFolder(folder))).toEqual([]);
  });

  it('downloads the bytes, answers null for a missing object and fails otherwise', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const answers: any[] = [
      { data: blob, error: null },
      { data: null, error: { message: 'Object not found' } },
      { data: null, error: { message: 'timeout' } },
    ];
    const bucket: Bucket = { download: jest.fn(async () => answers.shift()) };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    expect(
      Array.from((await storage.download(goodFile)) as Uint8Array)
    ).toEqual([1, 2, 3]);
    expect(await storage.download(goodFile)).toBeNull();
    await expect(storage.download(goodFile)).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
  });

  it('moves and removes, and does nothing for an empty removal', async () => {
    const bucket: Bucket = {
      move: jest.fn(async () => ({ error: null })),
      remove: jest.fn(async () => ({ error: null })),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    await storage.move(goodIncoming, goodFile);
    await storage.remove([]);
    await storage.remove([goodFile]);
    expect(bucket.move).toHaveBeenCalledWith(goodIncoming, goodFile);
    expect(bucket.remove).toHaveBeenCalledTimes(1);
    expect(bucket.remove).toHaveBeenCalledWith([goodFile]);
  });

  it('fails a move and a removal with STORAGE_ERROR', async () => {
    const bucket: Bucket = {
      move: jest.fn(async () => ({ error: { message: 'x' } })),
      remove: jest.fn(async () => ({ error: { message: 'x' } })),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    await expect(storage.move(goodIncoming, goodFile)).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
    await expect(storage.remove([goodFile])).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
  });

  it('signs a link that forces a download', async () => {
    const answers: any[] = [
      { data: { signedUrl: 'https://s.example.invalid/x' }, error: null },
      { data: null, error: { message: 'Object not found' } },
      { data: null, error: { message: 'broken' } },
    ];
    const bucket: Bucket = {
      createSignedUrl: jest.fn(async () => answers.shift()),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    expect(await storage.createSignedUrl(goodFile, 120, 'a.pdf')).toBe(
      'https://s.example.invalid/x'
    );
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(goodFile, 120, {
      download: 'a.pdf',
    });
    expect(await storage.createSignedUrl(goodFile, 120, 'a.pdf')).toBeNull();
    await expect(
      storage.createSignedUrl(goodFile, 120, 'a.pdf')
    ).rejects.toMatchObject({
      code: 'STORAGE_ERROR',
    });
  });

  it('refuses a foreign path before the client is called', async () => {
    const bucket: Bucket = {
      download: jest.fn(async () => ({ data: null, error: null })),
    };
    const storage = createSubmissionStorage(
      deps(fakeClient(bucket).createClientImpl)
    );
    expect(() => storage.download('content/other.pdf')).toThrow(
      expect.objectContaining({ code: 'INVALID_PATH' })
    );
    expect(bucket.download).not.toHaveBeenCalled();
  });
});
