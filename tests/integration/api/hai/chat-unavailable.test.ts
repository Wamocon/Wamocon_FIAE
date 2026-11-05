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

// Chat route (package CF1): when the pipeline reports that no chat provider
// could answer (errorKey), the user gets a clear message with the key
// hai.error.chatUnavailable. It is not stored as an answer of the assistant, in
// the streaming and in the blocking path. The pipeline is replaced.

const ME = 'me-1';
const KEY = 'hai.error.chatUnavailable';

const unavailable = {
  response: '',
  intent: 'question',
  citations: [],
  error: 'chat_unavailable',
  errorKey: KEY,
};

async function load(result: Record<string, unknown>) {
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
  jest.doMock('@/lib/hai', () => ({
    __esModule: true,
    processMessage: jest.fn(async () => result),
    processMessageStream: jest.fn(async () => result),
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getProviderStatus: () => ({ primary: 'test' }),
  }));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const mod = (await import('@/app/api/hai/chat/route')) as any;
  return { mod, rec };
}

const post = (stream: boolean, language?: string) =>
  makeRequest('POST', 'http://localhost/api/hai/chat', {
    token: 't',
    headers: language ? { 'x-language': language } : undefined,
    body: { message: 'Was ist Normalisierung?', context: {}, stream },
  } as never);

const messageInserts = (rec: any) =>
  rec.writes('insert', 'hai_chat_messages') as Array<Record<string, unknown>>;

describe('HAI chat route: no chat provider can answer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('streaming: sends the key as the error event and then the end event, stores no answer', async () => {
    const { mod, rec } = await load(unavailable);
    const res = await mod.POST(post(true));
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = text
      .split('\n')
      .filter((l: string) => l.startsWith('data: '))
      .map((l: string) => JSON.parse(l.slice(6)));

    expect(events.some((e: any) => e.error === KEY)).toBe(true);
    const done = events.find((e: any) => e.done);
    expect(done).toBeDefined();
    expect(typeof done.sessionId).toBe('string');
    // no text chunk that looks like an answer
    expect(events.some((e: any) => typeof e.chunk === 'string')).toBe(false);
    // only the message of the user was stored
    const roles = messageInserts(rec).map(m => m.role);
    expect(roles).toEqual(['user']);
  });

  it('blocking: status 503 with the key and a text in the language of the request', async () => {
    const { mod, rec } = await load(unavailable);
    const de = await mod.POST(post(false, 'de'));
    expect(de.status).toBe(503);
    const deBody = await de.json();
    expect(deBody.errorKey).toBe(KEY);
    expect(deBody.error).toContain('nicht erreichbar');
    expect(deBody.response).toBeUndefined();
    expect(messageInserts(rec).map(m => m.role)).toEqual(['user']);

    const { mod: modEn } = await load(unavailable);
    const en = await modEn.POST(post(false, 'en'));
    expect(en.status).toBe(503);
    expect((await en.json()).error).toContain('not reachable');
  });

  describe('a busy model (MODEL_BUSY)', () => {
    const busy = {
      response: '',
      intent: 'question',
      citations: [],
      error: 'model_busy',
      errorKey: 'hai.error.modelBusy',
      errorCode: 'MODEL_BUSY',
      retryAfterSec: 30,
    };

    it('streaming: the error event carries the key, the code and the seconds, then the end event', async () => {
      const { mod, rec } = await load(busy);
      const res = await mod.POST(post(true));
      expect(res.status).toBe(200);
      const events = (await res.text())
        .split('\n')
        .filter((l: string) => l.startsWith('data: '))
        .map((l: string) => JSON.parse(l.slice(6)));

      const error = events.find((e: any) => e.error);
      expect(error).toEqual({
        error: 'hai.error.modelBusy',
        code: 'MODEL_BUSY',
        retryAfterSec: 30,
      });
      expect(events.some((e: any) => e.done)).toBe(true);
      expect(events.some((e: any) => typeof e.chunk === 'string')).toBe(false);
      expect(messageInserts(rec).map(m => m.role)).toEqual(['user']);
    });

    it('streaming: the plain unavailable error has no code', async () => {
      const { mod } = await load(unavailable);
      const res = await mod.POST(post(true));
      const events = (await res.text())
        .split('\n')
        .filter((l: string) => l.startsWith('data: '))
        .map((l: string) => JSON.parse(l.slice(6)));
      const error = events.find((e: any) => e.error);
      expect(error).toEqual({ error: KEY });
    });

    it('blocking: status 503 with the code, the seconds, Retry-After and a text in the language of the request', async () => {
      const { mod, rec } = await load(busy);
      const de = await mod.POST(post(false, 'de'));
      expect(de.status).toBe(503);
      expect(de.headers.get('Retry-After')).toBe('30');
      const deBody = await de.json();
      expect(deBody.code).toBe('MODEL_BUSY');
      expect(deBody.retryAfterSec).toBe(30);
      expect(deBody.errorKey).toBe('hai.error.modelBusy');
      expect(deBody.error).toContain('stark ausgelastet');
      expect(deBody.response).toBeUndefined();
      expect(messageInserts(rec).map(m => m.role)).toEqual(['user']);

      const { mod: modEn } = await load(busy);
      const en = await modEn.POST(post(false, 'en'));
      expect(en.status).toBe(503);
      expect((await en.json()).error).toContain('very busy');
    });

    it('nothing internal is in the answer: no provider, no address, no stack', async () => {
      const { mod } = await load(busy);
      const stream = await (await mod.POST(post(true))).text();
      const { mod: mod2 } = await load(busy);
      const json = JSON.stringify(await (await mod2.POST(post(false))).json());
      for (const text of [stream, json]) {
        expect(text).not.toMatch(
          /openai|sokrates|gemini|https?:\/\/|timeout|stack|ChatUnavailable/i
        );
      }
    });
  });

  it('an ordinary answer is unchanged: stored and returned', async () => {
    const { mod, rec } = await load({
      response: 'Antwort',
      intent: 'question',
      citations: [],
    });
    const res = await mod.POST(post(false));
    expect(res.status).toBe(200);
    expect((await res.json()).response).toBe('Antwort');
    expect(messageInserts(rec).map(m => m.role)).toEqual(['user', 'assistant']);
  });
});
