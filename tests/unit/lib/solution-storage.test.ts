/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  SIGNED_URL_SECONDS,
  withSignedSolutionUrls,
} from '@/lib/solution-storage';

// The model solutions of the KfBM lie in the PRIVATE bucket content-solutions. A row stores the
// reference private://content-solutions/<path>. Only the trainer list of the use case documents
// turns it into a short-lived signed url, with the secret key, on the server.

const PATH = 'preview/kfbm/K6.2-d/musterloesung/UC_6d_Titel_Musterloesung.pdf';
const REF = `private://content-solutions/${PATH}`;
const SIGNED = `https://proj.supabase.co/storage/v1/object/sign/content-solutions/${PATH}?token=abc`;

const solution = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  title: 'Musterlösung',
  documentType: 'TRAINER_SOLUTION',
  visibility: 'TRAINER_ONLY',
  storageUrl: REF,
  ...over,
});

function fakeClient(
  result: { signedUrl?: string; error?: unknown } = { signedUrl: SIGNED }
) {
  const calls: Array<{ bucket: string; path: string; seconds: number }> = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, seconds: number) => {
          calls.push({ bucket, path, seconds });
          return result.signedUrl
            ? { data: { signedUrl: result.signedUrl }, error: null }
            : { data: null, error: result.error ?? new Error('no') };
        },
      }),
    },
  };
  return { client, calls };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('withSignedSolutionUrls', () => {
  it('signs the reference of a trainer-only row for a short time and keeps the other fields', async () => {
    const { client, calls } = fakeClient();
    const rows = await withSignedSolutionUrls([solution()], {
      client: () => client,
    });
    expect(rows[0]).toEqual({ ...solution(), storageUrl: SIGNED });
    expect(calls).toEqual([
      { bucket: 'content-solutions', path: PATH, seconds: SIGNED_URL_SECONDS },
    ]);
    expect(SIGNED_URL_SECONDS).toBeLessThanOrEqual(900);
  });

  it('leaves ordinary rows alone and never creates a client for them', async () => {
    let created = 0;
    const rows = [
      {
        id: 'a',
        storageUrl:
          'https://proj.supabase.co/storage/v1/object/public/content/a.pdf',
      },
      { id: 'b', storageUrl: '' },
      { id: 'c', storageUrl: null },
    ];
    const out = await withSignedSolutionUrls(rows, {
      client: () => {
        created += 1;
        return fakeClient().client;
      },
    });
    expect(out).toEqual(rows);
    expect(created).toBe(0);
  });

  it('never signs a row that is not trainer-only, and never another bucket or a path with dots', async () => {
    const { client, calls } = fakeClient();
    const bad = [
      solution({ visibility: 'ALL' }),
      solution({ visibility: null }),
      solution({ storageUrl: 'private://content/x/y.pdf' }),
      solution({ storageUrl: 'private://content-solutions/../content/x.pdf' }),
      solution({ storageUrl: 'private://content-solutions//x.pdf' }),
      solution({ storageUrl: 'private://content-solutions/a b.pdf' }),
      solution({ storageUrl: 'private://content-solutions/%2e%2e/x.pdf' }),
    ];
    const out = await withSignedSolutionUrls(bad, { client: () => client });
    expect(calls).toEqual([]);
    // the reference never goes to the page either
    expect(out.every(r => r.storageUrl === '')).toBe(true);
  });

  it('answers with an empty url when the signing fails, without a trace of the reference', async () => {
    const { client } = fakeClient({ error: new Error('storage down') });
    const out = await withSignedSolutionUrls([solution()], {
      client: () => client,
    });
    expect(out[0].storageUrl).toBe('');
    expect(JSON.stringify(out)).not.toContain('content-solutions');
  });

  it('answers with an empty url when no client can be made (no key)', async () => {
    const out = await withSignedSolutionUrls([solution()], {
      client: () => null,
    });
    expect(out[0].storageUrl).toBe('');
  });

  it('does not throw when the client throws', async () => {
    const out = await withSignedSolutionUrls([solution()], {
      client: () => ({
        storage: {
          from: () => ({
            createSignedUrl: async () => {
              throw new Error('boom');
            },
          }),
        },
      }),
    });
    expect(out[0].storageUrl).toBe('');
  });
});
