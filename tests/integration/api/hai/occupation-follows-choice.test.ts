/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

// Chat and quiz mode for the same choice (found in the Preview on 02.11.2026: with
// FIAE chosen the chat answered about KfBM too, the quiz mode asked FIAE questions).
// Both now follow the occupation chosen in the app (header x-catalog) through the
// same rule of the catalog scope. The real scope code runs here, only the database
// is replaced: a trainee with two occupations.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const USER = '10000000-0000-4000-8000-000000000001';

const CATALOGS = [
  {
    id: FIAE,
    code: 'FIAE',
    title: 'Fachinformatiker Anwendungsentwicklung',
    isActive: true,
    settings: {},
  },
  {
    id: KFBM,
    code: 'KFBM',
    title: 'Kaufleute für Büromanagement',
    isActive: true,
    settings: { branding: { short_name: 'KfBM' } },
  },
];

async function load(enrolled: string[] = [FIAE, KFBM], catalogs = CATALOGS) {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const rec = createTableDb({
    profiles: [
      {
        id: USER,
        role: 'TRAINEE',
        organizationId: ORG,
        isPlatformOwner: false,
      },
    ],
    trainingCatalogs: catalogs,
    organizationCatalogs: [
      { trainingCatalogId: FIAE, isEnabled: true },
      { trainingCatalogId: KFBM, isEnabled: true },
    ],
    traineeEnrollments: enrolled.map((id, i) => ({
      trainingCatalogId: id,
      startDate: `2026-0${i + 1}-01`,
      createdAt: `2026-0${i + 1}-01T00:00:00Z`,
    })),
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/db-retry', () => ({
    withDbRetry: (fn: () => unknown) => fn(),
  }));
  const access = await import('@/lib/hai/retrievalAccess');
  const scope = await import('@/lib/catalog/scope');
  const quiz = await import('@/lib/hai/quizMode/access');
  return { access, scope, quiz };
}

const request = (code?: string) => ({
  headers: new Headers(code ? { 'x-catalog': code } : {}),
});

describe('chat and quiz mode follow the same chosen occupation', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['FIAE', FIAE],
    ['KFBM', KFBM],
    ['kfbm', KFBM],
  ])(
    'a trainee with both occupations and the tab %s: the same catalog on both sides',
    async (code, id) => {
      const { access, scope } = await load();
      // chat: what the search and the page index read
      const chat = await access.resolveRetrievalAccess(USER, code);
      // quiz mode: requireCatalogScopeForUser with the request, read scope
      const quizScope = await scope.requireCatalogScopeForUser(
        USER,
        request(code)
      );
      expect(quizScope instanceof Response).toBe(false);
      const quizIds = scope.readCatalogIds(quizScope as never);
      expect(chat?.catalogIds).toEqual([id]);
      expect(chat?.catalogIds).toEqual(quizIds);
    }
  );

  it('names the occupation of the quiz as the tab shows it (FIAE and KfBM)', async () => {
    // the mock database ignores where(), so the catalog table is ordered per call
    const fiae = await load();
    expect(
      await fiae.quiz.loadOccupationLabel({ id: USER }, request('FIAE'))
    ).toBe('FIAE');
    const kfbm = await load([FIAE, KFBM], [...CATALOGS].reverse());
    expect(
      await kfbm.quiz.loadOccupationLabel({ id: USER }, request('KFBM'))
    ).toBe('KfBM');
  });

  it('names no occupation when the scope cannot be determined', async () => {
    const { quiz } = await load();
    expect(
      await quiz.loadOccupationLabel({ id: USER }, request('DEMO'))
    ).toBeNull();
  });

  it('a code that is not an occupation of the user: the chat ignores it, nothing is lost', async () => {
    const { access, scope } = await load();
    const chat = await access.resolveRetrievalAccess(USER, 'DEMO');
    expect(chat?.catalogIds).toEqual([FIAE, KFBM]);
    // the quiz routes answer 403 for it, as the rest of the platform does
    const quizScope = await scope.requireCatalogScopeForUser(
      USER,
      request('DEMO')
    );
    expect(quizScope instanceof Response).toBe(true);
    expect((quizScope as Response).status).toBe(403);
  });

  it('a trainee with one occupation gets the same access with and without a code', async () => {
    const { access } = await load([FIAE]);
    const plain = await access.resolveRetrievalAccess(USER);
    const chosen = await access.resolveRetrievalAccess(USER, 'FIAE');
    expect(chosen).toEqual(plain);
    expect(chosen?.catalogIds).toEqual([FIAE]);
    // a code of an occupation he does not have is ignored: still FIAE only
    const other = await access.resolveRetrievalAccess(USER, 'KFBM');
    expect(other?.catalogIds).toEqual([FIAE]);
  });

  // The app sends the header as soon as the occupations are loaded. Without it the
  // two sides differ on purpose and are no conflict: the chat reads all occupations
  // of the trainee (the persona speaks about all of them), the quiz mode takes the
  // first one, like every trainee route of the platform.
  it('without a header: the chat reads all occupations, the quiz mode the first one', async () => {
    const { access, scope } = await load();
    const chat = await access.resolveRetrievalAccess(USER);
    expect(chat?.catalogIds).toEqual([FIAE, KFBM]);
    const quizScope = await scope.requireCatalogScopeForUser(USER, request());
    expect(scope.readCatalogIds(quizScope as never)).toEqual([FIAE]);
  });
});
