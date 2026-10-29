/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  LIST_SIGNED_SECONDS,
  MAX_SIGNED_SECONDS,
  MIN_SIGNED_SECONDS,
  ON_DEMAND_SIGNED_SECONDS,
  clampSignedSeconds,
  defaultSigningClient,
  signContentUrl,
  signContentValues,
  withSignedContentFields,
  withSignedContentUrls,
  type ContentSigningClient,
} from '@/lib/storage/contentUrl';

// The browser never gets the stored address of a file of the bucket content, it
// gets a signed url. The bucket is public today and private after the go-live:
// the same code has to work for both. The storage client is replaced by a fake
// that behaves like the storage in each state. Public bucket: a signed url works
// as well as the public one. Private bucket: only the signed url works, the
// public address answers 400.

const ORIGIN = 'https://proj.supabase.co';
const PATH = 'preview/kfbm/K6.2-d/szenario/UC_6d_Titel.pdf';
const PUBLIC = `${ORIGIN}/storage/v1/object/public/content/${PATH}`;
const REFERENCE = `private://content/${PATH}`;
const signedFor = (path: string) =>
  `${ORIGIN}/storage/v1/object/sign/content/${path}?token=t-${path.length}`;

type Fake = {
  client: ContentSigningClient;
  calls: Array<{ bucket: string; paths: string[]; seconds: number }>;
};

function fakeStorage(
  options: {
    /** paths the storage does not know */
    missing?: string[];
    /** the whole call fails */
    fail?: 'error' | 'throw' | 'empty';
  } = {}
): Fake {
  const calls: Fake['calls'] = [];
  const client: ContentSigningClient = {
    storage: {
      from: bucket => ({
        createSignedUrls: async (paths, seconds) => {
          calls.push({ bucket, paths, seconds });
          if (options.fail === 'throw') throw new Error('storage down');
          if (options.fail === 'error') {
            return { data: null, error: new Error('storage down') };
          }
          if (options.fail === 'empty') return { data: null, error: null };
          return {
            data: paths.map(path =>
              options.missing?.includes(path)
                ? { path, signedUrl: null, error: 'Object not found' }
                : { path, signedUrl: signedFor(path), error: null }
            ),
            error: null,
          };
        },
      }),
    },
  };
  return { client, calls };
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const deps = (fake: Fake, extra: Record<string, unknown> = {}) => ({
  client: () => fake.client,
  supabaseUrl: ORIGIN,
  ...extra,
});

describe('signContentValues: every form of the bucket content gets a signed url', () => {
  it('signs the public url, the private reference, a bare path and a saved signed url', async () => {
    const fake = fakeStorage();
    const out = await signContentValues(
      [
        PUBLIC,
        REFERENCE,
        PATH,
        `${ORIGIN}/storage/v1/object/sign/content/${PATH}?token=old`,
      ],
      deps(fake)
    );
    expect(out).toEqual([
      signedFor(PATH),
      signedFor(PATH),
      signedFor(PATH),
      signedFor(PATH),
    ]);
    // one request for all of them, the same path only once, only the bucket content
    expect(fake.calls).toEqual([
      { bucket: 'content', paths: [PATH], seconds: LIST_SIGNED_SECONDS },
    ]);
  });

  it('signs several files in one request', async () => {
    const fake = fakeStorage();
    const out = await signContentValues(
      [`${ORIGIN}/storage/v1/object/public/content/a.pdf`, 'b.pdf', REFERENCE],
      deps(fake)
    );
    expect(out).toEqual([
      signedFor('a.pdf'),
      signedFor('b.pdf'),
      signedFor(PATH),
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].paths).toEqual(['a.pdf', 'b.pdf', PATH]);
  });
});

describe('signContentValues: what is left alone', () => {
  it('returns an address that is no file of the bucket content as it is, without a request', async () => {
    const fake = fakeStorage();
    const values: unknown[] = [
      'https://www.youtube.com/watch?v=abc',
      `${ORIGIN}/storage/v1/object/public/avatar/a.png`,
      `https://other.supabase.co/storage/v1/object/public/content/a.pdf`,
      'private://content-solutions/preview/kfbm/x.pdf',
      '',
      null,
      undefined,
      7,
    ];
    const out = await signContentValues(values, deps(fake));
    expect(out).toEqual(values);
    expect(fake.calls).toEqual([]);
  });

  it('never signs a path that is not safe: a public url stays as stored, a private reference becomes empty', async () => {
    const fake = fakeStorage();
    const traversal = `${ORIGIN}/storage/v1/object/public/content/../secret.pdf`;
    const out = await signContentValues(
      [
        traversal,
        'private://content/../secret.pdf',
        'private://content/a%2e%2e/x.pdf',
        'a/../b.pdf',
      ],
      deps(fake)
    );
    expect(out).toEqual([traversal, '', '', 'a/../b.pdf']);
    expect(fake.calls).toEqual([]);
  });
});

describe('signContentValues: when signing is not possible', () => {
  it('keeps the stored address while the bucket is public, never a private reference', async () => {
    for (const fail of ['error', 'throw', 'empty'] as const) {
      const fake = fakeStorage({ fail });
      const out = await signContentValues(
        [PUBLIC, REFERENCE, PATH],
        deps(fake)
      );
      expect(out).toEqual([PUBLIC, '', PATH]);
    }
  });

  it('keeps the stored address of a file the storage does not know', async () => {
    const fake = fakeStorage({ missing: [PATH] });
    const out = await signContentValues([PUBLIC, REFERENCE], deps(fake));
    expect(out).toEqual([PUBLIC, '']);
  });

  it('works without a client (no secret key): public urls stay, references are empty', async () => {
    const out = await signContentValues([PUBLIC, REFERENCE], {
      client: () => null,
      supabaseUrl: ORIGIN,
    });
    expect(out).toEqual([PUBLIC, '']);
  });

  it('works when the client cannot even be created', async () => {
    const out = await signContentValues([PUBLIC], {
      client: () => {
        throw new Error('no config');
      },
      supabaseUrl: ORIGIN,
    });
    expect(out).toEqual([PUBLIC]);
  });

  it('does not repeat a reference in the log', async () => {
    const warn = jest.spyOn(console, 'warn');
    await signContentValues([REFERENCE], deps(fakeStorage({ fail: 'error' })));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private://');
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PATH);
  });
});

describe('the two states of the bucket: public and private', () => {
  // The storage in the state of the bucket: a signed url always works, the
  // public url works only while the bucket is public
  function reachable(bucketIsPublic: boolean, url: string) {
    if (url.includes('/object/sign/content/')) return true;
    if (url.includes('/object/public/content/')) return bucketIsPublic;
    return false;
  }

  it.each([[true], [false]])(
    'what the page gets opens the file with the bucket public = %p',
    async bucketIsPublic => {
      const fake = fakeStorage();
      const [stored] = await signContentValues([PUBLIC], deps(fake));
      expect(reachable(bucketIsPublic, stored as string)).toBe(true);
      // the public address itself would not open the file once the bucket is private
      expect(reachable(bucketIsPublic, PUBLIC)).toBe(bucketIsPublic);
    }
  );

  it('gives the same answer for a row that was written before and after the switch', async () => {
    const fake = fakeStorage();
    const [before, after] = await signContentValues(
      [PUBLIC, REFERENCE],
      deps(fake)
    );
    expect(before).toBe(after);
  });
});

describe('lifetime', () => {
  it('is a list lifetime by default and always between 15 and 60 minutes', async () => {
    expect(LIST_SIGNED_SECONDS).toBeLessThanOrEqual(3600);
    expect(ON_DEMAND_SIGNED_SECONDS).toBeGreaterThanOrEqual(900);
    expect(MIN_SIGNED_SECONDS).toBe(900);
    expect(MAX_SIGNED_SECONDS).toBe(3600);
    expect(clampSignedSeconds(undefined)).toBe(LIST_SIGNED_SECONDS);
    expect(clampSignedSeconds(Number.NaN)).toBe(LIST_SIGNED_SECONDS);
    expect(clampSignedSeconds(60)).toBe(900);
    expect(clampSignedSeconds(10 * 3600)).toBe(3600);
    expect(clampSignedSeconds(1800.9)).toBe(1800);
  });

  it('is passed to the storage clamped', async () => {
    for (const [asked, given] of [
      [ON_DEMAND_SIGNED_SECONDS, 900],
      [5, 900],
      [999999, 3600],
    ] as const) {
      const fake = fakeStorage();
      await signContentValues([PATH], deps(fake, { expiresIn: asked }));
      expect(fake.calls[0].seconds).toBe(given);
    }
  });
});

describe('signContentUrl', () => {
  it('gives the signed url, or the stored address, or null for what is no text', async () => {
    const fake = fakeStorage();
    expect(await signContentUrl(PUBLIC, deps(fake))).toBe(signedFor(PATH));
    expect(await signContentUrl(null, deps(fake))).toBeNull();
    expect(await signContentUrl(5, deps(fake))).toBeNull();
    expect(await signContentUrl('https://x/y', deps(fake))).toBe('https://x/y');
  });
});

describe('withSignedContentUrls and withSignedContentFields', () => {
  it('replaces storageUrl and keeps every other field and row', async () => {
    const fake = fakeStorage();
    const rows = [
      { id: 'a', title: 'A', storageUrl: PUBLIC },
      { id: 'b', title: 'B', storageUrl: 'https://youtu.be/x' },
      { id: 'c', title: 'C', storageUrl: REFERENCE },
      { id: 'd', title: 'D', storageUrl: '' },
      { id: 'e', title: 'E' },
    ];
    const out = await withSignedContentUrls(rows, deps(fake));
    expect(out).toEqual([
      { id: 'a', title: 'A', storageUrl: signedFor(PATH) },
      { id: 'b', title: 'B', storageUrl: 'https://youtu.be/x' },
      { id: 'c', title: 'C', storageUrl: signedFor(PATH) },
      { id: 'd', title: 'D', storageUrl: '' },
      { id: 'e', title: 'E' },
    ]);
    // the rows that came in are not changed
    expect(rows[0].storageUrl).toBe(PUBLIC);
  });

  it('creates no client when no row needs signing', async () => {
    let created = 0;
    const rows = [{ storageUrl: 'https://youtu.be/x' }, { storageUrl: null }];
    const out = await withSignedContentUrls(rows, {
      supabaseUrl: ORIGIN,
      client: () => {
        created += 1;
        return null;
      },
    });
    expect(out).toEqual(rows);
    expect(created).toBe(0);
  });

  it('signs the several address fields of an enabler in one request', async () => {
    const fake = fakeStorage();
    const [enabler] = await withSignedContentFields(
      [
        {
          title: 'E',
          scenarioPdfUrl: PUBLIC,
          pptUrl: 'slides/a.pdf',
          videoUrl: 'https://youtu.be/x',
          other: PUBLIC,
        },
      ],
      ['scenarioPdfUrl', 'pptUrl', 'videoUrl'],
      deps(fake)
    );
    expect(enabler).toEqual({
      title: 'E',
      scenarioPdfUrl: signedFor(PATH),
      pptUrl: signedFor('slides/a.pdf'),
      videoUrl: 'https://youtu.be/x',
      // a field that is not named is not touched
      other: PUBLIC,
    });
    expect(fake.calls).toHaveLength(1);
  });

  it('leaves a null field null', async () => {
    const [row] = await withSignedContentFields(
      [{ scenarioPdfUrl: null, pptUrl: null }],
      ['scenarioPdfUrl', 'pptUrl']
    );
    expect(row).toEqual({ scenarioPdfUrl: null, pptUrl: null });
  });
});

describe('defaultSigningClient', () => {
  const keep = { ...process.env };
  const restore = () => {
    for (const key of [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_SECRET_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]) {
      if (keep[key] === undefined) delete process.env[key];
      else process.env[key] = keep[key];
    }
  };

  it('needs the url and the secret key, otherwise it is null', () => {
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
      delete process.env.SUPABASE_SECRET_KEY;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      expect(defaultSigningClient()).toBeNull();
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_URL;
      process.env.SUPABASE_SECRET_KEY = 'sb-secret';
      expect(defaultSigningClient()).toBeNull();
    } finally {
      restore();
    }
  });

  it('is a client with both (the storage calls are made with the secret key)', () => {
    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
      process.env.SUPABASE_SECRET_KEY = 'sb-secret';
      expect(defaultSigningClient()).not.toBeNull();
    } finally {
      restore();
    }
  });
});

describe('hideOtherPrivate (the routes that serve trainees)', () => {
  it('empties a private reference of another bucket, in any spelling, and leaves links alone', async () => {
    const fake = fakeStorage();
    const values = [
      'private://content-solutions/preview/kfbm/x.pdf',
      '  PRIVATE://content-solutions/x.pdf',
      'private://avatar/x.png',
      'https://www.youtube.com/watch?v=abc',
    ];
    expect(
      await signContentValues(values, deps(fake, { hideOtherPrivate: true }))
    ).toEqual(['', '', '', 'https://www.youtube.com/watch?v=abc']);
    // without the option the trainer lists keep their own second pass
    expect(await signContentValues(values, deps(fake))).toEqual(values);
  });
});
