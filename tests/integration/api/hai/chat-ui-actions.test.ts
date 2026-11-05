/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  FIAE_CATALOG_ID,
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// Chat route and the UI tools of the HAI (docs/hai-ui-aktionen.md): the real
// pipeline runs behind the route, the model is a mock that answers with a
// block. The route sends the checked event `uiAction` with the final event of
// the stream and in the JSON, the text has no block, and the stored message
// holds identifiers only (tool, form, field ids), never a value. With the
// switch off nothing changes, and a page of another role gives nothing.

const ME = 'me-1';
const VALUE = 'Streng Geheimer Name';

const block = (value: unknown) => `<hai-ui>${JSON.stringify(value)}</hai-ui>`;
const nameBlock = block({
  tool: 'fill_form',
  form: 'profile_name',
  fields: { fullName: VALUE },
});

let modelText = '';
const model = jest.fn(
  async (
    _system: unknown,
    _history: unknown,
    _message: unknown,
    onChunk?: (chunk: string) => void
  ) => {
    if (onChunk) {
      for (let i = 0; i < modelText.length; i += 9) {
        onChunk(modelText.slice(i, i + 9));
      }
    }
    return { text: modelText, citations: [] };
  }
);

async function load() {
  jest.resetModules();
  mockSession(
    fakeSession({
      id: ME,
      role: 'TRAINEE',
      organizationId: 'org-1',
      isTrainerLevel: false,
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
      useCases: [],
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
    isVoiceAssistantEnabled: jest.fn(async () => true),
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getProviderStatus: () => ({ primary: 'test' }),
    chatWithFallback: model,
    getChatProvider: () => ({ isInitialized: () => true }),
    getEmbeddingProvider: () => ({ isInitialized: () => false }),
  }));
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
    loadTraineeEnablers: jest.fn(async () => []),
    loadTraineeUseCases: jest.fn(async () => []),
    loadEnablerLock: jest.fn(async () => ({ locked: false })),
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
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const mod = (await import('@/app/api/hai/chat/route')) as any;
  return { mod, rec };
}

const profilePage = {
  path: '/trainee/profile',
  kind: 'profile',
  title: 'Profil',
  ids: [],
  visibleLabels: [],
};

const post = (body: Record<string, unknown>) =>
  makeRequest('POST', 'http://localhost/api/hai/chat', {
    token: 't',
    body: {
      message: 'Trag bitte meinen Namen im Profil ein',
      context: { page: profilePage },
      ...body,
    },
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

const OLD = {
  ui: process.env.HAI_UI_ACTIONS,
  page: process.env.HAI_PAGE_CONTEXT,
};

describe('HAI chat route: UI tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HAI_UI_ACTIONS = 'on';
    delete process.env.HAI_PAGE_CONTEXT;
    modelText = `Ich trage deinen Namen ein.\n\n${nameBlock}`;
  });
  afterEach(() => {
    if (OLD.ui === undefined) delete process.env.HAI_UI_ACTIONS;
    else process.env.HAI_UI_ACTIONS = OLD.ui;
    if (OLD.page === undefined) delete process.env.HAI_PAGE_CONTEXT;
    else process.env.HAI_PAGE_CONTEXT = OLD.page;
  });

  it('streaming: the event comes with the final event, the text has no block, nothing personal is stored', async () => {
    const { mod, rec } = await load();
    const res = await mod.POST(post({ stream: true }));
    expect(res.status).toBe(200);
    const events = await readEvents(res);
    const text = events
      .filter((e: any) => typeof e.chunk === 'string')
      .map((e: any) => e.chunk)
      .join('');
    expect(text).not.toContain('hai-ui');
    expect(text).not.toContain('fill_form');
    const done = events.find((e: any) => e.done);
    expect(done.uiAction).toEqual({
      tool: 'fill_form',
      form: 'profile_name',
      fields: [{ id: 'fullName', value: VALUE }],
      mode: 'apply',
    });
    const saved = assistantInserts(rec)[0];
    // what is stored is the text the person saw, with the fixed sentence
    expect(saved.content).toBe(text);
    expect(saved.content).toContain('Gespeichert ist noch nichts');
    expect(saved.metadata.uiAction).toEqual({
      tool: 'fill_form',
      form: 'profile_name',
      fieldIds: ['fullName'],
      mode: 'apply',
    });
    // no value anywhere in what was written to the database
    expect(
      JSON.stringify(rec.writes('insert', 'hai_chat_messages'))
    ).not.toContain(VALUE);
    expect(
      JSON.stringify(rec.writes('update', 'hai_chat_messages'))
    ).not.toContain(VALUE);
    expect(
      JSON.stringify(rec.writes('insert', 'hai_chat_sessions'))
    ).not.toContain(VALUE);
  });

  it('blocking: the JSON carries the event, the response has no block', async () => {
    const { mod } = await load();
    const res = await mod.POST(post({ stream: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uiAction).toMatchObject({
      tool: 'fill_form',
      form: 'profile_name',
      mode: 'apply',
    });
    expect(body.response).not.toContain('hai-ui');
  });

  it('spoken: the event is only shown (mode confirm), nothing is put in', async () => {
    const { mod } = await load();
    const res = await mod.POST(post({ stream: false, voice: true }));
    const body = await res.json();
    expect(body.uiAction).toMatchObject({
      form: 'profile_name',
      mode: 'confirm',
    });
    expect(body.response).toContain('noch nicht eingetragen');
    expect(String(model.mock.calls[0][0])).toContain('gesprochenes Gespräch');
  });

  it('without the switch: no event, the answer is the raw text of the model', async () => {
    delete process.env.HAI_UI_ACTIONS;
    const { mod } = await load();
    const res = await mod.POST(post({ stream: false }));
    const body = await res.json();
    expect(body.uiAction).toBeUndefined();
    expect(body.response).toBe(modelText);
    expect(String(model.mock.calls[0][0])).not.toContain(
      'Werkzeuge (Oberfläche)'
    );
  });

  it('gives nothing for a page of another role (forged), also with a valid looking block', async () => {
    modelText = `Ok.\n${block({
      tool: 'fill_form',
      form: 'review_feedback',
      fields: { feedback: 'Gut' },
    })}`;
    const { mod } = await load();
    const res = await mod.POST(
      post({
        stream: false,
        message: 'Trag bitte das Feedback in das Feld ein',
        context: {
          page: {
            path: '/trainer/reviews',
            kind: 'trainer_reviews',
            title: 'Prüfungen',
            ids: [],
            visibleLabels: [],
          },
        },
      })
    );
    const body = await res.json();
    expect(body.uiAction).toBeUndefined();
    expect(String(model.mock.calls[0][0])).not.toContain('review_feedback');
  });

  it('gives no form tool without the page context (switch HAI_PAGE_CONTEXT off)', async () => {
    process.env.HAI_PAGE_CONTEXT = 'off';
    const { mod } = await load();
    const res = await mod.POST(post({ stream: false }));
    const body = await res.json();
    expect(body.uiAction).toBeUndefined();
    expect(String(model.mock.calls[0][0])).not.toContain('profile_name');
  });

  it('takes nothing from the request body: a uiAction in the request is ignored', async () => {
    modelText = 'Eine normale Antwort';
    const { mod } = await load();
    const res = await mod.POST(
      post({
        stream: false,
        message: 'Was ist ein Primärschlüssel?',
        uiAction: { tool: 'fill_form', form: 'profile_name' },
        context: { page: profilePage, uiAction: { tool: 'fill_form' } },
      })
    );
    const body = await res.json();
    expect(body.uiAction).toBeUndefined();
  });
});
