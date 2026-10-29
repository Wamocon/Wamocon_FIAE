/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import {
  MAX_SUBMISSION_FILE_BYTES,
  SUBMISSION_BUCKET_SETTINGS,
  checkAnnouncedFile,
  extensionOf,
  fileFolder,
  filePath,
  incomingFolder,
  incomingPath,
  isSubmissionFolder,
  matchesSignature,
  mimeOf,
  parseSubmissionPath,
  parseUploadId,
  sanitizeFileName,
  signatureRejectionCode,
  submissionFolder,
} from '@/lib/submission-file/rules';

const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const UPLOAD = '44444444-4444-4444-8444-444444444444';
const scope = { organizationId: ORG, traineeId: TRAINEE, useCaseId: USE_CASE };

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const zip = (...names: string[]) =>
  new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...text(names.join('\u0000'))]);

describe('extensionOf', () => {
  it('takes the last extension in lower case and counts jpeg as jpg', () => {
    expect(extensionOf('Bericht.PDF')).toBe('pdf');
    expect(extensionOf('foto.JPEG')).toBe('jpg');
    expect(extensionOf('a.b.docx')).toBe('docx');
  });

  it('refuses everything else', () => {
    for (const name of [
      'x.zip',
      'x.exe',
      'x.docm',
      'x.xlsm',
      'x',
      'x.',
      'pdf',
    ]) {
      expect(extensionOf(name)).toBeNull();
    }
  });
});

describe('sanitizeFileName', () => {
  it('writes umlauts out and keeps only a safe alphabet', () => {
    expect(sanitizeFileName('Übungsaufgabe Größe (final).pdf', 'pdf')).toBe(
      'Uebungsaufgabe_Groesse_final.pdf'
    );
  });

  it('keeps only the last part of a path, for both separators', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf', 'pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('C:\\Users\\x\\bericht.docx', 'docx')).toBe(
      'bericht.docx'
    );
  });

  it('leaves no second extension in the name', () => {
    expect(sanitizeFileName('report.exe.pdf', 'pdf')).toBe('report_exe.pdf');
  });

  it('forces the extension of the checked type', () => {
    expect(sanitizeFileName('bild.pdf', 'png')).toBe('bild.png');
  });

  it('removes control, direction and zero width characters', () => {
    expect(sanitizeFileName('a\u202Eb\u200Bc\u0000d.pdf', 'pdf')).toBe(
      'abcd.pdf'
    );
  });

  it('shortens a long name and never returns an empty one', () => {
    expect(sanitizeFileName(`${'a'.repeat(300)}.pdf`, 'pdf')).toBe(
      `${'a'.repeat(80)}.pdf`
    );
    expect(sanitizeFileName('....pdf', 'pdf')).toBe('abgabe.pdf');
    expect(sanitizeFileName('%%%.pdf', 'pdf')).toBe('abgabe.pdf');
  });
});

describe('checkAnnouncedFile', () => {
  it('accepts each allowed type with its own MIME type', () => {
    for (const ext of ['pdf', 'docx', 'xlsx', 'png', 'jpg'] as const) {
      const result = checkAnnouncedFile({
        fileName: `datei.${ext}`,
        size: 1000,
        contentType: mimeOf(ext),
      });
      expect(result).toMatchObject({ ok: true, file: { ext } });
    }
  });

  it('takes the type of the extension when the browser sends none', () => {
    expect(
      checkAnnouncedFile({ fileName: 'a.docx', size: 5, contentType: '' })
    ).toMatchObject({ ok: true, file: { contentType: mimeOf('docx') } });
    expect(checkAnnouncedFile({ fileName: 'a.pdf', size: 5 })).toMatchObject({
      ok: true,
    });
  });

  it('refuses a type that is not on the list', () => {
    expect(checkAnnouncedFile({ fileName: 'a.zip', size: 5 })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_TYPE',
    });
    expect(checkAnnouncedFile({ fileName: 'a.svg', size: 5 })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_TYPE',
    });
  });

  it('refuses a MIME type that does not belong to the extension', () => {
    expect(
      checkAnnouncedFile({
        fileName: 'a.pdf',
        size: 5,
        contentType: 'text/html',
      })
    ).toEqual({ ok: false, code: 'TYPE_MISMATCH' });
  });

  it('refuses sizes outside of 1 byte to 10 MB', () => {
    const base = { fileName: 'a.pdf', contentType: 'application/pdf' };
    expect(checkAnnouncedFile({ ...base, size: 0 })).toEqual({
      ok: false,
      code: 'EMPTY_FILE',
    });
    expect(checkAnnouncedFile({ ...base, size: 1.5 })).toEqual({
      ok: false,
      code: 'EMPTY_FILE',
    });
    expect(checkAnnouncedFile({ ...base, size: '5' })).toEqual({
      ok: false,
      code: 'EMPTY_FILE',
    });
    expect(
      checkAnnouncedFile({ ...base, size: MAX_SUBMISSION_FILE_BYTES })
    ).toMatchObject({ ok: true });
    expect(
      checkAnnouncedFile({ ...base, size: MAX_SUBMISSION_FILE_BYTES + 1 })
    ).toEqual({ ok: false, code: 'TOO_LARGE' });
  });

  it('refuses a missing, empty or overlong name', () => {
    for (const fileName of [undefined, 5, '', '   ', 'a'.repeat(256)]) {
      expect(checkAnnouncedFile({ fileName, size: 5 })).toEqual({
        ok: false,
        code: 'FILE_NAME_INVALID',
      });
    }
  });
});

describe('matchesSignature', () => {
  it('knows pdf, png and jpg by their first bytes', () => {
    expect(matchesSignature('pdf', text('%PDF-1.7 ...'))).toBe(true);
    expect(matchesSignature('pdf', text('<html>'))).toBe(false);
    expect(
      matchesSignature(
        'png',
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      )
    ).toBe(true);
    expect(matchesSignature('png', bytes(0x89, 0x50, 0x4e, 0x47))).toBe(false);
    expect(matchesSignature('jpg', bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesSignature('jpg', bytes(0xff, 0xd8))).toBe(false);
    expect(matchesSignature('pdf', new Uint8Array(0))).toBe(false);
  });

  it('wants the parts of the format inside a docx or xlsx', () => {
    expect(
      matchesSignature('docx', zip('[Content_Types].xml', 'word/document.xml'))
    ).toBe(true);
    expect(
      matchesSignature('xlsx', zip('[Content_Types].xml', 'xl/workbook.xml'))
    ).toBe(true);
    // a zip of another kind, or one format under the name of the other
    expect(
      matchesSignature('docx', zip('[Content_Types].xml', 'xl/a.xml'))
    ).toBe(false);
    expect(
      matchesSignature('xlsx', zip('[Content_Types].xml', 'word/document.xml'))
    ).toBe(false);
    expect(matchesSignature('docx', zip('readme.txt'))).toBe(false);
    expect(matchesSignature('docx', text('PK not a zip'))).toBe(false);
  });

  it('refuses a document with a macro part', () => {
    expect(
      matchesSignature(
        'docx',
        zip('[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin')
      )
    ).toBe(false);
  });

  it('refuses embedded objects, ActiveX parts and a zip without the main part', () => {
    const base = ['[Content_Types].xml', 'word/document.xml'];
    expect(
      matchesSignature('docx', zip(...base, 'word/embeddings/oleObject1.bin'))
    ).toBe(false);
    expect(
      matchesSignature('docx', zip(...base, 'word/activeX/activeX1.xml'))
    ).toBe(false);
    expect(
      matchesSignature('docx', zip('[Content_Types].xml', 'word/styles.xml'))
    ).toBe(false);
    expect(
      matchesSignature(
        'xlsx',
        zip('[Content_Types].xml', 'xl/sharedStrings.xml')
      )
    ).toBe(false);
  });

  it('names the rejection per type', () => {
    expect(signatureRejectionCode('pdf')).toBe('NOT_A_PDF');
    expect(signatureRejectionCode('docx')).toBe('NOT_A_DOCX');
    expect(signatureRejectionCode('xlsx')).toBe('NOT_AN_XLSX');
    expect(signatureRejectionCode('png')).toBe('NOT_A_PNG');
    expect(signatureRejectionCode('jpg')).toBe('NOT_A_JPG');
  });
});

describe('paths', () => {
  it('builds the folder from three uuids, with the preview prefix on the preview schema', () => {
    expect(submissionFolder(scope, 'public')).toBe(
      `${ORG}/${TRAINEE}/${USE_CASE}`
    );
    expect(submissionFolder(scope, 'public_preview')).toBe(
      `preview/${ORG}/${TRAINEE}/${USE_CASE}`
    );
  });

  it('builds no folder from an id that is no uuid', () => {
    expect(
      submissionFolder({ ...scope, traineeId: '../x' }, 'public')
    ).toBeNull();
    expect(
      submissionFolder({ ...scope, useCaseId: 'u1' }, 'public')
    ).toBeNull();
    expect(
      submissionFolder({ ...scope, organizationId: `${ORG}/..` }, 'public')
    ).toBeNull();
  });

  it('parses exactly the two object forms of its own schema', () => {
    const folder = submissionFolder(scope, 'public') as string;
    expect(
      parseSubmissionPath(incomingPath(folder, `${UPLOAD}.pdf`), 'public')
    ).toEqual({
      kind: 'incoming',
      scope,
      uploadId: `${UPLOAD}.pdf`,
      ext: 'pdf',
    });
    expect(
      parseSubmissionPath(filePath(folder, 1761700000000, 'a_b.docx'), 'public')
    ).toEqual({
      kind: 'file',
      scope,
      uploadedAt: 1761700000000,
      fileName: 'a_b.docx',
    });
  });

  it('keeps Production and Preview apart', () => {
    const production = submissionFolder(scope, 'public') as string;
    const preview = submissionFolder(scope, 'public_preview') as string;
    const productionObject = filePath(production, 1761700000000, 'a.pdf');
    const previewObject = filePath(preview, 1761700000000, 'a.pdf');
    expect(parseSubmissionPath(productionObject, 'public_preview')).toBeNull();
    expect(parseSubmissionPath(previewObject, 'public')).toBeNull();
    expect(parseSubmissionPath(previewObject, 'public_preview')).not.toBeNull();
  });

  it('refuses every path that is not exactly one of the forms', () => {
    const folder = submissionFolder(scope, 'public') as string;
    const bad = [
      `${folder}/file/../x.pdf`,
      `${folder}/file/1761700000000_%2e%2e.pdf`,
      `${folder}/file/1761700000000_a b.pdf`,
      `${folder}/file/1761700000000_a.pdf?x=1`,
      `${folder}/file/1761700000000_a.exe`,
      `${folder}/file/1761700000000_a.pdf/extra`,
      `${folder}/file/abc_a.pdf`,
      `${folder}/incoming/not-a-uuid.pdf`,
      `${folder}/incoming/${UPLOAD}.zip`,
      `${folder}/other/1761700000000_a.pdf`,
      `${ORG}/${TRAINEE}/1761700000000_a.pdf`,
      `/${folder}/file/1761700000000_a.pdf`,
      `${folder}/file/1761700000000_${'a'.repeat(100)}.pdf`,
    ];
    for (const path of bad) {
      expect(parseSubmissionPath(path, 'public')).toBeNull();
    }
    expect(
      parseSubmissionPath(undefined as unknown as string, 'public')
    ).toBeNull();
  });

  it('recognizes only the two folders of a scope as folders', () => {
    const folder = submissionFolder(scope, 'public') as string;
    expect(isSubmissionFolder(fileFolder(folder), 'public')).toBe(true);
    expect(isSubmissionFolder(incomingFolder(folder), 'public')).toBe(true);
    expect(isSubmissionFolder(folder, 'public')).toBe(false);
    expect(isSubmissionFolder(`${folder}/file/x`, 'public')).toBe(false);
    expect(isSubmissionFolder(`${ORG}/${TRAINEE}/file`, 'public')).toBe(false);
  });

  it('parses an upload id', () => {
    expect(parseUploadId(`${UPLOAD}.png`)).toEqual({
      uuid: UPLOAD,
      ext: 'png',
    });
    for (const bad of [
      undefined,
      5,
      `${UPLOAD}`,
      `${UPLOAD}.exe`,
      `../${UPLOAD}.pdf`,
      `${UPLOAD}.pdf/x`,
    ]) {
      expect(parseUploadId(bad)).toBeNull();
    }
  });
});

describe('bucket settings', () => {
  it('describe a private bucket with the size limit and the allowed types', () => {
    expect(SUBMISSION_BUCKET_SETTINGS).toEqual({
      name: 'submission-files',
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
      allowedMimeTypes: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/png',
        'image/jpeg',
      ],
    });
  });
});
