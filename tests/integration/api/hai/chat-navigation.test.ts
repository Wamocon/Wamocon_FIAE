/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  FIAE_CATALOG_ID,
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// Chat route and the agent layer (guidance through the platform): the answer
// carries the navigation offer of the pipeline, in the streaming and in the
// blocking path, for a typed and for a spoken question. The route takes the
// admin level from the session. Part one replaces the pipeline and reads what
// the route hands over and sends back, part two runs the real pipeline behind
// the route (the model is replaced and must not be called).

const ME = 'me-1';
const E1 = '20000000-0000-4000-8000-000000000001';

const OFFER = {
  path: '/trainee/activity-reports',
  label: 'Ausbildungsnachweis',
  reason:
    'Dort führst du dein Berichtsheft mit den wöchentlichen Tätigkeitsnachweisen.',
};

const offerResult = {
  response: 'Ich habe die Seite Ausbildungsnachweis für dich.',
  intent: 'navigation',
  citations: [],
  navigationOffer: OFFER,
};

type Mode = 'replaced' | 'real';

async function load(
  mode: Mode,
  options: {
    result?: Record<string, unknown>;
    session?: Partial<ReturnType<typeof fakeSession>>;
    voiceEnabled?: boolean;
  } = {}
) {
  jest.resetModules();
  mockSession(
    fakeSession({
      id: ME,
      role: 'TRAINEE',
      organizationId: 'org-1',
      isTrainerLevel: false,
      ...options.session,
    })
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
      allowedCatalogIds: [FIAE_CATALOG_ID],
      activeCatalogId: FIAE_CATALOG_ID,
      selected: false,
    }),
  }));
  jest.doMock('@/lib/hai/voiceAccess', () => ({
    __esModule: true,
    isVoiceAssistantEnabled: jest.fn(async () => options.voiceEnabled ?? true),
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getProviderStatus: () => ({ primary: 'test' }),
    chatWithFallback: model,
    getChatProvider: () => ({ isInitialized: () => true }),
    getEmbeddingProvider: () => ({ isInitialized: () => false }),
  }));

  const processMessage = jest.fn(
    async (..._args: unknown[]) => options.result ?? offerResult
  );
  const processMessageStream = jest.fn(
    async (..._args: unknown[]) => options.result ?? offerResult
  );

  if (mode === 'replaced') {
    jest.doMock('@/lib/hai', () => ({
      __esModule: true,
      processMessage,
      processMessageStream,
    }));
  } else {
    jest.doMock('@/lib/hai/retrievalAccess', () => ({
      __esModule: true,
      ...(jest.requireActual('@/lib/hai/retrievalAccess') as object),
      resolveRetrievalAccess: async () => ({
        catalogIds: [FIAE_CATALOG_ID],
        audience: 'trainee',
        organizationId: 'org-1',
        userId: ME,
      }),
    }));
    jest.doMock('@/lib/hai/personaAccess', () => ({
      __esModule: true,
      loadHaiPersona: async () =>
        (jest.requireActual('@/lib/hai/persona') as any).resolveHaiPersona({
          catalogs: [
            {
              id: FIAE_CATALOG_ID,
              code: 'FIAE',
              title: 'Fachinformatiker Anwendungsentwicklung',
              settings: {},
            },
          ],
        }),
    }));
    jest.doMock('@/lib/hai/vectorSearch', () => ({
      __esModule: true,
      searchWithContext: jest.fn(async () => ({ results: [] })),
    }));
    jest.doMock('@/lib/hai/pageIndexService', () => ({
      __esModule: true,
      fetchPageIndexContext: jest.fn(async () => ({
        pdfContext: '',
        citations: [],
      })),
    }));
    jest.doMock('@/lib/hai/dataContext', () => ({
      __esModule: true,
      fetchDataContext: jest.fn(async () => null),
    }));
    jest.doMock('@/lib/hai/actions', () => ({
      __esModule: true,
      detectActionIntent: jest.fn(() => null),
      executeAction: jest.fn(),
    }));
    jest.doMock('@/lib/hai/navigation/data', () => ({
      __esModule: true,
      loadTraineeEnablers: jest.fn(async () => [
        {
          id: E1,
          title: 'Enabler 3: SQL Grundlagen',
          code: '3',
          courseId: 'c1',
          courseTitle: 'Datenbanken',
        },
      ]),
      loadTraineeUseCases: jest.fn(async () => []),
      loadEnablerLock: jest.fn(async () => ({
        locked: false,
        lockedByTitle: null,
        hasActiveQuiz: true,
      })),
      loadNextStepEntries: jest.fn(async () => []),
    }));
    jest.doMock('@/lib/hai', () => {
      const pipeline = jest.requireActual('@/lib/hai/ragPipeline') as any;
      return {
        __esModule: true,
        processMessage: pipeline.processMessage,
        processMessageStream: pipeline.processMessageStream,
      };
    });
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const mod = (await import('@/app/api/hai/chat/route')) as any;
  return { mod, rec, processMessage, processMessageStream };
}

const model = jest.fn(async (..._args: unknown[]) => ({
  text: 'Antwort des Modells',
  citations: [],
}));

const post = (body: Record<string, unknown>) =>
  makeRequest('POST', 'http://localhost/api/hai/chat', {
    token: 't',
    body: { message: 'öffne meine Berichte', context: {}, ...body },
  } as never);

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .split('\n')
    .filter((l: string) => l.startsWith('data: '))
    .map((l: string) => JSON.parse(l.slice(6)));
}

const assistantInserts = (rec: any) =>
  (
    rec.writes('insert', 'hai_chat_messages') as Array<Record<string, any>>
  ).filter(m => m.role === 'assistant');

describe('HAI chat route: the navigation offer of the pipeline', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocking: sends the offer next to the text and stores the text as the answer', async () => {
    const { mod, rec } = await load('replaced');
    const res = await mod.POST(post({ stream: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.navigationOffer).toEqual(OFFER);
    expect(body.intent).toBe('navigation');
    expect(body.response).toBe(offerResult.response);
    expect(body.pendingAction).toBeUndefined();
    expect(assistantInserts(rec)[0].content).toBe(offerResult.response);
  });

  it('streaming: sends the offer with the final event, after the text', async () => {
    const { mod } = await load('replaced');
    const res = await mod.POST(post({ stream: true }));
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    const done = events.find((e: any) => e.done);
    expect(done.navigationOffer).toEqual(OFFER);
    expect(done.intent).toBe('navigation');
    expect(typeof done.sessionId).toBe('string');
  });

  it('sends no offer for a normal answer', async () => {
    const { mod } = await load('replaced', {
      result: { response: 'Eine Antwort', intent: 'question', citations: [] },
    });
    const res = await mod.POST(post({ stream: false }));
    const body = await res.json();
    expect(body.navigationOffer).toBeUndefined();
  });

  it('spoken: hands voice true to the pipeline and sends the offer back', async () => {
    const { mod, processMessage } = await load('replaced', {
      result: {
        ...offerResult,
        response: `${offerResult.response} Soll ich sie öffnen?`,
      },
    });
    const res = await mod.POST(post({ stream: false, voice: true }));
    expect(res.status).toBe(200);
    expect((processMessage.mock.calls[0][1] as any).voice).toBe(true);
    const body = await res.json();
    expect(body.navigationOffer).toEqual(OFFER);
    expect(body.response.endsWith('Soll ich sie öffnen?')).toBe(true);
  });

  it('spoken where the organization has no voice assistant: refused, no offer', async () => {
    const { mod, processMessage } = await load('replaced', {
      voiceEnabled: false,
    });
    const res = await mod.POST(post({ stream: false, voice: true }));
    expect(res.status).toBe(403);
    expect((await res.json()).navigationOffer).toBeUndefined();
    expect(processMessage).not.toHaveBeenCalled();
  });

  it('takes the admin level from the session, never from the request', async () => {
    const trainee = await load('replaced');
    await trainee.mod.POST(
      post({ stream: false, isAdmin: true, context: { isAdmin: true } })
    );
    expect((trainee.processMessage.mock.calls[0][1] as any).isAdmin).toBe(
      false
    );

    const admin = await load('replaced', {
      session: { role: 'ADMIN', isAdmin: true, isTrainerLevel: true },
    });
    await admin.mod.POST(post({ stream: false }));
    expect((admin.processMessage.mock.calls[0][1] as any).isAdmin).toBe(true);
  });
});

describe('HAI chat route with the real pipeline behind it', () => {
  beforeEach(() => jest.clearAllMocks());

  it('typed: answers "öffne meine Berichte" with the offer and the hint at the button, no model call', async () => {
    const { mod, rec } = await load('real');
    const res = await mod.POST(post({ stream: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.navigationOffer).toEqual(OFFER);
    expect(body.response).toContain('Mit Öffnen gelangst du direkt dorthin.');
    expect(body.response).not.toContain('Soll ich sie öffnen?');
    expect(model).not.toHaveBeenCalled();
    expect(assistantInserts(rec)[0].content).toBe(body.response);
  });

  it('spoken: ends with "Soll ich sie öffnen?" and sends the offer in the final event', async () => {
    const { mod } = await load('real');
    const res = await mod.POST(post({ stream: true, voice: true }));
    const events = await readEvents(res);
    const text = events
      .filter((e: any) => typeof e.chunk === 'string')
      .map((e: any) => e.chunk)
      .join('');
    expect(text.endsWith('Soll ich sie öffnen?')).toBe(true);
    expect(events.find((e: any) => e.done).navigationOffer).toEqual(OFFER);
    expect(model).not.toHaveBeenCalled();
  });

  it('refuses the page of the trainer area to a trainee: friendly text, no offer', async () => {
    const { mod } = await load('real');
    const res = await mod.POST(
      post({
        stream: false,
        message: 'Bring mich zur Seite der Auszubildenden',
      })
    );
    const body = await res.json();
    expect(body.navigationOffer).toBeUndefined();
    expect(body.response).toContain(
      'Diese Seite kann ich dir nicht öffnen, weil sie zum Trainerbereich gehört'
    );
    expect(body.response).toContain('für deine Rolle nicht freigegeben');
    expect(model).not.toHaveBeenCalled();
  });

  it('finds an enabler by number and offers its page', async () => {
    const { mod } = await load('real');
    const res = await mod.POST(
      post({ stream: false, message: 'Bring mich zum Quiz von Enabler 3' })
    );
    const body = await res.json();
    expect(body.navigationOffer.path).toBe(`/trainee/enablers/${E1}`);
  });

  it('leaves a learning question to the model: no offer', async () => {
    const { mod } = await load('real');
    const res = await mod.POST(
      post({ stream: false, message: 'Was ist Normalisierung?' })
    );
    const body = await res.json();
    expect(body.navigationOffer).toBeUndefined();
    expect(model).toHaveBeenCalledTimes(1);
  });
});
