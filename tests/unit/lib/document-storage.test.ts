/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  DOCUMENT_BUCKET,
  documentStoragePath,
  isOwnedStoragePath,
} from '@/lib/document-storage';

// The upload of a document (PdfUploader) writes the file to
//   content/[preview/]<user id>/<timestamp>_<safe file name>
// and sends the public url to the document route. The server accepts exactly
// this form for the person who sends it, nothing else.

const SUPABASE = 'https://abc.supabase.co';
const USER = '99999999-9999-4999-8999-999999999999';
const OTHER = '11111111-1111-4111-8111-111111111111';
const FILE = '1700000000000_skript.pdf';
const PUBLIC = `${SUPABASE}/storage/v1/object/public/${DOCUMENT_BUCKET}/`;

const accepts = (raw: unknown, owner = USER, schema?: any) =>
  documentStoragePath(raw, owner, { supabaseUrl: SUPABASE, schema });

describe('documentStoragePath', () => {
  it('accepts the public url of an own upload and returns the path in the bucket', () => {
    expect(accepts(`${PUBLIC}${USER}/${FILE}`)).toBe(`${USER}/${FILE}`);
  });

  it('accepts the bare path of an own upload', () => {
    expect(accepts(`${USER}/${FILE}`)).toBe(`${USER}/${FILE}`);
  });

  it('accepts the file names that the uploader produces', () => {
    for (const name of [
      '1700000000000_a_b.pdf',
      '1700000000000_Bericht-2024.v2.PDF',
      '1_x',
      '1700000000000_a..pdf',
    ]) {
      expect(accepts(`${PUBLIC}${USER}/${name}`)).toBe(`${USER}/${name}`);
    }
  });

  describe('Preview', () => {
    it('requires the preview/ prefix', () => {
      expect(
        accepts(`${PUBLIC}preview/${USER}/${FILE}`, USER, 'public_preview')
      ).toBe(`preview/${USER}/${FILE}`);
      expect(
        accepts(`${PUBLIC}${USER}/${FILE}`, USER, 'public_preview')
      ).toBeNull();
      expect(accepts(`${USER}/${FILE}`, USER, 'public_preview')).toBeNull();
    });

    it('does not accept the preview/ prefix in Production', () => {
      expect(
        accepts(`${PUBLIC}preview/${USER}/${FILE}`, USER, 'public')
      ).toBeNull();
      expect(accepts(`preview/${USER}/${FILE}`, USER, 'public')).toBeNull();
    });
  });

  describe('refuses', () => {
    it.each([
      ['another user folder', `${PUBLIC}${OTHER}/${FILE}`],
      ['another user folder, bare', `${OTHER}/${FILE}`],
      ['a curriculum folder', `${PUBLIC}use-cases/A/B/${FILE}`],
      ['a file directly in the bucket', `${PUBLIC}${FILE}`],
      ['a deeper path', `${PUBLIC}${USER}/sub/${FILE}`],
      ['a path with dot dot', `${PUBLIC}${USER}/../${OTHER}/${FILE}`],
      ['a path that climbs out', `${PUBLIC}${USER}/../../${FILE}`],
      ['a dot dot as the file', `${PUBLIC}${USER}/..`],
      ['a dot dot as the folder', `${PUBLIC}../${USER}/${FILE}`],
      ['an encoded dot dot', `${PUBLIC}${USER}/%2e%2e/${OTHER}/${FILE}`],
      ['an encoded slash', `${PUBLIC}${USER}%2f${FILE}`],
      ['an encoded name', `${PUBLIC}${USER}/1700000000000_a%2fb.pdf`],
      ['a double encoded name', `${PUBLIC}${USER}/1700000000000_a%252e.pdf`],
      ['a backslash', `${PUBLIC}${USER}\\${FILE}`],
      ['a name without timestamp', `${PUBLIC}${USER}/skript.pdf`],
      ['an empty name', `${PUBLIC}${USER}/`],
      ['a query string', `${PUBLIC}${USER}/${FILE}?token=x`],
      ['a fragment', `${PUBLIC}${USER}/${FILE}#x`],
      ['a space', `${PUBLIC}${USER}/1700000000000_a b.pdf`],
      ['a line break', `${PUBLIC}${USER}/${FILE}\n`],
      ['a null byte', `${PUBLIC}${USER}/${FILE}\u0000`],
      [
        'another bucket',
        `${SUPABASE}/storage/v1/object/public/avatar/${USER}/${FILE}`,
      ],
      [
        'the authenticated route',
        `${SUPABASE}/storage/v1/object/authenticated/content/${USER}/${FILE}`,
      ],
      [
        'another project',
        `https://evil.supabase.co/storage/v1/object/public/content/${USER}/${FILE}`,
      ],
      [
        'a host that merely contains the project',
        `https://abc.supabase.co.evil.test/storage/v1/object/public/content/${USER}/${FILE}`,
      ],
      [
        'credentials in the url',
        `https://abc.supabase.co@evil.test/storage/v1/object/public/content/${USER}/${FILE}`,
      ],
      [
        'another scheme',
        `ftp://abc.supabase.co/storage/v1/object/public/content/${USER}/${FILE}`,
      ],
      ['a javascript url', 'javascript:alert(1)'],
      ['a data url', 'data:application/pdf;base64,AAAA'],
      ['a file url', `file:///${USER}/${FILE}`],
      [
        'a protocol relative url',
        `//abc.supabase.co/storage/v1/object/public/content/${USER}/${FILE}`,
      ],
      [
        'plain http for an https project',
        `http://abc.supabase.co/storage/v1/object/public/content/${USER}/${FILE}`,
      ],
      [
        'an upper case host',
        `HTTPS://ABC.SUPABASE.CO/storage/v1/object/public/content/${USER}/${FILE}`,
      ],
      ['a leading slash', `/${USER}/${FILE}`],
      ['a leading space', ` ${PUBLIC}${USER}/${FILE}`],
      ['an empty string', ''],
      ['a number', 5],
      ['null', null],
      ['undefined', undefined],
      ['an object', { url: `${PUBLIC}${USER}/${FILE}` }],
      ['an array', [`${PUBLIC}${USER}/${FILE}`]],
    ])('%s', (_name, raw) => {
      expect(accepts(raw)).toBeNull();
    });

    it('a name that is too long', () => {
      expect(
        accepts(`${PUBLIC}${USER}/1700000000000_${'a'.repeat(300)}`)
      ).toBeNull();
    });

    it('an empty owner', () => {
      expect(accepts(`${PUBLIC}/${FILE}`, '')).toBeNull();
      expect(accepts(`/${FILE}`, '')).toBeNull();
    });

    it('an owner id that is no plain id', () => {
      expect(accepts(`${PUBLIC}../${FILE}`, '..')).toBeNull();
      expect(accepts(`a/b/${FILE}`, 'a/b')).toBeNull();
    });
  });

  describe('the project url', () => {
    it('refuses every url form when no Supabase url is configured, the bare path still works', () => {
      const url = `${PUBLIC}${USER}/${FILE}`;
      expect(documentStoragePath(url, USER, { supabaseUrl: null })).toBeNull();
      expect(documentStoragePath(url, USER, { supabaseUrl: '' })).toBeNull();
      expect(
        documentStoragePath(`${USER}/${FILE}`, USER, { supabaseUrl: null })
      ).toBe(`${USER}/${FILE}`);
    });

    it('ignores a trailing slash and a path in the configured url', () => {
      expect(
        documentStoragePath(`${PUBLIC}${USER}/${FILE}`, USER, {
          supabaseUrl: `${SUPABASE}/`,
        })
      ).toBe(`${USER}/${FILE}`);
    });

    it('accepts a local project with a port', () => {
      const local = 'http://127.0.0.1:54321';
      expect(
        documentStoragePath(
          `${local}/storage/v1/object/public/content/${USER}/${FILE}`,
          USER,
          { supabaseUrl: local }
        )
      ).toBe(`${USER}/${FILE}`);
      expect(
        documentStoragePath(
          `http://127.0.0.1:9/storage/v1/object/public/content/${USER}/${FILE}`,
          USER,
          { supabaseUrl: local }
        )
      ).toBeNull();
    });

    it('refuses everything for an unreadable configured url', () => {
      expect(
        documentStoragePath(`${PUBLIC}${USER}/${FILE}`, USER, {
          supabaseUrl: 'not a url',
        })
      ).toBeNull();
    });

    it('reads NEXT_PUBLIC_SUPABASE_URL when no option is given', () => {
      const before = process.env.NEXT_PUBLIC_SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
      try {
        expect(documentStoragePath(`${PUBLIC}${USER}/${FILE}`, USER)).toBe(
          `${USER}/${FILE}`
        );
      } finally {
        if (before === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
        else process.env.NEXT_PUBLIC_SUPABASE_URL = before;
      }
    });
  });
});

describe('isOwnedStoragePath', () => {
  const doc = (storageUrl: unknown, uploadedById: unknown = USER) => ({
    storageUrl,
    uploadedById,
  });
  const owned = (storageUrl: unknown, uploadedById?: unknown) =>
    isOwnedStoragePath(
      uploadedById === undefined
        ? doc(storageUrl)
        : doc(storageUrl, uploadedById),
      { supabaseUrl: SUPABASE }
    );

  it('returns the path of a file in the folder of the uploader', () => {
    expect(owned(`${PUBLIC}${USER}/${FILE}`)).toBe(`${USER}/${FILE}`);
  });

  it('is the path of the uploader, not of the person who deletes', () => {
    expect(owned(`${PUBLIC}${OTHER}/${FILE}`, OTHER)).toBe(`${OTHER}/${FILE}`);
    expect(owned(`${PUBLIC}${OTHER}/${FILE}`, USER)).toBeNull();
  });

  it('is null for the files of the curriculum import', () => {
    expect(owned(`${PUBLIC}use-cases/A/B/${FILE}`)).toBeNull();
  });

  it('is null for a document without an uploader or a url', () => {
    expect(owned(`${PUBLIC}${USER}/${FILE}`, null)).toBeNull();
    expect(owned(`${PUBLIC}${USER}/${FILE}`, '')).toBeNull();
    expect(owned('', USER)).toBeNull();
    expect(owned(null, USER)).toBeNull();
  });

  it('is null for a url of another project and for a path trick', () => {
    expect(
      owned(
        `https://evil.test/storage/v1/object/public/content/${USER}/${FILE}`
      )
    ).toBeNull();
    expect(owned(`${PUBLIC}${USER}/../${OTHER}/${FILE}`)).toBeNull();
  });
});
