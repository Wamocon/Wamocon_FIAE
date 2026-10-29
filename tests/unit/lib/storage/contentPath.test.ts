/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import {
  canonicalStoredAddress,
  contentPrivateReference,
  isSafeContentPath,
  isTraineeFileReference,
  parseContentReference,
} from '@/lib/storage/contentPath';

// A stored address names a file of the bucket content in one of four forms:
// the public url of the own project, a signed url that was saved by mistake,
// the private reference private://content/<path> and the bare path. The path
// is checked on the raw string with a strict alphabet, never decoded.

const ORIGIN = 'https://proj.supabase.co';
const options = { supabaseUrl: ORIGIN };
const PATH = 'preview/kfbm/K6.2-d/szenario/UC_6d_Titel.pdf';

describe('parseContentReference: the four forms', () => {
  it('reads the public url of the own project', () => {
    expect(
      parseContentReference(
        `${ORIGIN}/storage/v1/object/public/content/${PATH}`,
        options
      )
    ).toEqual({ kind: 'content', path: PATH, form: 'public' });
  });

  it('reads a signed url of the own project and drops the token', () => {
    expect(
      parseContentReference(
        `${ORIGIN}/storage/v1/object/sign/content/${PATH}?token=abc.def-1_2`,
        options
      )
    ).toEqual({ kind: 'content', path: PATH, form: 'signed' });
  });

  it('reads the private reference of the bucket content', () => {
    expect(
      parseContentReference(contentPrivateReference(PATH), options)
    ).toEqual({ kind: 'content', path: PATH, form: 'private' });
  });

  it('reads a bare path, with and without the preview prefix', () => {
    expect(parseContentReference(PATH, options)).toEqual({
      kind: 'content',
      path: PATH,
      form: 'path',
    });
    expect(
      parseContentReference('99999999-9999-4999-8999-999999999999/1_a.pdf')
    ).toMatchObject({ kind: 'content', form: 'path' });
    expect(parseContentReference('WMC_Logo.png')).toMatchObject({
      kind: 'content',
      path: 'WMC_Logo.png',
    });
  });

  it('takes the project url from NEXT_PUBLIC_SUPABASE_URL by default', () => {
    const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
    try {
      expect(
        parseContentReference(
          `${ORIGIN}/storage/v1/object/public/content/a.pdf`
        )
      ).toMatchObject({ kind: 'content', path: 'a.pdf' });
    } finally {
      if (saved === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
    }
  });
});

describe('parseContentReference: what is not an object of the bucket content', () => {
  it.each([
    [''],
    ['   '],
    [null],
    [undefined],
    [42],
    ['https://www.youtube.com/watch?v=abc'],
    [`https://evil.example/storage/v1/object/public/content/${PATH}`],
    [`${ORIGIN}.evil.example/storage/v1/object/public/content/${PATH}`],
    [
      `https://proj.supabase.co@evil.example/storage/v1/object/public/content/a.pdf`,
    ],
    [`http://proj.supabase.co/storage/v1/object/public/content/a.pdf`],
    [`${ORIGIN}/storage/v1/object/public/avatar/a.png`],
    [`${ORIGIN}/storage/v1/object/public/content-solutions/${PATH}`],
    [`${ORIGIN}/rest/v1/profiles`],
    [`${ORIGIN}/auth/v1/admin/users`],
    ['private://content-solutions/preview/kfbm/x.pdf'],
    ['private://avatar/x.png'],
    ['private://content'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>'],
    ['file:///etc/passwd'],
    ['//evil.example/x.pdf'],
    ['/etc/passwd'],
    ['\\\\server\\share\\x.pdf'],
    ['a b.pdf'],
    ['Übung.pdf'],
  ])('%p is none of the bucket content', value => {
    expect(parseContentReference(value, options).kind).toBe('other');
  });
});

describe('parseContentReference: a path that is not safe is invalid, never signed', () => {
  const bad = [
    '../secret.pdf',
    'a/../b.pdf',
    'a/./b.pdf',
    '/a.pdf',
    'a//b.pdf',
    'a/',
    '%2e%2e/x.pdf',
    'a/%2e%2e/x.pdf',
    'a%2fb.pdf',
    'a%00.pdf',
    'a\\b.pdf',
    'a;b.pdf',
    'a?b.pdf',
    'a#b.pdf',
    'a*.pdf',
    '.',
    '..',
  ];

  it.each(bad)('the private reference with %p is invalid', path => {
    expect(
      parseContentReference(`private://content/${path}`, options).kind
    ).toBe('invalid');
  });

  it.each(bad.filter(path => !path.startsWith('?')))(
    'the public url with %p is invalid',
    path => {
      const result = parseContentReference(
        `${ORIGIN}/storage/v1/object/public/content/${path}`,
        options
      );
      expect(result.kind).toBe('invalid');
    }
  );

  it('refuses a query on a public url and a signed url without a token', () => {
    expect(
      parseContentReference(
        `${ORIGIN}/storage/v1/object/public/content/a.pdf?download=1`,
        options
      ).kind
    ).toBe('invalid');
    expect(
      parseContentReference(
        `${ORIGIN}/storage/v1/object/sign/content/a.pdf`,
        options
      ).kind
    ).toBe('invalid');
    expect(
      parseContentReference(
        `${ORIGIN}/storage/v1/object/sign/content/a.pdf?token=a&x=1`,
        options
      ).kind
    ).toBe('invalid');
  });

  it('refuses a path that is too long or too deep', () => {
    expect(isSafeContentPath('a/'.repeat(13) + 'b.pdf')).toBe(false);
    expect(isSafeContentPath(`${'a'.repeat(210)}.pdf`)).toBe(false);
    expect(isSafeContentPath(`${'a/'.repeat(5)}${'b'.repeat(500)}`)).toBe(
      false
    );
    expect(parseContentReference('x'.repeat(2100), options).kind).toBe(
      'invalid'
    );
  });

  it('a project url that is no address, or carries credentials, never matches', () => {
    for (const supabaseUrl of [
      'not an address',
      'https://user:pw@proj.supabase.co',
    ]) {
      expect(
        parseContentReference(
          'https://proj.supabase.co/storage/v1/object/public/content/a.pdf',
          { supabaseUrl }
        ).kind
      ).toBe('other');
    }
  });

  it('without a project url no absolute url is of the bucket content', () => {
    expect(
      parseContentReference(
        `${ORIGIN}/storage/v1/object/public/content/a.pdf`,
        { supabaseUrl: null }
      ).kind
    ).toBe('other');
    expect(
      parseContentReference(
        `${ORIGIN}/storage/v1/object/public/content/a.pdf`,
        { supabaseUrl: 'ftp://proj.supabase.co' }
      ).kind
    ).toBe('other');
  });
});

describe('isSafeContentPath', () => {
  it('accepts letters, digits, dot, underscore, hyphen and the slash between', () => {
    expect(isSafeContentPath(PATH)).toBe(true);
    expect(isSafeContentPath('a.b-c_d/e')).toBe(true);
  });
  it('refuses empty, non-strings and dot segments', () => {
    for (const value of ['', null, undefined, 1, '.', '..', 'a/..', '../a']) {
      expect(isSafeContentPath(value)).toBe(false);
    }
  });
});

describe('isTraineeFileReference', () => {
  it('lets a trainee have every address except the private reference of another bucket', () => {
    expect(isTraineeFileReference('https://x/y.pdf')).toBe(true);
    expect(isTraineeFileReference('preview/a/b.pdf')).toBe(true);
    expect(isTraineeFileReference(contentPrivateReference(PATH))).toBe(true);
    // another spelling of a private reference is no way around the rule
    expect(isTraineeFileReference('PRIVATE://content-solutions/x.pdf')).toBe(false);
    expect(isTraineeFileReference('  private://content-solutions/x.pdf')).toBe(false);
    expect(isTraineeFileReference('PRIVATE://content/x.pdf')).toBe(false);
    expect(
      isTraineeFileReference('private://content-solutions/preview/kfbm/x.pdf')
    ).toBe(false);
    expect(isTraineeFileReference('private://avatar/x.png')).toBe(false);
    expect(isTraineeFileReference('private://other/x.pdf')).toBe(false);
  });
});

describe('canonicalStoredAddress', () => {
  it('turns a signed url of the own project into the public url of the same file', () => {
    expect(
      canonicalStoredAddress(
        `${ORIGIN}/storage/v1/object/sign/content/${PATH}?token=abc`,
        options
      )
    ).toBe(`${ORIGIN}/storage/v1/object/public/content/${PATH}`);
  });

  it('leaves everything else as it is', () => {
    for (const value of [
      `${ORIGIN}/storage/v1/object/public/content/${PATH}`,
      contentPrivateReference(PATH),
      PATH,
      'https://www.youtube.com/watch?v=abc',
      `https://evil.example/storage/v1/object/sign/content/${PATH}?token=abc`,
      '',
    ]) {
      expect(canonicalStoredAddress(value, options)).toBe(value);
    }
  });
});
