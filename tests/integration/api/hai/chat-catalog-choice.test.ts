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
// a trainee with two occupations chose FIAE in the app and the HAI spoke only for KfBM.
// The app sends the choice as the header x-catalog. The route hands it to the pipeline,
// where it only decides which occupation comes first in the persona. It is never an
// access right, the pipeline reads what the user may see from the database.

const ME = 'me-1';

async function load() {
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
      enablers: [],
      courses: [],
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
    getCatalogScopeForUserId: async () => ({
      allowedCatalogIds: ['00000000-0000-4000-8000-000000000001'],
      activeCatalogId: '00000000-0000-4000-8000-000000000001',
      selected: false,
    }),
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

const post = (headers: Record<string, string> = {}) =>
  makeRequest('POST', 'http://localhost/api/hai/chat', {
    token: 't',
    headers,
    body: { message: 'Zeig mir FIAE-Inhalte' },
  });

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

  it('hands nothing when the app sent no choice', async () => {
    const { mod, processMessage } = await load();
    const res = await mod.POST(post());
    expect(res.status).toBe(200);
    expect(
      (processMessage.mock.calls[0][1] as any).preferredCatalogCode
    ).toBeNull();
  });
});
