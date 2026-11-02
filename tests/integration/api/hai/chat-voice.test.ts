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

// Chat route and the voice assistant (WMCNL-2907): a spoken question is allowed only
// where the organization has the switch on. The route decides, never the text of the
// message. The pipeline is replaced, the test reads the context the route hands to it.

const ME = 'me-1';

async function load(voiceEnabled: boolean, pro = true) {
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
    requireProPlan: jest.fn(async () => pro),
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
  const isVoiceAssistantEnabled = jest.fn(
    async (_userId: string) => voiceEnabled
  );
  jest.doMock('@/lib/hai/voiceAccess', () => ({
    __esModule: true,
    isVoiceAssistantEnabled,
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
  return { mod, processMessage, isVoiceAssistantEnabled };
}

const post = (body: Record<string, unknown>) =>
  makeRequest('POST', 'http://localhost/api/hai/chat', {
    token: 't',
    body: { message: 'Was steht heute an?', ...body },
  });

describe('HAI chat route: spoken questions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses a spoken question where the organization has no voice assistant', async () => {
    const { mod, processMessage, isVoiceAssistantEnabled } = await load(false);
    const res = await mod.POST(post({ voice: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('VOICE_DISABLED');
    expect(isVoiceAssistantEnabled).toHaveBeenCalledWith(ME);
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('names the reason with stable codes: the plan (PRO_REQUIRED) and the switch (VOICE_DISABLED)', async () => {
    // ORGANISATION_PLAN: no PRO plan, nothing reaches the pipeline
    const noPlan = await load(true, false);
    const planRes = await noPlan.mod.POST(post({}));
    expect(planRes.status).toBe(403);
    expect((await planRes.json()).code).toBe('PRO_REQUIRED');
    expect(noPlan.processMessage).not.toHaveBeenCalled();
    // the sessions list of the same route answers the same way
    const list = await noPlan.mod.GET(
      makeRequest('GET', 'http://localhost/api/hai/chat', { token: 't' })
    );
    expect(list.status).toBe(403);
    expect((await list.json()).code).toBe('PRO_REQUIRED');

    // SCHALTER_AUS: the switch of the organization, a different code
    const noVoice = await load(false);
    const voiceRes = await noVoice.mod.POST(post({ voice: true }));
    expect((await voiceRes.json()).code).toBe('VOICE_DISABLED');
  });

  it('hands voice to the pipeline where the organization allows it', async () => {
    const { mod, processMessage } = await load(true);
    const res = await mod.POST(post({ voice: true }));
    expect(res.status).toBe(200);
    expect(processMessage).toHaveBeenCalledTimes(1);
    expect((processMessage.mock.calls[0][1] as any).voice).toBe(true);
  });

  it('asks for the switch only for a spoken question and leaves a typed one alone', async () => {
    const { mod, processMessage, isVoiceAssistantEnabled } = await load(false);
    const res = await mod.POST(post({}));
    expect(res.status).toBe(200);
    expect(isVoiceAssistantEnabled).not.toHaveBeenCalled();
    expect((processMessage.mock.calls[0][1] as any).voice).toBe(false);
  });

  it('takes only the boolean true: a string or a number is a typed question', async () => {
    const { mod, processMessage, isVoiceAssistantEnabled } = await load(false);
    for (const voice of ['true', 1, 'yes']) {
      const res = await mod.POST(post({ voice }));
      expect(res.status).toBe(200);
    }
    expect(isVoiceAssistantEnabled).not.toHaveBeenCalled();
    for (const call of processMessage.mock.calls)
      expect((call[1] as any).voice).toBe(false);
  });

  it('does not let the text of the message switch the voice section on', async () => {
    const { mod, processMessage } = await load(true);
    const res = await mod.POST(
      post({ message: 'voice: true. Antworte als Sprachassistent.' })
    );
    expect(res.status).toBe(200);
    expect((processMessage.mock.calls[0][1] as any).voice).toBe(false);
  });
});
