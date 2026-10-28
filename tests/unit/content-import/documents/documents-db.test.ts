/**
 * @jest-environment node
 */
import { createHash } from 'node:crypto';

import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { buildDocumentPlan } from '@/lib/content-import/documents/plan';
import { runDocumentJob } from '@/lib/content-import/documents/job';
import type { ScannedPdf } from '@/lib/content-import/documents/types';
import {
  fromPostgresJs,
  withReservedConnection,
} from '@/lib/content-upload/connection';
import { runTransfer } from '@/lib/content-upload/transfer/run';

import { MemoryBucket } from '../../../helpers/memoryTransfer';
import { MemoryStorage } from '../../../helpers/memoryStorage';
import {
  ORG_A,
  T_FIAE,
  T_KFBM,
  T_NO_KFBM,
  T_NO_MEMBER,
  TRAINER_A,
  activate,
  seedPeople,
} from '../../../helpers/readerPeople';
import {
  fakeSession,
  makeRequest,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';
import {
  USER,
  connect,
  reset,
  seedRun,
  transferDeps,
  type Sql,
} from '../../../helpers/transferDb';
import { enablerFiles, fixtureFile } from '../../../helpers/transferFixtures';
import { pdfBytes } from '../../../helpers/uploadFixtures';

// The PDF import (scripts/import/kfbm-documents.mjs, src/lib/content-import/documents) on a REAL, LOCAL,
// throwaway PostgreSQL: the transaction, the rollback, the second run that writes nothing, and what each
// role gets from the REAL routes of the trainee and the trainer afterwards. The storage is a fake in memory
// (the tests never upload to a real storage). Only runs when CONTENT_UPLOAD_TEST_DB names a database on this
// machine, for example
//
//   CONTENT_UPLOAD_TEST_DB=postgresql://postgres:pw@127.0.0.1:54391/or1_t

const url = process.env.CONTENT_UPLOAD_TEST_DB;

if (!url) {
  describe.skip('PDF import on PostgreSQL (set CONTENT_UPLOAD_TEST_DB)', () => {
    it('is skipped without a local database', () => undefined);
  });
} else {
  process.env.DB_CONNECTION_STRING = url;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SECRET_KEY = 'sb-secret-local';
  const sql: Sql = connect(url);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await (globalThis as any).__pgClient__?.end({ timeout: 5 });
  });

  const K4 =
    '04 - Koordinations- und Organisationsaufgaben übernehmen (§ 4 Abs. 2 Nr. 4)';
  const SUPABASE = 'http://127.0.0.1:54321';
  const sha = (bytes: Uint8Array) =>
    createHash('sha256').update(bytes).digest('hex');
  const pdf = (text: string) =>
    new Uint8Array(Buffer.from(`%PDF-1.7\n${text}\n%%EOF`));

  type Source = { scanned: ScannedPdf; bytes: Uint8Array };
  const source = (rel: string, heading: string, pages: number): Source => {
    const bytes = pdf(rel);
    return {
      bytes,
      scanned: {
        rel,
        size: bytes.length,
        magicOk: true,
        sha256: sha(bytes),
        pageCount: pages,
        headText: heading,
      },
    };
  };
  const sources = (): Source[] => [
    source(`${K4}/Enabler/4a_Titel.pdf`, '4a) Titel', 17),
    source(`${K4}/Szenarien/Szenario_4a_Titel.pdf`, 'Szenario 4a) Titel', 2),
    source(`${K4}/Use-Cases/UC_4a_Titel.pdf`, '4a) Titel', 7),
    source(
      `${K4}/Use-Cases_Musterlösung/UC_4a_Titel_Musterlösung.pdf`,
      '4a) Titel',
      11
    ),
  ];

  beforeEach(async () => {
    await reset(sql);
    await sql`delete from trainee_enrollments`;
    await seedPeople(sql);
  });

  /** The KfBM enabler K4-a and its use case, written by the real transfer (inactive). */
  async function seedKfbm(options: { original?: boolean } = {}) {
    const files = await enablerFiles({ tree: true });
    const extra = options.original
      ? [
          fixtureFile(
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
          ),
        ]
      : [];
    const seeded = await seedRun(sql, [...files, ...extra]);
    const deps = transferDeps(sql, seeded, {
      contentBucket: () => new MemoryBucket(),
    });
    const body = (mode: 'dry_run' | 'apply') => ({
      runId: seeded.runId,
      callerId: USER,
      mode,
      updateExisting: false,
      publishOriginals: extra.map(e => e.file.id),
      ...(mode === 'apply' ? { confirm: 'KFBM' } : {}),
    });
    await runTransfer(deps, body('dry_run'));
    const done = await runTransfer(deps, body('apply'));
    expect(done.ok && done.data.status).toBe('ok');
    const [enabler] =
      await sql`select id, course_id from enablers where code = 'K4-a'`;
    const [useCase] =
      await sql`select id from use_cases where enabler_id = ${enabler.id}`;
    expect(useCase).toBeTruthy();
    return { enabler, useCase };
  }

  async function runImport(
    storage: MemoryStorage,
    all: Source[],
    mode: 'check' | 'dry-run' | 'apply',
    over: Record<string, unknown> = {}
  ) {
    const plan = buildDocumentPlan(all.map(s => s.scanned));
    return withReservedConnection(fromPostgresJs(sql as any), client =>
      runDocumentJob(client, storage, plan, {
        mode,
        target: 'local',
        createdBy: USER,
        overwriteFiles: false,
        supabaseUrl: SUPABASE,
        bytesOf: async item =>
          (all.find(s => s.scanned.rel === item.rel) as Source).bytes,
        ...over,
      } as any)
    );
  }

  const documents = async () =>
    sql`select enabler_id, use_case_id, title, document_type, visibility, storage_url, storage_path, file_name, page_count, mime_type, organization_id, uploaded_by_id, is_indexed_by_hai, order_index
          from content_documents where storage_path is not null order by title`;

  describe('the run', () => {
    it('a check and a dry run write nothing and touch no storage', async () => {
      await seedKfbm();
      const storage = new MemoryStorage();
      const all = sources();
      const check = await runImport(storage, all, 'check');
      expect(check.tables.content_documents.insert).toBe(4);
      const dry = await runImport(storage, all, 'dry-run');
      expect(dry.tables.content_documents.insert).toBe(4);
      expect(await documents()).toHaveLength(0);
      expect(storage.calls).toEqual([]);
    });

    it('an apply writes the four rows and the four files, in the form of FIAE', async () => {
      const { enabler, useCase } = await seedKfbm();
      const storage = new MemoryStorage();
      const report = await runImport(storage, sources(), 'apply');
      expect(report.uploads).toEqual({ put: 4, replaced: 0 });
      const rows = await documents();
      expect(
        rows.map(r => [r.document_type, r.visibility, r.mime_type])
      ).toEqual(
        expect.arrayContaining([
          ['THEORY', 'ALL', 'application/pdf'],
          ['EXERCISE', 'ALL', 'application/pdf'],
          ['TRAINEE_QUESTION', 'ALL', 'application/pdf'],
          ['TRAINER_SOLUTION', 'TRAINER_ONLY', 'application/pdf'],
        ])
      );
      const byType = (t: string) => rows.find(r => r.document_type === t)!;
      expect(byType('THEORY').enabler_id).toBe(enabler.id);
      expect(byType('EXERCISE').enabler_id).toBe(enabler.id);
      expect(byType('TRAINEE_QUESTION').use_case_id).toBe(useCase.id);
      expect(byType('TRAINER_SOLUTION').use_case_id).toBe(useCase.id);
      for (const row of rows) {
        expect(row.organization_id).toBeNull();
        expect(row.uploaded_by_id).toBe(USER);
        expect(row.is_indexed_by_hai).toBe(false);
        expect(row.storage_path).toMatch(/^kfbm\/K4-a\//);
      }
      expect(byType('THEORY').page_count).toBe(17);
      // public url for what trainees read, a private reference for the solution
      for (const type of ['THEORY', 'EXERCISE', 'TRAINEE_QUESTION']) {
        expect(byType(type).storage_url).toBe(
          `${SUPABASE}/storage/v1/object/public/content/${byType(type).storage_path}`
        );
      }
      expect(byType('TRAINER_SOLUTION').storage_url).toBe(
        `private://content-solutions/${byType('TRAINER_SOLUTION').storage_path}`
      );
      expect(storage.objects.size).toBe(4);
      expect(
        [...storage.objects.keys()].filter(k =>
          k.startsWith('content-solutions/')
        )
      ).toHaveLength(1);
    });

    it('a second run writes nothing: no row, no file', async () => {
      await seedKfbm();
      const storage = new MemoryStorage();
      const all = sources();
      await runImport(storage, all, 'apply');
      const before = await documents();
      const puts = storage.calls.filter(c => c.startsWith('put')).length;
      const again = await runImport(storage, all, 'apply');
      expect(again.tables.content_documents).toEqual({
        insert: 0,
        update: 0,
        unchanged: 4,
      });
      expect(await documents()).toEqual(before);
      expect(storage.calls.filter(c => c.startsWith('put'))).toHaveLength(puts);
    });

    it('a failed copy takes the files out and the transaction back: no row, no file', async () => {
      await seedKfbm();
      const storage = new MemoryStorage();
      storage.failPutAt = 3;
      await expect(runImport(storage, sources(), 'apply')).rejects.toThrow(
        'storage put failed'
      );
      expect(storage.objects.size).toBe(0);
      expect(await documents()).toHaveLength(0);
    });

    it('the text original of the content upload and this import do not make two rows for one text', async () => {
      await seedKfbm({ original: true });
      const [{ n: before }] =
        await sql`select count(*)::int as n from content_documents where document_type = 'THEORY' and storage_path is not null`;
      expect(before).toBe(1);
      const storage = new MemoryStorage();
      const report = await runImport(storage, sources(), 'apply');
      expect(report.tables.content_documents.insert).toBe(3);
      expect(report.tables.content_documents.unchanged).toBe(1);
      const [{ n: after }] =
        await sql`select count(*)::int as n from content_documents where document_type = 'THEORY' and storage_path is not null`;
      expect(after).toBe(1);
    });

    it('refuses the storage of another target before it writes a row', async () => {
      await seedKfbm();
      await expect(
        runImport(new MemoryStorage(), sources(), 'apply', {
          supabaseUrl: 'https://proj.supabase.co',
        })
      ).rejects.toMatchObject({ code: 'STORAGE_TARGET' });
      expect(await documents()).toHaveLength(0);
    });
  });

  describe('what the roles get afterwards', () => {
    const ctx = (key: string, value: string) => ({
      params: Promise.resolve({ [key]: value }),
    });

    async function asTrainee(
      traineeId: string,
      route: string,
      key: string,
      value: string
    ) {
      const [p] =
        await sql`select organization_id from profiles where id = ${traineeId}`;
      jest.resetModules();
      mockSession(
        traineeSession(traineeId, { organizationId: String(p.organization_id) })
      );
      const mod = await import(`@/app/api/${route}`);
      const res = await mod.GET(
        makeRequest('GET', `http://localhost/api/${route}`),
        ctx(key, value)
      );
      return { status: res.status, body: (await res.json()) as any };
    }
    const reader = (traineeId: string, enablerId: string) =>
      asTrainee(
        traineeId,
        'trainee/enablers/[enablerId]/documents/route',
        'enablerId',
        enablerId
      );
    const useCaseReader = (traineeId: string, useCaseId: string) =>
      asTrainee(
        traineeId,
        'trainee/use-cases/[useCaseId]/documents/route',
        'useCaseId',
        useCaseId
      );

    async function trainerReads(route: string, key: string, value: string) {
      jest.resetModules();
      mockSession(
        fakeSession({
          id: TRAINER_A,
          organizationId: ORG_A,
          isTrainerLevel: true,
        })
      );
      jest.doMock('@supabase/supabase-js', () => ({
        __esModule: true,
        createClient: () => ({
          storage: {
            from: (bucket: string) => ({
              createSignedUrl: async (path: string) => ({
                data: {
                  signedUrl: `http://127.0.0.1:54321/storage/v1/object/sign/${bucket}/${path}?token=t`,
                },
                error: null,
              }),
            }),
          },
        }),
      }));
      const mod = await import(`@/app/api/${route}`);
      const res = await mod.GET(
        makeRequest('GET', `http://localhost/api/${route}`, {
          headers: { 'x-catalog': 'KFBM' },
        }),
        ctx(key, value)
      );
      return { status: res.status, body: (await res.json()) as any };
    }

    async function imported() {
      const { enabler, useCase } = await seedKfbm();
      await runImport(new MemoryStorage(), sources(), 'apply');
      return { enabler, useCase };
    }

    const titles = (r: { body: any }) =>
      (r.body.documents ?? []).map((d: any) => d.title).sort();

    it('nothing before the activation: the enabler is inactive, and a trainee is no member of the course', async () => {
      const { enabler, useCase } = await imported();
      expect((await reader(T_KFBM, enabler.id)).status).toBe(404);
      expect((await useCaseReader(T_KFBM, useCase.id)).status).toBe(403);
    });

    it('a trainee of the KfBM gets the text, the scenario and the task, and never the solution', async () => {
      const { enabler, useCase } = await imported();
      await activate(sql, enabler.id, enabler.course_id, [T_KFBM]);
      const onEnabler = await reader(T_KFBM, enabler.id);
      expect(onEnabler.status).toBe(200);
      expect(titles(onEnabler)).toEqual([
        'Enabler K4-a: Lehrtext (Original PDF)',
        'Szenario K4-a (PDF)',
      ]);
      expect(
        onEnabler.body.documents.map((d: any) => d.documentType).sort()
      ).toEqual(['EXERCISE', 'THEORY']);
      const onUseCase = await useCaseReader(T_KFBM, useCase.id);
      expect(onUseCase.status).toBe(200);
      // the task only: the text rows of the import (no file) and the solution are not listed
      expect(titles(onUseCase)).toEqual(['Use Case K4-a: Aufgabe (PDF)']);
      const everything = JSON.stringify([onEnabler.body, onUseCase.body]);
      expect(everything).not.toContain('private://');
      expect(everything).not.toContain('content-solutions');
      expect(everything).not.toContain('musterloesung');
      expect(everything).not.toContain('Musterlösung');
    });

    it('the solution is not reachable for any trainee: other occupation, other organization, no member', async () => {
      const { enabler, useCase } = await imported();
      await activate(sql, enabler.id, enabler.course_id, [T_FIAE, T_NO_KFBM]);
      for (const who of [T_FIAE, T_NO_KFBM, T_NO_MEMBER]) {
        for (const seen of [
          await reader(who, enabler.id),
          await useCaseReader(who, useCase.id),
        ]) {
          expect([403, 404]).toContain(seen.status);
          expect(JSON.stringify(seen.body)).not.toContain('Musterl');
          expect(seen.body.documents).toBeUndefined();
        }
      }
    });

    it('a trainer of the organization gets the solution as a signed url, never the reference', async () => {
      const { useCase } = await imported();
      const seen = await trainerReads(
        'trainer/use-cases/[useCaseId]/documents/route',
        'useCaseId',
        useCase.id
      );
      expect(seen.status).toBe(200);
      const solution = seen.body.documents.find(
        (d: any) =>
          d.documentType === 'TRAINER_SOLUTION' && d.title.includes('(PDF)')
      );
      expect(solution.storageUrl).toMatch(
        /^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/sign\/content-solutions\/kfbm\/K4-a\/musterloesung\//
      );
      expect(JSON.stringify(seen.body)).not.toContain('private://');
      // the text rows of the import stay as they are (they feed the search of the tutor)
      expect(titles(seen)).toEqual(
        expect.arrayContaining([
          'Use Case K4-a: Aufgabe (PDF)',
          'Use Case K4-a: Behandelte Themen',
        ])
      );
    });
  });
}
