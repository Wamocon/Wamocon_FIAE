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
  superAdminSession,
} from '../../../helpers/trainerScope';

// The pages show a signed address for a file of the bucket content. If an
// editor copies such a link into the scenario PDF, slides or video field of an
// enabler, the row must keep the PUBLIC form of the same file: a signed address
// expires. Links to other hosts and plain text are stored as they come.

const ORIGIN = 'https://proj.supabase.co';
const ENABLER = 'aaaaaaa6-0000-4000-8000-000000000006';
const COURSE = 'cccccccc-0000-4000-8000-000000000001';
const PATH = 'enablers/Aufbau/01_Der_Betrieb.pdf';
const SIGNED = `${ORIGIN}/storage/v1/object/sign/content/${PATH}?token=abc.def`;
const PUBLIC = `${ORIGIN}/storage/v1/object/public/content/${PATH}`;

const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
});
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
});

describe('PATCH /api/trainer/enablers/[enablerId]', () => {
  async function patch(body: Record<string, unknown>) {
    const { mod, mock } = await loadScoped(
      'trainer/enablers/[enablerId]/route',
      {
        session: superAdminSession(),
        tables: {
          enablers: [
            {
              id: ENABLER,
              trainingCatalogId: FIAE,
              courseId: COURSE,
              isActive: true,
              title: 'E',
            },
          ],
        },
      }
    );
    const res = await mod.PATCH(
      scopeReq(`http://localhost/api/trainer/enablers/${ENABLER}`, {
        method: 'PATCH',
        body,
      }),
      { params: Promise.resolve({ enablerId: ENABLER }) }
    );
    return { res, written: mock.writes('update', 'enablers')[0] as any };
  }

  it('stores the public form when a signed link of the own project comes in', async () => {
    const { res, written } = await patch({
      scenarioPdfUrl: SIGNED,
      pptUrl: SIGNED,
      videoUrl: SIGNED,
    });
    expect(res.status).toBe(200);
    expect(written).toMatchObject({
      scenarioPdfUrl: PUBLIC,
      pptUrl: PUBLIC,
      videoUrl: PUBLIC,
    });
  });

  it('stores everything else as it comes', async () => {
    const { written } = await patch({
      scenarioPdfUrl: PUBLIC,
      pptUrl: 'https://example.test/a.pptx',
      videoUrl: null,
      title: 'Neuer Titel',
    });
    expect(written).toMatchObject({
      scenarioPdfUrl: PUBLIC,
      pptUrl: 'https://example.test/a.pptx',
      videoUrl: null,
      title: 'Neuer Titel',
    });
  });

  it('does not touch a text field that only looks like a link', async () => {
    const { written } = await patch({
      title: SIGNED,
      descriptionText: SIGNED,
    });
    expect(written).toMatchObject({ title: SIGNED, descriptionText: SIGNED });
  });

  it('leaves a signed link of another host alone', async () => {
    const foreign = `https://evil.example/storage/v1/object/sign/content/${PATH}?token=abc`;
    const { written } = await patch({ scenarioPdfUrl: foreign });
    expect(written.scenarioPdfUrl).toBe(foreign);
  });
});

describe('POST /api/trainer/courses/[courseId]/enablers', () => {
  it('stores the public form when a signed link of the own project comes in', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/courses/[courseId]/enablers/route',
      {
        session: superAdminSession(),
        tables: {
          courses: [{ id: COURSE, trainingCatalogId: FIAE, title: 'C' }],
          enablers: [],
          courseMembers: [],
        },
      }
    );
    const res = await mod.POST(
      scopeReq(`http://localhost/api/trainer/courses/${COURSE}/enablers`, {
        method: 'POST',
        body: {
          title: 'E',
          scenarioPdfUrl: SIGNED,
          pptUrl: SIGNED,
          videoUrl: 'https://www.youtube.com/watch?v=abc',
        },
      }),
      { params: Promise.resolve({ courseId: COURSE }) }
    );
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'enablers')[0]).toMatchObject({
      scenarioPdfUrl: PUBLIC,
      pptUrl: PUBLIC,
      videoUrl: 'https://www.youtube.com/watch?v=abc',
    });
  });

  it('keeps an empty field undefined', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/courses/[courseId]/enablers/route',
      {
        session: superAdminSession(),
        tables: {
          courses: [{ id: COURSE, trainingCatalogId: FIAE, title: 'C' }],
          enablers: [],
          courseMembers: [],
        },
      }
    );
    await mod.POST(
      scopeReq(`http://localhost/api/trainer/courses/${COURSE}/enablers`, {
        method: 'POST',
        body: { title: 'E' },
      }),
      { params: Promise.resolve({ courseId: COURSE }) }
    );
    const inserted = mock.writes('insert', 'enablers')[0] as any;
    expect(inserted.scenarioPdfUrl).toBeUndefined();
    expect(inserted.pptUrl).toBeUndefined();
  });
});

describe('GET /api/trainer/enablers/[enablerId]', () => {
  const stored = {
    id: ENABLER,
    trainingCatalogId: FIAE,
    courseId: COURSE,
    isActive: true,
    title: 'E',
    scenarioPdfUrl: PUBLIC,
    pptUrl: null,
    videoUrl: 'https://www.youtube.com/watch?v=abc',
  };

  async function get(mode: 'ok' | 'error') {
    process.env.SUPABASE_SECRET_KEY = 'sb-secret';
    const { mod } = await loadScoped('trainer/enablers/[enablerId]/route', {
      session: superAdminSession(),
      tables: { enablers: [stored] },
      setup: () =>
        jest.doMock('@supabase/supabase-js', () => ({
          __esModule: true,
          createClient: () => ({
            storage: {
              from: () => ({
                createSignedUrls: async (paths: string[]) =>
                  mode === 'ok'
                    ? {
                        data: paths.map(path => ({
                          path,
                          signedUrl: `${ORIGIN}/storage/v1/object/sign/content/${path}?token=t`,
                          error: null,
                        })),
                        error: null,
                      }
                    : { data: null, error: new Error('down') },
              }),
            },
          }),
        })),
    });
    const res = await mod.GET(
      scopeReq(`http://localhost/api/trainer/enablers/${ENABLER}`),
      { params: Promise.resolve({ enablerId: ENABLER }) }
    );
    return res.json();
  }

  it('keeps the stored addresses for the edit form and adds signed links to open the files', async () => {
    const body = await get('ok');
    expect(body.enabler.scenarioPdfUrl).toBe(PUBLIC);
    expect(body.signedLinks).toEqual({
      scenarioPdfUrl: `${ORIGIN}/storage/v1/object/sign/content/${PATH}?token=t`,
      pptUrl: null,
      videoUrl: 'https://www.youtube.com/watch?v=abc',
    });
  });

  it('while the bucket is public the signed link falls back to the stored address', async () => {
    const body = await get('error');
    expect(body.signedLinks.scenarioPdfUrl).toBe(PUBLIC);
  });
});
