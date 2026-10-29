/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import {
  announceUpload,
  completeUpload,
  getFile,
  removeFile,
} from '@/lib/submission-file/service';
import {
  MAX_SUBMISSION_FILE_BYTES,
  fileFolder,
  filePath,
  incomingFolder,
  incomingPath,
  submissionFolder,
} from '@/lib/submission-file/rules';
import {
  PDF_BYTES,
  createMemorySubmissionStorage,
} from '../../../helpers/memorySubmissionStorage';

const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const UPLOAD = '44444444-4444-4444-8444-444444444444';
const scope = { organizationId: ORG, traineeId: TRAINEE, useCaseId: USE_CASE };
const folder = submissionFolder(scope, 'public') as string;

function setup(now = 1761700000000) {
  const storage = createMemorySubmissionStorage('public');
  const deps = {
    storage,
    schema: 'public' as const,
    now: () => now,
    newId: () => UPLOAD,
  };
  return { storage, deps };
}

describe('announceUpload', () => {
  it('picks the path itself and answers with the data for the signed upload', async () => {
    const { storage, deps } = setup();
    const result = await announceUpload(deps, scope, {
      fileName: 'Übung Größe.pdf',
      size: 1234,
      contentType: 'application/pdf',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        bucket: 'submission-files',
        uploadId: `${UPLOAD}.pdf`,
        path: incomingPath(folder, `${UPLOAD}.pdf`),
        token: `token-for-${incomingPath(folder, `${UPLOAD}.pdf`)}`,
        fileName: 'Uebung_Groesse.pdf',
        contentType: 'application/pdf',
        maxBytes: MAX_SUBMISSION_FILE_BYTES,
      },
    });
    expect(storage.signedFor).toEqual([incomingPath(folder, `${UPLOAD}.pdf`)]);
  });

  it('refuses a file that fails the announcement checks, without touching the storage', async () => {
    const { storage, deps } = setup();
    expect(
      await announceUpload(deps, scope, { fileName: 'a.zip', size: 5 })
    ).toEqual({ ok: false, status: 400, code: 'UNSUPPORTED_TYPE' });
    expect(
      await announceUpload(deps, scope, {
        fileName: 'a.pdf',
        size: MAX_SUBMISSION_FILE_BYTES + 1,
      })
    ).toEqual({ ok: false, status: 413, code: 'TOO_LARGE' });
    expect(storage.signedFor).toEqual([]);
  });

  it('removes an upload that was never completed', async () => {
    const { storage, deps } = setup();
    const old = incomingPath(
      folder,
      `55555555-5555-4555-8555-555555555555.pdf`
    );
    storage.objects.set(old, PDF_BYTES);
    await announceUpload(deps, scope, { fileName: 'a.pdf', size: 5 });
    expect(storage.objects.has(old)).toBe(false);
  });

  it('leaves alone an object in the folder that is not of the exact form', async () => {
    const { storage, deps } = setup();
    storage.objects.set(`${incomingFolder(folder)}/weird name.pdf`, PDF_BYTES);
    const result = await announceUpload(deps, scope, {
      fileName: 'a.pdf',
      size: 5,
    });
    expect(result.ok).toBe(true);
    expect(
      storage.objects.has(`${incomingFolder(folder)}/weird name.pdf`)
    ).toBe(true);
  });

  it('refuses a scope that holds an id which is no uuid', async () => {
    const { deps } = setup();
    expect(
      await announceUpload(
        deps,
        { ...scope, useCaseId: '../x' },
        {
          fileName: 'a.pdf',
          size: 5,
        }
      )
    ).toEqual({ ok: false, status: 400, code: 'INVALID_SCOPE' });
  });

  it('answers 503 when the storage gives no upload url', async () => {
    const { storage, deps } = setup();
    storage.objects.set(incomingPath(folder, `${UPLOAD}.pdf`), PDF_BYTES);
    // the same id again: the object exists, the storage refuses to overwrite it
    const original = storage.remove;
    storage.remove = async () => undefined;
    const result = await announceUpload(deps, scope, {
      fileName: 'a.pdf',
      size: 5,
    });
    storage.remove = original;
    expect(result).toEqual({
      ok: false,
      status: 503,
      code: 'UPLOAD_URL_FAILED',
    });
  });
});

describe('completeUpload', () => {
  const uploaded = (
    storage: ReturnType<typeof setup>['storage'],
    bytes = PDF_BYTES
  ) => storage.objects.set(incomingPath(folder, `${UPLOAD}.pdf`), bytes);

  it('checks the bytes and makes the upload the file of the submission', async () => {
    const { storage, deps } = setup();
    uploaded(storage);
    const result = await completeUpload(deps, scope, {
      uploadId: `${UPLOAD}.pdf`,
      fileName: 'Bericht Übung.pdf',
    });
    expect(result).toEqual({
      ok: true,
      value: {
        fileName: 'Bericht_Uebung.pdf',
        size: PDF_BYTES.length,
        uploadedAt: new Date(1761700000000).toISOString(),
      },
    });
    expect([...storage.objects.keys()]).toEqual([
      filePath(folder, 1761700000000, 'Bericht_Uebung.pdf'),
    ]);
  });

  it('replaces the earlier file, so there is one file per submission', async () => {
    const { storage, deps } = setup(1761700000500);
    const earlier = filePath(folder, 1761700000000, 'alt.pdf');
    storage.objects.set(earlier, PDF_BYTES);
    uploaded(storage);
    await completeUpload(deps, scope, {
      uploadId: `${UPLOAD}.pdf`,
      fileName: 'neu.pdf',
    });
    expect([...storage.objects.keys()]).toEqual([
      filePath(folder, 1761700000500, 'neu.pdf'),
    ]);
  });

  it('deletes an upload whose bytes are not what the extension says', async () => {
    const { storage, deps } = setup();
    uploaded(storage, new TextEncoder().encode('<html>not a pdf</html>'));
    expect(
      await completeUpload(deps, scope, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 422, code: 'NOT_A_PDF' });
    expect(storage.objects.size).toBe(0);
  });

  it('deletes an empty upload', async () => {
    const { storage, deps } = setup();
    uploaded(storage, new Uint8Array(0));
    expect(
      await completeUpload(deps, scope, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 400, code: 'EMPTY_FILE' });
    expect(storage.objects.size).toBe(0);
  });

  it('fails closed and deletes an upload whose size the storage does not report', async () => {
    const { storage, deps } = setup();
    uploaded(storage);
    const list = storage.list;
    storage.list = async f => (await list(f)).map(o => ({ ...o, size: null }));
    expect(
      await completeUpload(deps, scope, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 400, code: 'EMPTY_FILE' });
    expect(storage.objects.size).toBe(0);
  });

  it('removes a file that a second upload added at the same time', async () => {
    const { storage, deps } = setup(1761700000500);
    uploaded(storage);
    const move = storage.move;
    storage.move = async (from, to) => {
      await move(from, to);
      // another complete finished between this move and the clean up
      storage.objects.set(
        filePath(folder, 1761700000100, 'zweite.pdf'),
        PDF_BYTES
      );
    };
    await completeUpload(deps, scope, {
      uploadId: `${UPLOAD}.pdf`,
      fileName: 'neu.pdf',
    });
    expect([...storage.objects.keys()]).toEqual([
      filePath(folder, 1761700000500, 'neu.pdf'),
    ]);
  });

  it('deletes an upload that is larger than allowed', async () => {
    const { storage, deps } = setup();
    const big = new Uint8Array(MAX_SUBMISSION_FILE_BYTES + 1);
    big.set(PDF_BYTES);
    uploaded(storage, big);
    expect(
      await completeUpload(deps, scope, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 413, code: 'TOO_LARGE' });
    expect(storage.objects.size).toBe(0);
  });

  it('deletes an upload whose real size differs from what the list said', async () => {
    const { storage, deps } = setup();
    uploaded(storage, PDF_BYTES);
    // the list reports a size within the limit, the object itself is larger
    const big = new Uint8Array(MAX_SUBMISSION_FILE_BYTES + 5);
    big.set(PDF_BYTES);
    const path = incomingPath(folder, `${UPLOAD}.pdf`);
    const list = storage.list;
    storage.list = async f => (await list(f)).map(o => ({ ...o, size: 10 }));
    storage.objects.set(path, big);
    const download = storage.download;
    storage.download = async p => download(p);
    expect(
      await completeUpload(deps, scope, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 413, code: 'TOO_LARGE' });
    expect(storage.objects.size).toBe(0);
  });

  it('knows nothing of an upload that did not arrive', async () => {
    const { deps } = setup();
    expect(
      await completeUpload(deps, scope, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 409, code: 'NOT_UPLOADED' });
  });

  it('answers 409 when the object disappears between list and download', async () => {
    const { storage, deps } = setup();
    uploaded(storage);
    storage.download = async () => null;
    expect(
      await completeUpload(deps, scope, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 409, code: 'NOT_UPLOADED' });
  });

  it('refuses an upload id that is not the exact form', async () => {
    const { deps } = setup();
    for (const uploadId of [
      undefined,
      '../x.pdf',
      `${UPLOAD}.exe`,
      `${UPLOAD}.pdf/../x`,
    ]) {
      expect(
        await completeUpload(deps, scope, { uploadId, fileName: 'a.pdf' })
      ).toEqual({
        ok: false,
        status: 400,
        code: 'INVALID_UPLOAD',
      });
    }
  });

  it('can not reach the upload of another trainee or use case', async () => {
    const { storage, deps } = setup();
    uploaded(storage);
    const otherTrainee = {
      ...scope,
      traineeId: '66666666-6666-4666-8666-666666666666',
    };
    expect(
      await completeUpload(deps, otherTrainee, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 409, code: 'NOT_UPLOADED' });
    const otherUseCase = {
      ...scope,
      useCaseId: '77777777-7777-4777-8777-777777777777',
    };
    expect(
      await completeUpload(deps, otherUseCase, {
        uploadId: `${UPLOAD}.pdf`,
        fileName: 'a.pdf',
      })
    ).toEqual({ ok: false, status: 409, code: 'NOT_UPLOADED' });
    expect(storage.objects.size).toBe(1);
  });

  it('refuses a scope with an id that is no uuid', async () => {
    const { deps } = setup();
    expect(
      await completeUpload(
        deps,
        { ...scope, traineeId: 'x' },
        { uploadId: `${UPLOAD}.pdf` }
      )
    ).toEqual({ ok: false, status: 400, code: 'INVALID_SCOPE' });
  });

  it('uses a neutral name when the browser sends none', async () => {
    const { storage, deps } = setup();
    uploaded(storage);
    const result = await completeUpload(deps, scope, {
      uploadId: `${UPLOAD}.pdf`,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { fileName: 'abgabe.pdf' },
    });
  });
});

describe('getFile', () => {
  it('answers null when there is no file', async () => {
    const { deps } = setup();
    expect(await getFile(deps, scope)).toEqual({ ok: true, value: null });
  });

  it('answers the newest file, with a short lived link only when asked for', async () => {
    const { storage, deps } = setup();
    storage.objects.set(filePath(folder, 1761700000000, 'alt.pdf'), PDF_BYTES);
    storage.objects.set(filePath(folder, 1761700009000, 'neu.pdf'), PDF_BYTES);
    // an object that is not of the exact form is ignored
    storage.objects.set(`${fileFolder(folder)}/notes.txt`, PDF_BYTES);

    expect(await getFile(deps, scope)).toEqual({
      ok: true,
      value: {
        fileName: 'neu.pdf',
        size: PDF_BYTES.length,
        uploadedAt: new Date(1761700009000).toISOString(),
      },
    });
    const withLink = await getFile(deps, scope, { withLink: true });
    expect(withLink).toMatchObject({
      ok: true,
      value: { fileName: 'neu.pdf' },
    });
    expect((withLink as { value: { url: string } }).value.url).toContain(
      '?t=120&download=neu.pdf'
    );
  });

  it('answers null when the link can not be made', async () => {
    const { storage, deps } = setup();
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    storage.createSignedUrl = async () => null;
    expect(await getFile(deps, scope, { withLink: true })).toEqual({
      ok: true,
      value: null,
    });
  });

  it('does not see the file of another trainee', async () => {
    const { storage, deps } = setup();
    const other = {
      ...scope,
      traineeId: '66666666-6666-4666-8666-666666666666',
    };
    const otherFolder = submissionFolder(other, 'public') as string;
    storage.objects.set(
      filePath(otherFolder, 1761700000000, 'a.pdf'),
      PDF_BYTES
    );
    expect(await getFile(deps, scope)).toEqual({ ok: true, value: null });
  });

  it('refuses a scope with an id that is no uuid', async () => {
    const { deps } = setup();
    expect(await getFile(deps, { ...scope, organizationId: 'x' })).toEqual({
      ok: false,
      status: 400,
      code: 'INVALID_SCOPE',
    });
  });
});

describe('removeFile', () => {
  it('removes the file and any unchecked upload, and nothing else', async () => {
    const { storage, deps } = setup();
    const keep = filePath(
      submissionFolder(
        { ...scope, useCaseId: '77777777-7777-4777-8777-777777777777' },
        'public'
      ) as string,
      1761700000000,
      'other.pdf'
    );
    storage.objects.set(keep, PDF_BYTES);
    storage.objects.set(filePath(folder, 1761700000000, 'a.pdf'), PDF_BYTES);
    storage.objects.set(incomingPath(folder, `${UPLOAD}.pdf`), PDF_BYTES);
    expect(await removeFile(deps, scope)).toEqual({ ok: true, value: 2 });
    expect([...storage.objects.keys()]).toEqual([keep]);
  });

  it('refuses a scope with an id that is no uuid', async () => {
    const { deps } = setup();
    expect(await removeFile(deps, { ...scope, traineeId: 'x' })).toEqual({
      ok: false,
      status: 400,
      code: 'INVALID_SCOPE',
    });
  });
});
