/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// Chat route and the occupation chosen in the app (found in the Preview on 02.11.2026):
// a trainee with two occupations chose FIAE in the app and the HAI answered about KfBM
// too, while the quiz mode followed the tab. The app sends the choice as the header
// x-catalog. The HAI now follows it like the rest of the platform: the route hands it to
// the pipeline (search, page index and persona work in that one occupation) and uses it
// for the titles of the open enabler or course. It is never an access right: a code
// outside the occupations of the user is ignored, without a code the user keeps all.

const ME = 'me-1';
const FIAE_ID = '00000000-0000-4000-8000-000000000001';
const KFBM_ID = '00000000-0000-4000-8000-000000000002';
const ENABLER = '20000000-0000-4000-8000-000000000001';
const COURSE = '20000000-0000-4000-8000-000000000003';

/** The scope as the catalog module answers it: a code of the user narrows, another is a 403 (null). */
const CODES: Record<string, string> = { fiae: FIAE_ID, kfbm: KFBM_ID };

async function load(enablerCatalogId = FIAE_ID) {
  jest.resetModules();
  mockSession(
    fakeSession({ id: ME, role: 'TRAINEE', organizationId: 'org-1' })
  );
  const rec = createTableDb(
    {
      profiles: [
        {
          id: ME,
          role: 'TRAINEE',
          startOfTrainingDate: null,
          ausbildungDurationYears: 3,
        },
      ],
      haiChatSessions: [],
      haiChatMessages: [],
      enablers: [
        {
          title: 'Titel des Enablers',
          courseId: COURSE,
          trainingCatalogId: enablerCatalogId,
        },
      ],
      courses: [
        { title: 'Titel des Kurses', trainingCatalogId: enablerCatalogId },
      ],
    },
    { haiChatSessions: [{ id: 'session-1' }] }
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan: jest.fn(async () => true),
    getUserOrgId: jest.fn(async () => 'org-1'),
    getUserOrgIdStrict: jest.fn(async () => 'org-1'),
  }));
  jest.doMock('@/lib/catalog/scope', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/catalog/scope') as object),
    // a trainee with both occupations
    getCatalogScopeForUserId: async (
      _userId: string,
      request?: { headers?: { get(name: string): string | null } }
    ) => {
      const allowedCatalogIds = [FIAE_ID, KFBM_ID];
      const code = request?.headers?.get('x-catalog')?.trim().toLowerCase();
      if (!code) {
        return { allowedCatalogIds, activeCatalogId: FIAE_ID, selected: false };
      }
      const id = CODES[code];
      return id
        ? { allowedCatalogIds, activeCatalogId: id, selected: true }
        : null;
    },
  }));
  const processMessage = jest.fn(async (..._args: unknown[]) => ({
    response: 'Antwort',
    intent: 'question',
    citations: [],
  }));
  jest.doMock('@/lib/hai', () => ({
    __esModule: true,
    processMessage,
    processMessageStream: jest.fn(),
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getProviderStatus: () => ({ primary: 'test' }),
  }));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const mod = (await import('@/app/api/hai/chat/route')) as any;
  return { mod, processMessage };
}

const post = (
  headers: Record<string, string> = {},
  context: Record<string, unknown> = {}
) =>
  makeRequest('POST', 'http://localhost/api/hai/chat', {
    token: 't',
    headers,
    body: { message: 'Zeig mir FIAE-Inhalte', context },
  });

const contextOf = (processMessage: jest.Mock<any>) =>
  processMessage.mock.calls[0][1] as Record<string, unknown>;

describe('HAI chat route: the occupation chosen in the app', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hands the chosen occupation to the pipeline', async () => {
    const { mod, processMessage } = await load();
    const res = await mod.POST(post({ 'x-catalog': 'FIAE' }));
    expect(res.status).toBe(200);
    expect((processMessage.mock.calls[0][1] as any).preferredCatalogCode).toBe(
      'FIAE'
    );
  });

  // the titles of the open enabler follow the choice like the search does
  it.each([
    ['FIAE', FIAE_ID, true],
    ['FIAE', KFBM_ID, false],
    ['KFBM', KFBM_ID, true],
    ['KFBM', FIAE_ID, false],
  ])(
    'with the tab %s an enabler of the catalog %s is kept: %s',
    async (code, enablerCatalog, kept) => {
      const { mod, processMessage } = await load(enablerCatalog);
      const res = await mod.POST(
        post({ 'x-catalog': code }, { enablerId: ENABLER })
      );
      expect(res.status).toBe(200);
      const ctx = contextOf(processMessage as never);
      if (kept) {
        expect(ctx.currentEnablerId).toBe(ENABLER);
        expect(ctx.enablerTitle).toBe('Titel des Enablers');
        expect(ctx.contextDropped).toBe(false);
      } else {
        // an enabler of the other own occupation is dropped, with its title
        expect(ctx.currentEnablerId).toBeUndefined();
        expect(ctx.enablerTitle).toBeUndefined();
        expect(ctx.contextDropped).toBe(true);
      }
    }
  );

  it('without a choice both occupations of the user count for the open enabler', async () => {
    for (const catalog of [FIAE_ID, KFBM_ID]) {
      const { mod, processMessage } = await load(catalog);
      await mod.POST(post({}, { enablerId: ENABLER }));
      expect(contextOf(processMessage as never).currentEnablerId).toBe(ENABLER);
    }
  });

  it('ignores a code that is not an occupation of the user: no 403, all occupations as before', async () => {
    const { mod, processMessage } = await load(KFBM_ID);
    const res = await mod.POST(
      post({ 'x-catalog': 'DEMO' }, { enablerId: ENABLER })
    );
    expect(res.status).toBe(200);
    const ctx = contextOf(processMessage as never);
    expect(ctx.currentEnablerId).toBe(ENABLER);
    expect(ctx.contextDropped).toBe(false);
  });

  it('hands nothing when the app sent no choice', async () => {
    const { mod, processMessage } = await load();
    const res = await mod.POST(post());
    expect(res.status).toBe(200);
    expect(
      (processMessage.mock.calls[0][1] as any).preferredCatalogCode
    ).toBeNull();
  });
});
