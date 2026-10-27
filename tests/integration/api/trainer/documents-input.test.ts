/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  FIAE,
  loadScoped,
  scopeReq,
  TRAINER,
} from '../../../helpers/trainerScope';

// POST of a document: title, fileName, mimeType and documentType are checked.
// An invalid value is a 400 with the name of the field. A document type that
// is no value of the enum used to be a 500 from the insert.

const PLATFORM_FIXTURE_ID = '00000000-0000-4000-8000-0000000000aa';
const SUPABASE = 'https://abc.supabase.co';
const FILE = '1700000000000_skript.pdf';
const OWN_URL = `${SUPABASE}/storage/v1/object/public/content/${TRAINER}/${FILE}`;
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const USE_CASE = 'aaaaaaa7-0000-4000-8000-000000000007';

const targets = [
  {
    name: 'enabler documents',
    route: 'trainer/enablers/[enablerId]/documents/route',
    url: `http://localhost/api/trainer/enablers/${ENABLER}/documents`,
    params: { enablerId: ENABLER },
    tables: () => ({
      enablers: {
        sequence: [
          [{ id: ENABLER, trainingCatalogId: FIAE }],
          [{ id: ENABLER, trainingCatalogId: FIAE }],
        ],
      },
    }),
  },
  {
    name: 'use case documents',
    route: 'trainer/use-cases/[useCaseId]/documents/route',
    url: `http://localhost/api/trainer/use-cases/${USE_CASE}/documents`,
    params: { useCaseId: USE_CASE },
    tables: () => ({
      useCases: [{ id: USE_CASE, trainingCatalogId: FIAE, courseId: 'c' }],
      enablers: [],
    }),
  },
];

const savedEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe.each(targets)('$name', target => {
  async function post(body: unknown) {
    const { mod, mock } = await loadScoped(target.route, {
      tables: {
        ...target.tables(),
        contentDocuments: [],
        organizations: [{ id: PLATFORM_FIXTURE_ID, isPlatformOwner: true }],
      },
    });
    const res = await mod.POST(scopeReq(target.url, { method: 'POST', body }), {
      params: Promise.resolve(target.params),
    });
    return { res, mock };
  }
  const body = (extra: Record<string, unknown> = {}) => ({
    title: 'Skript',
    fileName: FILE,
    storageUrl: OWN_URL,
    ...extra,
  });
  const inserts = (mock: any) => mock.writes('insert', 'content_documents');

  it('stores a document with valid input', async () => {
    const { res, mock } = await post(
      body({
        mimeType: 'application/pdf',
        documentType: 'TRAINEE_QUESTION',
        fileName: 'Lösung Aufgabe 1.pdf',
        title: 'Übung 1',
      })
    );
    expect(res.status).toBe(200);
    expect(inserts(mock)).toHaveLength(1);
    expect(inserts(mock)[0]).toMatchObject({
      title: 'Übung 1',
      fileName: 'Lösung Aufgabe 1.pdf',
      mimeType: 'application/pdf',
      documentType: 'TRAINEE_QUESTION',
    });
  });

  it('stores THEORY and application/pdf when type and mime type are absent', async () => {
    const { res, mock } = await post(body());
    expect(res.status).toBe(200);
    expect(inserts(mock)[0]).toMatchObject({
      documentType: 'THEORY',
      mimeType: 'application/pdf',
    });
  });

  it('answers 400 instead of 500 for a document type that is no enum value', async () => {
    const { res, mock } = await post(body({ documentType: 'SECRET' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/^documentType must be one of: THEORY, /);
    expect(inserts(mock)).toEqual([]);
  });

  it.each([
    ['a title that is too long', { title: 'x'.repeat(256) }, /^title /],
    ['a title that is no text', { title: 5 }, /^title /],
    ['a blank title', { title: '   ' }, /^title /],
    ['a file name that is too long', { fileName: 'x'.repeat(256) }, /^fileName /],
    ['a file name with a slash', { fileName: 'a/b.pdf' }, /^fileName /],
    ['a file name with a backslash', { fileName: 'a\\b.pdf' }, /^fileName /],
    ['a file name that goes up', { fileName: '../a.pdf' }, /^fileName /],
    ['a file name that is no text', { fileName: 3 }, /^fileName /],
    ['an html mime type', { mimeType: 'text/html' }, /^mimeType /],
    ['an svg mime type', { mimeType: 'image/svg+xml' }, /^mimeType /],
    ['a mime type that is no text', { mimeType: {} }, /^mimeType /],
    ['a document type that is no text', { documentType: 5 }, /^documentType /],
  ])('answers 400 for %s and stores nothing', async (_name, extra, message) => {
    const { res, mock } = await post(body(extra));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(message);
    expect(inserts(mock)).toEqual([]);
  });

  it('accepts the other allowed mime types', async () => {
    for (const mimeType of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/png',
      'text/plain',
    ]) {
      const { res } = await post(body({ mimeType }));
      expect(res.status).toBe(200);
    }
  });

  it('still answers 400 with the old message when a required field is missing', async () => {
    const { res } = await post({ fileName: FILE, storageUrl: OWN_URL });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /Missing required fields/
    );
  });

  it('checks the storage url after the other fields', async () => {
    const { res } = await post(
      body({ storageUrl: 'javascript:alert(1)', documentType: 'SECRET' })
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /^documentType /
    );
    const second = await post(body({ storageUrl: 'javascript:alert(1)' }));
    expect(await second.res.json()).toEqual({ error: 'Invalid storageUrl' });
  });
});
