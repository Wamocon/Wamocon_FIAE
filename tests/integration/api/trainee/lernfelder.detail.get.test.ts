/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, traineeSession } from '../../../helpers/mockNext';

// GET /api/trainee/lernfelder/[id]: the learning field with its use cases and
// enablers. The description of a use case is for the members of its course, like
// the use case itself. Whoever is no member (and an anonymous caller) gets the
// title and the times and no text. The links only open for members
// (accessible).

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const LF = 'aaaaaaa1-0000-4000-8000-000000000001';
const MEMBER_COURSE = 'bbbbbbb1-0000-4000-8000-000000000001';
const OTHER_COURSE = 'bbbbbbb2-0000-4000-8000-000000000002';
const TEXT = 'Erfundene Kurzbeschreibung des Use Cases';

const tables = {
  trainingCatalogs: [
    { id: FIAE, code: 'FIAE', isActive: true },
    { id: KFBM, code: 'KFBM', isActive: true },
  ],
  organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
  traineeEnrollments: [{ trainingCatalogId: FIAE, startDate: '2026-09-01' }],
  trainingCatalogLearningFields: [
    { id: LF, label: 'LF-1', title: 'Lernfeld', trainingCatalogId: FIAE },
  ],
  courseMembers: [{ courseId: MEMBER_COURSE }],
  useCases: [
    {
      id: 'u1',
      title: 'Use Case der Mitgliedschaft',
      courseId: MEMBER_COURSE,
      descriptionText: TEXT,
    },
    {
      id: 'u2',
      title: 'Use Case ohne Mitgliedschaft',
      courseId: OTHER_COURSE,
      descriptionText: TEXT,
    },
  ],
  trainingCatalogContentMappings: [
    {
      id: 'e1',
      title: 'Enabler A',
      courseId: MEMBER_COURSE,
      courseTitle: 'Mein Kurs',
    },
    {
      id: 'e2',
      title: 'Enabler B',
      courseId: OTHER_COURSE,
      courseTitle: 'Fremder Kurs',
    },
  ],
};

async function load(session: ReturnType<typeof fakeSession> | null) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth/session', () => {
    const actual = jest.requireActual('@/lib/auth/session') as any;
    return { ...actual, getSessionUser: async () => session };
  });
  const mod = await import('@/app/api/trainee/lernfelder/[id]/route');
  const req = {
    url: `http://localhost/api/trainee/lernfelder/${LF}`,
    headers: { get: () => null },
  } as any;
  const res = await mod.GET(req, { params: Promise.resolve({ id: LF }) });
  return { status: res.status, body: await res.json() };
}

describe('GET /api/trainee/lernfelder/[id]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('gives a member the description of the use cases of the courses they are in', async () => {
    const { status, body } = await load(traineeSession('t1'));
    expect(status).toBe(200);
    const mine = body.useCases.find((u: any) => u.id === 'u1');
    expect(mine).toMatchObject({ accessible: true, descriptionText: TEXT });
  });

  it('gives no text of a use case of a course the caller is not a member of', async () => {
    const { body } = await load(traineeSession('t1'));
    const foreign = body.useCases.find((u: any) => u.id === 'u2');
    expect(foreign).toMatchObject({
      accessible: false,
      descriptionText: null,
      title: 'Use Case ohne Mitgliedschaft',
    });
    expect(JSON.stringify(body)).toContain(TEXT);
    expect(JSON.stringify(foreign)).not.toContain(TEXT);
  });

  it('gives an anonymous caller titles only, no text and no enabler', async () => {
    const { status, body } = await load(null);
    expect(status).toBe(200);
    expect(body.enablers).toEqual([]);
    for (const useCase of body.useCases) {
      expect(useCase.accessible).toBe(false);
      expect(useCase.descriptionText).toBeNull();
      expect(typeof useCase.title).toBe('string');
    }
    expect(JSON.stringify(body)).not.toContain(TEXT);
  });

  it('marks the enablers of the courses of the member as accessible and the others not', async () => {
    const { body } = await load(traineeSession('t1'));
    expect(body.enablers.map((e: any) => [e.title, e.accessible])).toEqual([
      ['Enabler A', true],
      ['Enabler B', false],
    ]);
  });

  it('gives a member the name of the course and a non-member neither the name nor the id', async () => {
    const { body } = await load(traineeSession('t1'));
    const [a, b] = body.enablers;
    expect(a.courseTitle).toBe('Mein Kurs');
    expect(b.courseTitle).toBeNull();
    expect(JSON.stringify(b)).not.toContain('Fremder Kurs');
    const foreign = body.useCases.find((u: any) => u.id === 'u2');
    expect(foreign.courseId).toBeNull();
    expect(body.useCases.find((u: any) => u.id === 'u1').courseId).toBe(
      MEMBER_COURSE
    );
  });
});
