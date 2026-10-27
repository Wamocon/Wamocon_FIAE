/**
 * @jest-environment node
 */
// The staging of a quiz JSON file and an Excel file (package UP2): the extension, the first
// bytes, the size limit of each kind, the storage path and the content type.
import {
  LIMITS,
  MEGABYTE,
  maxFileBytesFor,
} from '@/lib/content-upload/staging/config';
import {
  announceFiles,
  completeFiles,
} from '@/lib/content-upload/staging/files';
import {
  MAGIC_HEAD_BYTES,
  magicRejectionCode,
  matchesMagic,
} from '@/lib/content-upload/staging/magic';
import {
  UPLOAD_EXTENSIONS,
  cleanRelativePath,
  isStoragePathOfRun,
  parseUploadStoragePath,
  uploadStoragePath,
} from '@/lib/content-upload/staging/paths';
import { resetRateLimits } from '@/lib/rate-limit';

import {
  docxBytes,
  entryFor,
  newRun,
  pdfBytes,
  setup,
} from '../../../helpers/uploadServiceFixtures';

beforeEach(() => resetRateLimits());

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('the first bytes of a JSON file and an Excel file', () => {
  it('takes a JSON object after a byte order mark and white space, and nothing else', () => {
    expect(matchesMagic('json', text('{"a":1}'))).toBe(true);
    expect(matchesMagic('json', text('  \r\n\t{"a":1}'))).toBe(true);
    expect(matchesMagic('json', bytes(0xef, 0xbb, 0xbf, 0x7b))).toBe(true);
    expect(
      matchesMagic('json', bytes(0xef, 0xbb, 0xbf, 0x20, 0x0a, 0x7b))
    ).toBe(true);
    for (const other of [
      '[1,2]',
      '"x"',
      '42',
      'null',
      'true',
      '<html>',
      '%PDF-1.7',
      '',
      '   ',
      '\u0000{',
    ]) {
      expect(matchesMagic('json', text(other))).toBe(false);
    }
    // a zip, a PDF
    expect(matchesMagic('json', bytes(0x50, 0x4b, 0x03, 0x04))).toBe(false);
    // two byte order marks, a UTF-16 mark
    expect(
      matchesMagic('json', bytes(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x7b))
    ).toBe(false);
    expect(matchesMagic('json', bytes(0xff, 0xfe, 0x7b, 0x00))).toBe(false);
  });

  it('reads no more than the head it asked for, so a file of white space is no object', () => {
    const blanks = new Uint8Array(MAGIC_HEAD_BYTES).fill(0x20);
    expect(matchesMagic('json', blanks)).toBe(false);
    const late = new Uint8Array(MAGIC_HEAD_BYTES + 2).fill(0x20);
    late[MAGIC_HEAD_BYTES + 1] = 0x7b;
    expect(matchesMagic('json', late.subarray(0, MAGIC_HEAD_BYTES))).toBe(
      false
    );
  });

  it('takes a zip for xlsx and docx, a PDF mark for pdf', () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04, 1);
    expect(matchesMagic('xlsx', zip)).toBe(true);
    expect(matchesMagic('docx', zip)).toBe(true);
    expect(matchesMagic('xlsx', text('{"a":1}'))).toBe(false);
    expect(matchesMagic('xlsx', bytes(0xd0, 0xcf, 0x11, 0xe0))).toBe(false);
    expect(matchesMagic('pdf', text('%PDF-1.4'))).toBe(true);
    expect(matchesMagic('pdf', zip)).toBe(false);
  });

  it('names one stable code per kind', () => {
    expect(UPLOAD_EXTENSIONS.map(magicRejectionCode)).toEqual([
      'NOT_A_DOCX',
      'NOT_A_PDF',
      'NOT_A_JSON',
      'NOT_AN_XLSX',
    ]);
  });
});

describe('the size limit of each kind', () => {
  it('is 25 MB for Word and PDF, 32 MB for JSON and 5 MB for Excel, and small for an unknown kind', () => {
    expect(maxFileBytesFor('docx')).toBe(25 * MEGABYTE);
    expect(maxFileBytesFor('pdf')).toBe(25 * MEGABYTE);
    expect(maxFileBytesFor('json')).toBe(32 * MEGABYTE);
    expect(maxFileBytesFor('xlsx')).toBe(5 * MEGABYTE);
    expect(maxFileBytesFor('exe')).toBe(5 * MEGABYTE);
    expect(maxFileBytesFor('')).toBe(5 * MEGABYTE);
    expect(LIMITS.maxJsonBytes).toBe(32 * MEGABYTE);
    // the bucket limit the owner sets (32 MB) is not below any kind
    expect(Math.max(...UPLOAD_EXTENSIONS.map(maxFileBytesFor))).toBe(
      32 * MEGABYTE
    );
  });

  it('refuses an announce above the limit of its own kind', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    let n = 0;
    const entry = (path: string, size: number) => ({
      path,
      size,
      sha256: (n++).toString(16).padStart(64, '0'),
    });
    const result = await announceFiles(ctx.deps, run, {
      files: [
        entry('a/ok.json', 32 * MEGABYTE),
        entry('a/big.json', 32 * MEGABYTE + 1),
        entry('a/ok.xlsx', 5 * MEGABYTE),
        entry('a/big.xlsx', 5 * MEGABYTE + 1),
        entry('a/ok.docx', 25 * MEGABYTE),
        entry('a/big.docx', 25 * MEGABYTE + 1),
        entry('a/big.pdf', 26 * MEGABYTE),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results.map(r => [r.status, r.code])).toEqual([
      ['announced', undefined],
      ['rejected', 'TOO_LARGE'],
      ['announced', undefined],
      ['rejected', 'TOO_LARGE'],
      ['announced', undefined],
      ['rejected', 'TOO_LARGE'],
      ['rejected', 'TOO_LARGE'],
    ]);
  });
});

describe('the path of a JSON file and an Excel file', () => {
  it('takes the two kinds, in any case, and nothing around them', () => {
    for (const name of ['a/q.json', 'a/Q.JSON', 'a/t.xlsx', 'a/T.XlSx']) {
      expect(cleanRelativePath(name)).toMatchObject({ ok: true });
    }
    expect(cleanRelativePath('a/q.JSON')).toMatchObject({ ext: 'json' });
    for (const name of [
      'a/q.json.txt',
      'a/q.jsonl',
      'a/q.json5',
      'a/t.xlsm',
      'a/t.xlsb',
      'a/t.xls',
      'a/t.csv',
      'a/q.json.',
      'a/json',
    ]) {
      expect(cleanRelativePath(name)).toMatchObject({
        ok: false,
        code: 'UNSUPPORTED_EXTENSION',
      });
    }
  });

  it('builds a storage path from two uuids and one of four extensions, and parses nothing else', () => {
    const run = 'cccccccc-0000-4000-8000-000000000001';
    const file = 'aaaaaaaa-0000-4000-8000-000000000002';
    for (const ext of UPLOAD_EXTENSIONS) {
      const path = uploadStoragePath(run, file, ext, 'public');
      expect(path).toBe(`upload/${run}/${file}.${ext}`);
      expect(parseUploadStoragePath(path, 'public')).toEqual({
        runId: run,
        fileId: file,
        ext,
      });
      expect(isStoragePathOfRun(path, run, 'public')).toBe(true);
      expect(uploadStoragePath(run, file, ext, 'public_preview')).toBe(
        `preview/upload/${run}/${file}.${ext}`
      );
    }
    expect(() =>
      uploadStoragePath(run, file, 'exe' as never, 'public')
    ).toThrow('docx, pdf, json or xlsx');
    for (const bad of [
      `upload/${run}/${file}.json.exe`,
      `upload/${run}/${file}.JSON`,
      `upload/${run}/${file}.xlsm`,
      `upload/${run}/../${file}.json`,
      `upload/${run}/${file}.json?x=1`,
      `preview/upload/${run}/${file}.json`,
    ]) {
      expect(parseUploadStoragePath(bad, 'public')).toBeNull();
    }
  });
});

describe('reporting a JSON file and an Excel file as done', () => {
  async function completeWith(path: string, stored: Uint8Array) {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const announced = await announceFiles(ctx.deps, run, {
      files: [entryFor(path, stored)],
    });
    const id = announced.ok ? announced.data.results[0].fileId! : '';
    const [row] = await ctx.repo.getFiles(run.id, [id]);
    ctx.mem.put(row.storagePath, stored);
    const done = await completeFiles(ctx.deps, run, { fileIds: [id] });
    return { ctx, row, done, id };
  }

  it('lets a JSON object and a zip through, as uploaded', async () => {
    const json = await completeWith(
      'a/q.json',
      text('  {"schema_version":"1.0"}')
    );
    expect(json.done.ok && json.done.data.results).toEqual([
      { fileId: json.id, status: 'uploaded' },
    ]);
    const xlsx = await completeWith('a/t.xlsx', docxBytes('zip like'));
    expect(xlsx.done.ok && xlsx.done.data.results).toEqual([
      { fileId: xlsx.id, status: 'uploaded' },
    ]);
  });

  it.each([
    ['a/q.json', 'NOT_A_JSON', () => pdfBytes('same length..')],
    ['a/q.json', 'NOT_A_JSON', () => text('[1, 2, 3, 4]')],
    ['a/q.json', 'NOT_A_JSON', () => docxBytes('same length..')],
    ['a/t.xlsx', 'NOT_AN_XLSX', () => text('{"schema_version":"1.0"}')],
    ['a/t.xlsx', 'NOT_AN_XLSX', () => pdfBytes('same length..')],
    ['a/x.docx', 'NOT_A_DOCX', () => text('{"schema_version":"1.0"}')],
  ])(
    'rejects %s holding the wrong thing (%s) and deletes the object',
    async (path, code, other) => {
      const { ctx, row, done, id } = await completeWith(path, other());
      expect(done.ok && done.data.results).toEqual([
        { fileId: id, status: 'rejected', code },
      ]);
      expect(ctx.mem.objects.has(row.storagePath)).toBe(false);
    }
  );
});
