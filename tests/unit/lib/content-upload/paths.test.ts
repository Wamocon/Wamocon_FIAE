import {
  cleanRelativePath,
  isStoragePathOfRun,
  parseUploadStoragePath,
  runStoragePrefix,
  uploadStoragePath,
} from '@/lib/content-upload/paths';

const RUN = '0b8f4c1e-5d7a-4b1c-9d2e-1a2b3c4d5e6f';
const FILE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OTHER = '11111111-2222-4333-8444-555555555555';

function ok(raw: unknown) {
  const result = cleanRelativePath(raw);
  if (!result.ok) throw new Error(`rejected: ${result.code}`);
  return result;
}

function code(raw: unknown) {
  const result = cleanRelativePath(raw);
  return result.ok ? null : result.code;
}

describe('cleanRelativePath: the cleaned relative path (concept 4.4)', () => {
  it('keeps a plain relative path and derives name and extension', () => {
    expect(ok('K6.2/Enabler/K6.2-d_Lehrtext.docx')).toEqual({
      ok: true,
      relPath: 'K6.2/Enabler/K6.2-d_Lehrtext.docx',
      fileName: 'K6.2-d_Lehrtext.docx',
      ext: 'docx',
    });
    expect(ok('Quiz.PDF').ext).toBe('pdf');
  });

  it('turns backslashes into slashes', () => {
    expect(ok('a\\b\\c.docx').relPath).toBe('a/b/c.docx');
  });

  it('removes a drive letter', () => {
    expect(ok('C:\\Users\\x\\a.docx').relPath).toBe('Users/x/a.docx');
    expect(ok('c:/a.pdf').relPath).toBe('a.pdf');
    expect(ok('D:a.pdf').relPath).toBe('a.pdf');
  });

  it('does not treat a colon later in the path as a drive letter', () => {
    expect(ok('a/C:b.pdf').relPath).toBe('a/C:b.pdf');
  });

  it('removes empty, dot and dot-dot segments instead of resolving them', () => {
    expect(ok('../../etc/./passwd.docx').relPath).toBe('etc/passwd.docx');
    expect(ok('/a//b/../c.pdf').relPath).toBe('a/b/c.pdf');
    expect(ok('./a.pdf').relPath).toBe('a.pdf');
  });

  it('keeps encoded traversal as plain text (it is never decoded)', () => {
    const result = ok('%2e%2e/%2e%2e/a.pdf');
    expect(result.relPath).toBe('%2e%2e/%2e%2e/a.pdf');
  });

  it('normalizes to NFC', () => {
    const decomposed = 'Pru\u0308fung.docx';
    expect(ok(decomposed).relPath).toBe('Pr\u00fcfung.docx');
    expect(ok(decomposed).fileName).toBe('Pr\u00fcfung.docx');
  });

  it('removes control, invisible and direction override characters', () => {
    expect(ok('a\u0000b/c\u0007.docx').relPath).toBe('ab/c.docx');
    expect(ok('a\u200Bb\u202E/gpj.docx').relPath).toBe('ab/gpj.docx');
    expect(ok('\uFEFFa\u00ADb.pdf').relPath).toBe('ab.pdf');
    expect(ok('a\u2028b.pdf').relPath).toBe('ab.pdf');
  });

  it('trims the segments', () => {
    expect(ok('  a  /  b.pdf ').relPath).toBe('a/b.pdf');
  });

  it('accepts at most 12 segments and 500 characters', () => {
    const twelve = `${Array.from({ length: 11 }, (_, i) => `d${i}`).join('/')}/f.pdf`;
    expect(ok(twelve).relPath).toBe(twelve);
    expect(code(`x/${twelve}`)).toBe('PATH_TOO_DEEP');

    const long = `${'a'.repeat(100)}/${'b'.repeat(100)}/${'c'.repeat(100)}/${'d'.repeat(100)}/${'e'.repeat(100)}.pdf`;
    expect(long.length).toBeGreaterThan(500);
    expect(code(long)).toBe('PATH_TOO_LONG');
    // the limit is on the cleaned value
    const exactly500 = `${'a'.repeat(100)}/${'b'.repeat(100)}/${'c'.repeat(100)}/${'d'.repeat(100)}/${'e'.repeat(92)}.pdf`;
    expect(exactly500.length).toBe(500);
    expect(ok(exactly500).relPath).toBe(exactly500);
  });

  it('rejects a file name over 200 characters', () => {
    expect(code(`${'a'.repeat(197)}.pdf`)).toBe('FILE_NAME_TOO_LONG');
    expect(ok(`${'a'.repeat(196)}.pdf`).fileName).toHaveLength(200);
  });

  it('rejects everything but docx and pdf, with the reason', () => {
    expect(code('a.doc')).toBe('UNSUPPORTED_EXTENSION');
    expect(code('a.docm')).toBe('UNSUPPORTED_EXTENSION');
    expect(code('a.xlsx')).toBe('UNSUPPORTED_EXTENSION');
    expect(code('a.docx.exe')).toBe('UNSUPPORTED_EXTENSION');
    expect(code('docx')).toBe('UNSUPPORTED_EXTENSION');
    expect(code('a.pdf.')).toBe('UNSUPPORTED_EXTENSION');
  });

  it('rejects Word lock files and hidden temp files', () => {
    expect(code('a/~$Lehrtext.docx')).toBe('TEMP_FILE');
  });

  it('rejects an empty or non-text path', () => {
    expect(code('')).toBe('PATH_EMPTY');
    expect(code('   ')).toBe('PATH_EMPTY');
    expect(code('../..')).toBe('PATH_EMPTY');
    expect(code('C:\\')).toBe('PATH_EMPTY');
    expect(code(undefined)).toBe('PATH_INVALID');
    expect(code(42)).toBe('PATH_INVALID');
    expect(code({})).toBe('PATH_INVALID');
  });

  it('rejects an absurdly long raw value before cleaning it', () => {
    expect(code('a/'.repeat(5000) + 'f.pdf')).toBe('PATH_TOO_LONG');
  });

  it('treats markup as text and leaves it unchanged', () => {
    expect(ok('<img src=x onerror=alert(1)>/a.pdf').relPath).toBe(
      '<img src=x onerror=alert(1)>/a.pdf'
    );
  });
});

describe('storage paths of the staging bucket (concept 4.4)', () => {
  it('builds [preview/]upload/<run>/<file>.<ext> from two uuids', () => {
    expect(uploadStoragePath(RUN, FILE, 'docx', 'public')).toBe(
      `upload/${RUN}/${FILE}.docx`
    );
    expect(uploadStoragePath(RUN, FILE, 'pdf', 'public_preview')).toBe(
      `preview/upload/${RUN}/${FILE}.pdf`
    );
    expect(runStoragePrefix(RUN, 'public')).toBe(`upload/${RUN}/`);
    expect(runStoragePrefix(RUN, 'public_preview')).toBe(
      `preview/upload/${RUN}/`
    );
  });

  it('refuses to build a path from anything but uuids and the two extensions', () => {
    expect(() => uploadStoragePath('../x', FILE, 'pdf', 'public')).toThrow();
    expect(() =>
      uploadStoragePath(RUN, `${FILE}/..`, 'pdf', 'public')
    ).toThrow();
    expect(() =>
      uploadStoragePath(RUN, FILE, 'exe' as any, 'public')
    ).toThrow();
    expect(() =>
      uploadStoragePath(RUN.toUpperCase(), FILE, 'pdf', 'public')
    ).toThrow();
  });

  it('parses exactly the one form of the schema', () => {
    expect(
      parseUploadStoragePath(`upload/${RUN}/${FILE}.pdf`, 'public')
    ).toEqual({ runId: RUN, fileId: FILE, ext: 'pdf' });
    expect(
      parseUploadStoragePath(
        `preview/upload/${RUN}/${FILE}.docx`,
        'public_preview'
      )
    ).toEqual({ runId: RUN, fileId: FILE, ext: 'docx' });
  });

  it('keeps Preview and Production apart: no optional prefix', () => {
    // Preview must not reach the path of Production and the other way round
    expect(
      parseUploadStoragePath(`upload/${RUN}/${FILE}.pdf`, 'public_preview')
    ).toBeNull();
    expect(
      parseUploadStoragePath(`preview/upload/${RUN}/${FILE}.pdf`, 'public')
    ).toBeNull();
  });

  it.each([
    `upload/${RUN}/${FILE}.exe`,
    `upload/${RUN}/${FILE}.pdf/`,
    `upload/${RUN}/${FILE}.pdf?x=1`,
    `upload/${RUN}/${FILE}.pdf#x`,
    `upload/${RUN}/../${RUN}/${FILE}.pdf`,
    `upload/${RUN}//${FILE}.pdf`,
    `upload/${RUN}/%2e%2e/${FILE}.pdf`,
    `upload/${RUN}/${FILE}.PDF`,
    `upload/${RUN.toUpperCase()}/${FILE}.pdf`,
    `/upload/${RUN}/${FILE}.pdf`,
    `upload/${RUN}/${FILE}.pdf\n`,
    `upload/${RUN}/x/${FILE}.pdf`,
    `upload/${RUN}/${FILE}.pdf.pdf`,
    `upload/${RUN}`,
    `upload/${RUN}/`,
    `content/${RUN}/${FILE}.pdf`,
    `upload/not-a-uuid/${FILE}.pdf`,
    'upload\\x\\y.pdf',
    '',
  ])('rejects the path %j', raw => {
    expect(parseUploadStoragePath(raw, 'public')).toBeNull();
  });

  it('rejects values that are not text', () => {
    expect(parseUploadStoragePath(undefined as any, 'public')).toBeNull();
    expect(parseUploadStoragePath(null as any, 'public')).toBeNull();
    expect(parseUploadStoragePath(42 as any, 'public')).toBeNull();
  });

  it('checks that a path belongs to the run', () => {
    const path = `upload/${RUN}/${FILE}.pdf`;
    expect(isStoragePathOfRun(path, RUN, 'public')).toBe(true);
    expect(isStoragePathOfRun(path, OTHER, 'public')).toBe(false);
    expect(
      isStoragePathOfRun(`upload/${OTHER}/${FILE}.pdf`, RUN, 'public')
    ).toBe(false);
    expect(isStoragePathOfRun(`${path}x`, RUN, 'public')).toBe(false);
    expect(isStoragePathOfRun(path, 'nope', 'public')).toBe(false);
  });
});
