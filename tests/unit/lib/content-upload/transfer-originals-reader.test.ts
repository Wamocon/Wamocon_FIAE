/**
 * @jest-environment node
 */
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import {
  documentPublicUrl,
  documentStoragePath,
  isOwnedStoragePath,
  readableStorageUrl,
} from '@/lib/document-storage';
import { runTransfer } from '@/lib/content-upload/transfer/run';

import {
  ORG,
  USER,
  connect,
  reset,
  seedRun,
  transferDeps,
  type Sql,
} from '../../../helpers/transferDb';
import {
  FIAE,
  KFBM,
  ORG_A,
  ORG_C,
  T_FIAE,
  T_KFBM,
  T_NO_KFBM,
  T_NO_MEMBER,
  T_OTHER,
  TRAINER_A,
  WORD,
  activate,
  seedPeople,
} from '../../../helpers/readerPeople';
import { MemoryBucket } from '../../../helpers/memoryTransfer';
import { enablerFiles, fixtureFile } from '../../../helpers/transferFixtures';
import { pdfBytes } from '../../../helpers/uploadFixtures';
import {
  fakeSession,
  makeRequest,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// Package OR1: the PDF original of an enabler text reaches the trainee in the reader
// of the enabler page, with the rows and the rules of FIAE. The apply of the content
// upload (U7) copies the original to the bucket `content` and writes a THEORY/ALL row
// at the enabler. This test applies a real transfer on a REAL, LOCAL, throwaway
// PostgreSQL and then calls the REAL routes of the trainee and the trainer, with the
// real catalog scope, the real organization filter and the real SQL. Only the session
// (who is signed in) and the bucket (a memory fake) are replaced.
//
//   CONTENT_UPLOAD_TEST_DB=postgresql://postgres:pw@127.0.0.1:54391/or1_t
//
// Without that variable the file is skipped. It refuses every host but the own machine
// and empties the content tables first.

const url = process.env.CONTENT_UPLOAD_TEST_DB;

if (!url) {
  describe.skip('reader of an enabler original (set CONTENT_UPLOAD_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  process.env.DB_CONNECTION_STRING = url;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://or1.supabase.co';
  const sql: Sql = connect(url);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await (globalThis as any).__pgClient__?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await reset(sql);
    await sql`delete from trainee_enrollments`;
    await seedPeople(sql);
  });

  /** The KfBM enabler K4-a with the PDF original, applied by the real transfer. */
  async function applyWithOriginal(extraFiles: any[] = []) {
    const files = await enablerFiles({ tree: true });
    const original = fixtureFile(
      new Uint8Array(
        pdfBytes({
          pages: [
            [
              'Ein erfundener Lehrtext ueber Netzwerke, der lang genug ist fuer den Leser.',
              'Eine zweite Zeile ueber Router und Switches im Lehrtext.',
            ],
          ],
        })
      ),
      {
        ext: 'pdf',
        name: '4a.pdf',
        docType: 'pdf_original',
        componentCode: 'K4',
        enablerCode: 'K4-a',
        dupKey: 'pdf:enabler:4a',
      }
    );
    const seeded = await seedRun(sql, [...files, original, ...extraFiles]);
    const bucket = new MemoryBucket();
    const deps = transferDeps(sql, seeded, { contentBucket: () => bucket });
    const body = (mode: 'dry_run' | 'apply') => ({
      runId: seeded.runId,
      callerId: USER,
      mode,
      updateExisting: false,
      publishOriginals: [original.file.id],
      ...(mode === 'apply' ? { confirm: 'KFBM' } : {}),
    });
    expect((await runTransfer(deps, body('dry_run'))).ok).toBe(true);
    const done = await runTransfer(deps, body('apply'));
    expect(done.ok && done.data.status).toBe('ok');
    const [enabler] =
      await sql`select id, course_id, is_active from enablers where code = 'K4-a'`;
    const [row] =
      await sql`select * from content_documents where enabler_id = ${enabler.id} and document_type = 'THEORY' and storage_path is not null`;
    return { enabler, row, bucket };
  }

  const ctx = (enablerId: string) => ({
    params: Promise.resolve({ enablerId }),
  });

  /** The real route of the trainee, as the given trainee. */
  async function readerOf(traineeId: string, enablerId: string) {
    const [p] =
      await sql`select organization_id from profiles where id = ${traineeId}`;
    jest.resetModules();
    mockSession(
      traineeSession(traineeId, { organizationId: String(p.organization_id) })
    );
    const { GET } =
      await import('@/app/api/trainee/enablers/[enablerId]/documents/route');
    const res = await GET(
      makeRequest(
        'GET',
        `http://localhost/api/trainee/enablers/${enablerId}/documents`
      ),
      ctx(enablerId)
    );
    return { status: res.status, body: (await res.json()) as any };
  }

  /** The real route of the trainer, as a trainer of org A. */
  async function trainerListOf(enablerId: string) {
    jest.resetModules();
    mockSession(
      fakeSession({
        id: TRAINER_A,
        organizationId: ORG_A,
        isTrainerLevel: true,
      })
    );
    const { GET } =
      await import('@/app/api/trainer/enablers/[enablerId]/documents/route');
    const res = await GET(
      makeRequest(
        'GET',
        `http://localhost/api/trainer/enablers/${enablerId}/documents`,
        { headers: { 'x-catalog': 'KFBM' } }
      ),
      ctx(enablerId)
    );
    return { status: res.status, body: (await res.json()) as any };
  }

  const titles = (r: { body: any }) =>
    (r.body.documents ?? []).map((d: any) => d.title);

  describe('the row of the original has the form of a FIAE upload', () => {
    it('same bucket, same path rule, same column values as a document that a trainer adds at a FIAE enabler', async () => {
      const { row } = await applyWithOriginal();

      // a FIAE enabler and a FIAE document through the real route of the trainer
      const [course] =
        await sql`insert into courses (title, created_by_id, training_catalog_id) values ('FIAE Kurs', ${USER}, ${FIAE}) returning id`;
      const [fiaeEnabler] =
        await sql`insert into enablers (course_id, title, order_index, training_catalog_id) values (${course.id}, 'FIAE Enabler', 1, ${FIAE}) returning id`;
      const fiaePath = `${USER}/1761600000000_K4-a_lehrtext.pdf`;
      jest.resetModules();
      mockSession(
        fakeSession({
          id: USER,
          organizationId: ORG,
          isPlatformOwner: true,
          isSuperAdmin: true,
          isAdmin: true,
        })
      );
      const trainer =
        await import('@/app/api/trainer/enablers/[enablerId]/documents/route');
      const res = await trainer.POST(
        makeRequest(
          'POST',
          `http://localhost/api/trainer/enablers/${fiaeEnabler.id}/documents`,
          {
            body: {
              title: 'K4-a Lehrtext',
              fileName: '1761600000000_K4-a_lehrtext.pdf',
              documentType: 'THEORY',
              storageUrl: documentPublicUrl(fiaePath),
            },
          }
        ),
        ctx(fiaeEnabler.id)
      );
      expect(res.status).toBe(200);
      const [fiae] =
        await sql`select * from content_documents where enabler_id = ${fiaeEnabler.id}`;

      for (const doc of [fiae, row]) {
        // the url is the public url of the path, in the bucket content, own project
        expect(doc.storage_url).toBe(documentPublicUrl(doc.storage_path));
        expect(doc.storage_url).toContain(
          'https://or1.supabase.co/storage/v1/object/public/content/'
        );
        // the folder is the id of the person who uploaded the row, the file is <timestamp>_<name>
        expect(documentStoragePath(doc.storage_url, doc.uploaded_by_id)).toBe(
          doc.storage_path
        );
        expect(
          isOwnedStoragePath({
            storageUrl: doc.storage_url,
            uploadedById: doc.uploaded_by_id,
          })
        ).toBe(doc.storage_path);
        expect(readableStorageUrl(doc.storage_url).ok).toBe(true);
        expect(doc.file_name).toBe(doc.storage_path.split('/').pop());
        expect(doc.file_name).toMatch(/^\d+_[A-Za-z0-9._-]+\.pdf$/);
      }
      for (const column of [
        'document_type',
        'visibility',
        'mime_type',
        'order_index',
        'description',
        'use_case_id',
        'course_id',
        'is_indexed_by_hai',
      ]) {
        expect({ column, value: row[column] }).toEqual({
          column,
          value: fiae[column],
        });
      }
      expect(row).toMatchObject({
        document_type: 'THEORY',
        visibility: 'ALL',
        mime_type: 'application/pdf',
        uploaded_by_id: USER,
      });
      // the one difference: a FIAE upload carries the organization of the uploader (here the
      // platform organization), the original carries none. Both are the shared curriculum.
      expect(fiae.organization_id).toBe(ORG);
      expect(row.organization_id).toBeNull();
    });

    it('the original is in the bucket content under the rule of the uploads, and nowhere else', async () => {
      const { row, bucket } = await applyWithOriginal();
      expect([...bucket.objects.keys()]).toEqual([row.storage_path]);
    });
  });

  describe('what a trainee sees in the reader', () => {
    it('nothing before the activation: the enabler is inactive, the answer is 404, also for a member', async () => {
      const { enabler, row } = await applyWithOriginal();
      expect(enabler.is_active).toBe(false);
      await sql`insert into course_members (course_id, user_id, role, organization_id) values (${enabler.course_id}, ${T_KFBM}, 'TRAINEE', ${ORG_A})`;
      const seen = await readerOf(T_KFBM, enabler.id);
      expect(seen.status).toBe(404);
      expect(JSON.stringify(seen.body)).not.toContain(row.storage_path);
    });

    it('after the activation the trainee of the KfBM gets the original with the data the reader needs', async () => {
      const { enabler, row } = await applyWithOriginal();
      await activate(sql, enabler.id, enabler.course_id, [T_KFBM]);
      const seen = await readerOf(T_KFBM, enabler.id);
      expect(seen.status).toBe(200);
      expect(seen.body.documents).toHaveLength(1);
      expect(seen.body.documents[0]).toMatchObject({
        id: row.id,
        title: 'Enabler K4-a: Lehrtext (Original PDF)',
        documentType: 'THEORY',
        storageUrl: row.storage_url,
        isOwnOrganization: false,
      });
      // no internal field
      const keys = Object.keys(seen.body.documents[0]);
      for (const key of [
        'uploadedById',
        'storagePath',
        'organizationId',
        'visibility',
        'mimeType',
      ]) {
        expect(keys).not.toContain(key);
      }
    });

    it('switching the enabler off hides it again', async () => {
      const { enabler } = await applyWithOriginal();
      await activate(sql, enabler.id, enabler.course_id, [T_KFBM]);
      expect((await readerOf(T_KFBM, enabler.id)).status).toBe(200);
      await sql`update enablers set is_active = false where id = ${enabler.id}`;
      expect((await readerOf(T_KFBM, enabler.id)).status).toBe(404);
    });

    it('a trainee of another occupation (FIAE) gets 404', async () => {
      const { enabler } = await applyWithOriginal();
      await activate(sql, enabler.id, enabler.course_id, [T_FIAE]);
      const seen = await readerOf(T_FIAE, enabler.id);
      expect(seen.status).toBe(404);
      expect(seen.body.documents).toBeUndefined();
    });

    it('a trainee of an organization that has not enabled the KfBM gets no document', async () => {
      const { enabler } = await applyWithOriginal();
      await activate(sql, enabler.id, enabler.course_id, [T_NO_KFBM]);
      const seen = await readerOf(T_NO_KFBM, enabler.id);
      expect([403, 404]).toContain(seen.status);
      expect(seen.body.documents).toBeUndefined();
    });

    it('a trainee of another organization that has the KfBM sees the shared original, but not a document of a foreign organization', async () => {
      const { enabler, row } = await applyWithOriginal();
      await activate(sql, enabler.id, enabler.course_id, [T_KFBM, T_OTHER]);
      // a document that organization C added at the enabler
      await sql`insert into content_documents (enabler_id, organization_id, title, document_type, visibility, file_name, mime_type, storage_url, uploaded_by_id)
                values (${enabler.id}, ${ORG_C}, 'Eigenes Dokument von C', 'THEORY', 'ALL', 'c.pdf', 'application/pdf', 'https://or1.supabase.co/storage/v1/object/public/content/x/1_c.pdf', ${USER})`;
      const other = await readerOf(T_OTHER, enabler.id);
      expect(other.status).toBe(200);
      expect(titles(other).sort()).toEqual(
        [
          'Eigenes Dokument von C',
          'Enabler K4-a: Lehrtext (Original PDF)',
        ].sort()
      );
      expect(
        other.body.documents.find((d: any) => d.id === row.id).isOwnOrganization
      ).toBe(false);
      const own = await readerOf(T_KFBM, enabler.id);
      expect(titles(own)).toEqual(['Enabler K4-a: Lehrtext (Original PDF)']);
    });

    it('a trainee who is no member of the course gets 403 and no link', async () => {
      const { enabler, row } = await applyWithOriginal();
      await activate(sql, enabler.id, enabler.course_id, [T_KFBM]);
      const seen = await readerOf(T_NO_MEMBER, enabler.id);
      expect(seen.status).toBe(403);
      expect(JSON.stringify(seen.body)).not.toContain(row.storage_path);
    });

    it('never lists trainer material, a row without a file or a Word original, next to the PDF original', async () => {
      const { enabler } = await applyWithOriginal();
      await activate(sql, enabler.id, enabler.course_id, [T_KFBM]);
      const insert = (
        title: string,
        type: string,
        visibility: string,
        url: string,
        mime: string
      ) =>
        sql`insert into content_documents (enabler_id, title, document_type, visibility, file_name, mime_type, storage_url, uploaded_by_id)
            values (${enabler.id}, ${title}, ${type}, ${visibility}, 'x.pdf', ${mime}, ${url}, ${USER})`;
      const file =
        'https://or1.supabase.co/storage/v1/object/public/content/x/1_x.pdf';
      await insert(
        'Loesung Trainer',
        'TRAINER_SOLUTION',
        'TRAINER_ONLY',
        file,
        'application/pdf'
      );
      await insert(
        'Nur Trainer',
        'THEORY',
        'TRAINER_ONLY',
        file,
        'application/pdf'
      );
      await insert(
        'Loesung sichtbar markiert',
        'TRAINER_SOLUTION',
        'ALL',
        file,
        'application/pdf'
      );
      await insert('Ohne Datei', 'TRAINEE_QUESTION', 'ALL', '', 'text/plain');
      await insert(
        'Word Original',
        'THEORY',
        'ALL',
        file.replace('.pdf', '.docx'),
        WORD
      );
      const seen = await readerOf(T_KFBM, enabler.id);
      expect(seen.status).toBe(200);
      expect(titles(seen)).toEqual(['Enabler K4-a: Lehrtext (Original PDF)']);
    });
  });

  describe('what a trainer sees', () => {
    it('a trainer of the organization lists the original, together with the rows that stay hidden from trainees', async () => {
      const { enabler } = await applyWithOriginal();
      await sql`insert into content_documents (enabler_id, title, document_type, visibility, file_name, mime_type, storage_url, uploaded_by_id)
                values (${enabler.id}, 'Loesung Trainer', 'TRAINER_SOLUTION', 'TRAINER_ONLY', 'x.pdf', 'application/pdf', '', ${USER})`;
      const seen = await trainerListOf(enabler.id);
      expect(seen.status).toBe(200);
      // the scenario situation row of the import has no file: the trainer sees it, no trainee
      expect(titles(seen).sort()).toEqual(
        [
          'Enabler K4-a: Lehrtext (Original PDF)',
          'Loesung Trainer',
          'Szenario K4-a: Ausgangssituation',
        ].sort()
      );
    });
  });
}
