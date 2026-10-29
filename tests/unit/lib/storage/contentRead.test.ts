/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import {
  defaultReadingClient,
  readContentObject,
  type ContentReadingClient,
} from '@/lib/storage/contentRead';

// The readers on the server (PDF extraction of HAI, the logo of the
// certificate) read a file of the bucket content with the secret key straight
// from the storage. That works for a public and for a private bucket. Any other
// address is no business of this module.

const ORIGIN = 'https://proj.supabase.co';
const PATH = 'preview/kfbm/K6.2-d/szenario/UC_6d_Titel.pdf';
const PUBLIC = `${ORIGIN}/storage/v1/object/public/content/${PATH}`;

function fakeStorage(
  behavior: 'ok' | 'error' | 'throw' | 'nodata' | 'big' | 'bigBytes' = 'ok'
) {
  const calls: Array<{ bucket: string; path: string }> = [];
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const client: ContentReadingClient = {
    storage: {
      from: bucket => ({
        download: async path => {
          calls.push({ bucket, path });
          if (behavior === 'throw') throw new Error('down');
          if (behavior === 'error') {
            return { data: null, error: new Error('Object not found') };
          }
          if (behavior === 'nodata') return { data: null, error: null };
          return {
            data: {
              size: behavior === 'big' ? 10_000 : bytes.length,
              arrayBuffer: async () =>
                behavior === 'bigBytes'
                  ? new ArrayBuffer(10_000)
                  : (bytes.buffer as ArrayBuffer),
            },
            error: null,
          };
        },
      }),
    },
  };
  return { client, calls };
}

const read = (
  raw: unknown,
  fake: ReturnType<typeof fakeStorage> | null,
  max = 1000
) =>
  readContentObject(raw, max, {
    supabaseUrl: ORIGIN,
    client: () => (fake ? fake.client : null),
  });

describe('readContentObject', () => {
  it.each([
    ['the public url', PUBLIC],
    ['the private reference', `private://content/${PATH}`],
    ['the bare path', PATH],
  ])('reads %s from the bucket content with the client', async (_name, raw) => {
    const fake = fakeStorage();
    const result = await read(raw, fake);
    expect(result).toEqual({ status: 'ok', buffer: Buffer.from([1, 2, 3, 4]) });
    expect(fake.calls).toEqual([{ bucket: 'content', path: PATH }]);
  });

  it('leaves everything that is no file of the bucket content to the caller, without a request', async () => {
    const fake = fakeStorage();
    for (const raw of [
      'https://evil.example/storage/v1/object/public/content/a.pdf',
      `${ORIGIN}/storage/v1/object/public/avatar/a.png`,
      'private://content-solutions/preview/kfbm/x.pdf',
      `${ORIGIN}/storage/v1/object/public/content/../x.pdf`,
      '',
      null,
    ]) {
      expect((await read(raw, fake)).status).toBe('not-content');
    }
    expect(fake.calls).toEqual([]);
  });

  it('says unavailable without a client, so the caller keeps its own way', async () => {
    expect(await read(PUBLIC, null)).toEqual({ status: 'unavailable' });
    expect(
      await readContentObject(PUBLIC, 10, {
        supabaseUrl: ORIGIN,
        client: () => {
          throw new Error('no config');
        },
      })
    ).toEqual({ status: 'unavailable' });
  });

  it('fails without repeating the address when the storage refuses or breaks', async () => {
    for (const behavior of ['error', 'throw', 'nodata'] as const) {
      const result = await read(PUBLIC, fakeStorage(behavior));
      expect(result.status).toBe('failed');
      expect(JSON.stringify(result)).not.toContain(PATH);
    }
  });

  it('refuses a file above the limit, by the declared size and by the bytes', async () => {
    expect(await read(PUBLIC, fakeStorage('big'))).toEqual({
      status: 'failed',
      reason: 'The file is too large to read.',
    });
    expect(await read(PUBLIC, fakeStorage('bigBytes'))).toEqual({
      status: 'failed',
      reason: 'The file is too large to read.',
    });
  });
});

describe('defaultReadingClient', () => {
  const names = [
    'SUPABASE_URL_INTERNAL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const keep = Object.fromEntries(names.map(n => [n, process.env[n]]));
  const restore = () => {
    for (const n of names) {
      if (keep[n] === undefined) delete process.env[n];
      else process.env[n] = keep[n];
    }
  };

  it('needs a url and the secret key', () => {
    try {
      for (const n of names) delete process.env[n];
      expect(defaultReadingClient()).toBeNull();
      process.env.SUPABASE_URL_INTERNAL = 'http://kong:8000';
      expect(defaultReadingClient()).toBeNull();
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb-secret';
      expect(defaultReadingClient()).not.toBeNull();
    } finally {
      restore();
    }
  });
});
