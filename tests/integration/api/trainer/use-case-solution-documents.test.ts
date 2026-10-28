/**
 * @jest-environment node
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  FIAE,
  ORG,
  loadScoped,
  scopeReq,
  trainerSession,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';
import { createTableDb } from '../../../helpers/mockDb';
import { mockSession } from '../../../helpers/mockNext';

// The model solutions (PDF) of the KfBM lie in the private bucket content-solutions, the row stores
// the reference private://content-solutions/<path>. The trainer list of the use case documents
// turns it into a signed url of a few minutes. No trainee route lists it, and no list ever hands the
// reference itself to a browser.

const USE_CASE = 'aaaaaaa7-0000-4000-8000-000000000007';
const PATH = 'preview/kfbm/K6.2-d/musterloesung/UC_6d_Titel_Musterloesung.pdf';
const REF = `private://content-solutions/${PATH}`;
const SIGNED = `https://proj.supabase.co/storage/v1/object/sign/content-solutions/${PATH}?token=t`;
const PUBLIC =
  'https://proj.supabase.co/storage/v1/object/public/content/a.pdf';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  useCaseId: USE_CASE,
  organizationId: null,
  title: 'Use Case K6.2-d: Aufgabe (PDF)',
  documentType: 'TRAINEE_QUESTION',
  visibility: 'ALL',
  fileName: 'UC.pdf',
  storageUrl: PUBLIC,
  storagePath: 'x',
  mimeType: 'application/pdf',
  ...over,
});
const solution = (over: Record<string, unknown> = {}) =>
  row({
    id: 's1',
    title: 'Use Case K6.2-d: Musterlösung (PDF)',
    documentType: 'TRAINER_SOLUTION',
    visibility: 'TRAINER_ONLY',
    storageUrl: REF,
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb-secret';
});

describe('trainer list of the use case documents', () => {
  function signing(result: 'ok' | 'error') {
    const calls: Array<[string, string, number]> = [];
    const setup = () =>
      jest.doMock('@supabase/supabase-js', () => ({
        __esModule: true,
        createClient: () => ({
          storage: {
            from: (bucket: string) => ({
              createSignedUrl: async (path: string, seconds: number) => {
                calls.push([bucket, path, seconds]);
                return result === 'ok'
                  ? { data: { signedUrl: SIGNED }, error: null }
                  : { data: null, error: new Error('down') };
              },
            }),
          },
        }),
      }));
    return { calls, setup };
  }

  async function list(docs: any[], result: 'ok' | 'error' = 'ok') {
    const s = signing(result);
    const { mod } = await loadScoped(
      'trainer/use-cases/[useCaseId]/documents/route',
      {
        session: trainerSession(),
        tables: {
          useCases: [{ id: USE_CASE, trainingCatalogId: FIAE, courseId: 'c' }],
          contentDocuments: docs,
          organizations: [{ id: 'p', isPlatformOwner: true }],
        },
        setup: s.setup,
      }
    );
    const res = await mod.GET(
      scopeReq(`http://localhost/api/trainer/use-cases/${USE_CASE}/documents`),
      { params: Promise.resolve({ useCaseId: USE_CASE }) }
    );
    return { res, body: await res.json(), calls: s.calls };
  }

  it('gives the trainer a signed url for the solution and leaves the other urls alone', async () => {
    const { res, body, calls } = await list([row(), solution()]);
    expect(res.status).toBe(200);
    expect(body.documents.map((d: any) => [d.id, d.storageUrl])).toEqual([
      ['d1', PUBLIC],
      ['s1', SIGNED],
    ]);
    expect(calls).toEqual([['content-solutions', PATH, 600]]);
    expect(JSON.stringify(body)).not.toContain('private://');
  });

  it('gives no url, and not the reference, when the signing fails', async () => {
    const { body } = await list([solution()], 'error');
    expect(body.documents[0].storageUrl).toBe('');
    expect(JSON.stringify(body)).not.toContain('content-solutions');
  });

  it('signs nothing for a row that is not trainer-only', async () => {
    const { body, calls } = await list([solution({ visibility: 'ALL' })]);
    expect(calls).toEqual([]);
    expect(body.documents[0].storageUrl).toBe('');
  });
});

describe('trainee list of the use case documents', () => {
  async function traineeList(docs: any[]) {
    jest.resetModules();
    const mock = createTableDb({
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      profiles: [
        {
          id: 't1',
          role: 'TRAINEE',
          organizationId: ORG,
          isPlatformOwner: false,
        },
      ],
      traineeEnrollments: [
        { trainingCatalogId: FIAE, startDate: '2026-01-01' },
      ],
      useCases: [
        { id: USE_CASE, trainingCatalogId: FIAE, courseId: 'c1', title: 'UC' },
      ],
      courseMembers: [{ userId: 't1', courseId: 'c1', role: 'TRAINEE' }],
      contentDocuments: docs,
      organizations: [{ id: 'p', isPlatformOwner: true }],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(traineeSession('t1', { organizationId: ORG }));
    const mod =
      await import('@/app/api/trainee/use-cases/[useCaseId]/documents/route');
    const res = await mod.GET(
      scopeReq(`http://localhost/api/trainee/use-cases/${USE_CASE}/documents`),
      { params: Promise.resolve({ useCaseId: USE_CASE }) }
    );
    return { res, body: await res.json(), mock };
  }

  it('lists the task and the files, never the solution, never a private reference', async () => {
    const { body } = await traineeList([row(), solution()]);
    expect(body.documents.map((d: any) => d.id)).toEqual(['d1']);
    expect(JSON.stringify(body)).not.toContain('private://');
  });

  it('keeps a private reference out even when the row looks harmless (visibility ALL, no type)', async () => {
    const { body } = await traineeList([
      row(),
      solution({ id: 'x1', visibility: 'ALL', documentType: 'THEORY' }),
      solution({ id: 'x2', visibility: null, documentType: 'THEORY' }),
    ]);
    expect(body.documents.map((d: any) => d.id)).toEqual(['d1']);
  });

  it('shows no row without a file: a text row of the import is no dead link', async () => {
    const { body, mock } = await traineeList([
      row(),
      row({ id: 'text', storageUrl: '', documentType: 'THEORY' }),
      row({ id: 'blank', storageUrl: '  ', documentType: 'THEORY' }),
      row({ id: 'null', storageUrl: null, documentType: 'THEORY' }),
    ]);
    expect(body.documents.map((d: any) => d.id)).toEqual(['d1']);
    const where = mock.filters('select', 'content_documents');
    expect(where.sql).toContain('btrim("content_documents"."storage_url")');
  });

  it('keeps the Word documents out, the reader opens PDF files', async () => {
    const { body } = await traineeList([
      row(),
      row({
        id: 'w',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ]);
    expect(body.documents.map((d: any) => d.id)).toEqual(['d1']);
  });
});

describe('trainer list of the enabler documents', () => {
  it('never hands a private reference or its storage path to the browser either', async () => {
    const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
    const { mod } = await loadScoped(
      'trainer/enablers/[enablerId]/documents/route',
      {
        session: trainerSession(),
        tables: {
          enablers: [{ id: ENABLER, trainingCatalogId: FIAE }],
          contentDocuments: [
            row({ id: 'e1', useCaseId: null, enablerId: ENABLER }),
            solution({ id: 'e2', useCaseId: null, enablerId: ENABLER }),
          ],
          organizations: [{ id: 'p', isPlatformOwner: true }],
        },
        setup: () =>
          jest.doMock('@supabase/supabase-js', () => ({
            __esModule: true,
            createClient: () => ({
              storage: {
                from: () => ({
                  createSignedUrl: async () => ({
                    data: { signedUrl: SIGNED },
                    error: null,
                  }),
                }),
              },
            }),
          })),
      }
    );
    const res = await mod.GET(
      scopeReq(`http://localhost/api/trainer/enablers/${ENABLER}/documents`),
      { params: Promise.resolve({ enablerId: ENABLER }) }
    );
    const body = await res.json();
    expect(body.documents.map((d: any) => d.storageUrl)).toEqual([
      PUBLIC,
      SIGNED,
    ]);
    expect(JSON.stringify(body)).not.toContain('private://');
    expect(body.documents[1].storagePath).toBeNull();
  });
});
