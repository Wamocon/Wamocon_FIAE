/**
 * @jest-environment node
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

// The wiring of the transfer routes: the pool of the app, the staging bucket and the
// document bucket. Everything behind it is replaced here.

afterEach(() => {
  jest.resetModules();
  jest.dontMock('@/db');
});

async function load() {
  jest.resetModules();
  const released: unknown[] = [];
  const reserved = {
    unsafe: jest.fn(async () => Object.assign([{ ok: 1 }], { count: 1 })),
    release: jest.fn(async () => {
      released.push(1);
    }),
  };
  const client = {
    reserve: jest.fn(async () => reserved),
    unsafe: jest.fn(async () => Object.assign([{ n: 1 }], { count: 1 })),
  };
  jest.doMock('@/db', () => ({
    __esModule: true,
    default: { $client: client },
  }));
  const download = jest.fn(async () => new Uint8Array([1]));
  jest.doMock('@/lib/content-upload/staging/context', () => ({
    __esModule: true,
    getUploadStorage: () => ({ download }),
  }));
  const bucket = { put: jest.fn(), remove: jest.fn() };
  jest.doMock('@/lib/content-upload/transfer/content-bucket', () => ({
    __esModule: true,
    createContentBucket: () => bucket,
  }));
  const mod = await import('@/lib/content-upload/transfer/context');
  return { mod, client, reserved, download, bucket, released };
}

describe('transferDeps', () => {
  it('reads single statements from the pool and gives the engines a reserved connection', async () => {
    const { mod, client, reserved, released } = await load();
    const deps = mod.transferDeps();
    const connection = await deps.connections.reserve();
    expect(client.reserve).toHaveBeenCalledTimes(1);
    expect(await connection.query('select 1', [1])).toEqual({
      rows: [{ ok: 1 }],
      rowCount: 1,
    });
    expect(reserved.unsafe).toHaveBeenCalledWith('select 1', [1]);
    await connection.release();
    expect(released).toHaveLength(1);
    // the store works on the pool, not on the reserved connection
    await deps.store.getRunState('cccccccc-0000-4000-8000-000000000001');
    expect(client.unsafe).toHaveBeenCalledTimes(1);
  });

  it('reads the bytes of a file from the staging bucket with the size limit of a file', async () => {
    const { mod, download } = await load();
    const deps = mod.transferDeps();
    const bytes = await deps.readBytes({
      storagePath: 'upload/r/f.docx',
      ext: 'docx',
    } as any);
    expect(bytes).toEqual(new Uint8Array([1]));
    expect(download).toHaveBeenCalledWith('upload/r/f.docx', 25 * 1024 * 1024);
    await deps.readBytes({
      storagePath: 'upload/r/f.json',
      ext: 'json',
    } as any);
    expect(download).toHaveBeenCalledWith('upload/r/f.json', 32 * 1024 * 1024);
    await deps.readBytes({
      storagePath: 'upload/r/f.xlsx',
      ext: 'xlsx',
    } as any);
    expect(download).toHaveBeenCalledWith('upload/r/f.xlsx', 5 * 1024 * 1024);
  });

  it('takes the host from the connection string of the app, and none when it is not there', async () => {
    const saved = process.env.DB_CONNECTION_STRING;
    try {
      process.env.DB_CONNECTION_STRING =
        'postgresql://u:p@Db.Example.co:6543/postgres';
      expect((await load()).mod.transferDeps().host).toBe('db.example.co');
      delete process.env.DB_CONNECTION_STRING;
      expect((await load()).mod.transferDeps().host).toBeNull();
    } finally {
      if (saved === undefined) delete process.env.DB_CONNECTION_STRING;
      else process.env.DB_CONNECTION_STRING = saved;
    }
  });

  it('creates the document bucket only when it is asked for', async () => {
    const { mod, bucket } = await load();
    const deps = mod.transferDeps();
    expect(deps.contentBucket?.()).toBe(bucket);
  });

  it('gives single statements on the pool for the rollback text', async () => {
    const { mod, client } = await load();
    expect(await mod.poolQueryable().query('select 2')).toEqual({
      rows: [{ n: 1 }],
      rowCount: 1,
    });
    expect(client.unsafe).toHaveBeenCalledWith('select 2', []);
  });
});
