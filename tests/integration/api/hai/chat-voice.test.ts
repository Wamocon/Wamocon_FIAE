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
  const processMessageStream = jest.fn(async (..._args: unknown[]) => ({
    response: 'Antwort',
    intent: 'question',
    citations: [],
  }));
  jest.doMock('@/lib/hai', () => ({
    __esModule: true,
    processMessage,
    processMessageStream,
  }));
  jest.doMock('@/lib/hai/providers', () => ({
    __esModule: true,
    getProviderStatus: () => ({ primary: 'test' }),
  }));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const mod = (await import('@/app/api/hai/chat/route')) as any;
  return { mod, processMessage, processMessageStream, isVoiceAssistantEnabled };
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

  describe('the timing of a spoken question', () => {
    const doneEvent = (text: string) =>
      JSON.parse(
        text
          .split(String.fromCharCode(10))
          .filter(line => line.startsWith('data: '))
          .map(line => line.slice(6))
          .find(line => line.includes('"done"'))!
      );

    it('says the time before the stream in the Server-Timing header and all stages with the done event', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(async (...args: unknown[]) => {
        const context = args[1] as { timings?: Record<string, number> };
        const onChunk = args[2] as (text: string) => void;
        // the pipeline reports the search into the object the route handed over
        if (context.timings) context.timings.search = 42;
        onChunk('Hallo. ');
        return { response: 'Hallo.', intent: 'question', citations: [] };
      });
      const res = await mod.POST(post({ voice: true, stream: true }));
      expect(res.status).toBe(200);
      expect(res.headers.get('server-timing')).toMatch(
        /^auth;dur=\d+, prep;dur=\d+$/
      );
      const done = doneEvent(await res.text());
      // `context` is the time of the reads before the pipeline (history,
      // memory, occupation, phase plan), the route measures it for every turn
      expect(Object.keys(done.timing).sort()).toEqual(
        ['auth', 'context', 'first', 'prep', 'search', 'total'].sort()
      );
      expect(done.timing.search).toBe(42);
      // numbers only: no text, no id, no key
      for (const value of Object.values(done.timing)) {
        expect(typeof value).toBe('number');
      }
      expect(done.timing.total).toBeGreaterThanOrEqual(done.timing.first);
    });

    it('leaves out the first token when no text came', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(async () => ({
        response: '',
        intent: 'question',
        citations: [],
      }));
      const res = await mod.POST(post({ voice: true, stream: true }));
      const done = doneEvent(await res.text());
      expect(done.timing).not.toHaveProperty('first');
      expect(done.timing).toHaveProperty('total');
    });

    it('a typed question gets no timing at all, neither header nor event', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(async (...args: unknown[]) => {
        (args[2] as (text: string) => void)('Hallo. ');
        return { response: 'Hallo.', intent: 'question', citations: [] };
      });
      const res = await mod.POST(post({ stream: true }));
      expect(res.headers.get('server-timing')).toBeNull();
      const done = doneEvent(await res.text());
      expect(done).not.toHaveProperty('timing');
      // the stages are measured for the log line of the server (numbers only),
      // the client of a typed question never gets them
      const context = processMessageStream.mock.calls[0][1] as Record<
        string,
        unknown
      >;
      expect(typeof context.timings).toBe('object');
      expect(JSON.stringify(done)).not.toContain('context');
    });

    it('writes one log line with the stages of every turn (numbers and the intent only)', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(async (...args: unknown[]) => {
        const context = args[1] as { timings?: Record<string, number> };
        if (context.timings) {
          context.timings.retrieval = 1500;
          context.timings.data = 60;
        }
        (args[2] as (text: string) => void)('Hallo. ');
        return { response: 'Hallo.', intent: 'question', citations: [] };
      });
      const log = jest
        .spyOn(console, 'log')
        .mockImplementation(() => undefined);
      const res = await mod.POST(post({ stream: true }));
      await res.text();
      const line = log.mock.calls
        .map(args => String(args[0]))
        .find(text => text.startsWith('HAI.ai chat timing:'));
      log.mockRestore();
      expect(line).toBeDefined();
      expect(line).toMatch(/mode=stream intent=question auth=\d+ prep=\d+/);
      expect(line).toContain('retrieval=1500');
      expect(line).toContain('data=60');
      expect(line).toMatch(/total=\d+/);
    });
  });

  describe('the waiting stages (stageEvents)', () => {
    const events = (text: string) =>
      text
        .split(String.fromCharCode(10))
        .filter(line => line.startsWith('data: '))
        .map(line => JSON.parse(line.slice(6)));

    const answering = async (...args: unknown[]) => {
      const onChunk = args[2] as (text: string) => void;
      const onStage = args[3] as ((stage: string) => void) | undefined;
      onStage?.('search');
      onStage?.('answer');
      onChunk('Hallo. ');
      return { response: 'Hallo.', intent: 'question', citations: [] };
    };

    it('sends the stages as events when the client asks for them', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(answering);
      const res = await mod.POST(post({ stream: true, stageEvents: true }));
      const sent = events(await res.text());
      expect(sent.slice(0, 3)).toEqual([
        { stage: 'search' },
        { stage: 'answer' },
        { chunk: 'Hallo. ' },
      ]);
    });

    it('sends no stage to a client that did not ask (an early event would end its thinking text)', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(answering);
      const res = await mod.POST(post({ stream: true }));
      const sent = events(await res.text());
      expect(sent.some(event => 'stage' in event)).toBe(false);
      expect(sent[0]).toEqual({ chunk: 'Hallo. ' });
      expect(processMessageStream.mock.calls[0][3]).toBeUndefined();
    });

    it('says once that the server is busy when no first word comes in time', async () => {
      const { mod, processMessageStream } = await load(true);
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      processMessageStream.mockImplementation(async (...args: unknown[]) => {
        await gate;
        (args[2] as (text: string) => void)('Hallo. ');
        return { response: 'Hallo.', intent: 'question', citations: [] };
      });
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      try {
        const res = await mod.POST(post({ stream: true, stageEvents: true }));
        const reader = res.body!.getReader();
        // 12 seconds without a first word: the stage is sent, once
        jest.advanceTimersByTime(12_000);
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toBe(
          'data: {"stage":"busy"}' + String.fromCharCode(10, 10)
        );
        jest.advanceTimersByTime(60_000);
        release();
        let rest = '';
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          rest += new TextDecoder().decode(part.value);
        }
        expect(rest).toContain('"chunk":"Hallo. "');
        expect(rest.match(/"busy"/g)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('says nothing about a busy server when the first word came in time', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(answering);
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      try {
        const res = await mod.POST(post({ stream: true, stageEvents: true }));
        const text = await res.text();
        jest.advanceTimersByTime(60_000);
        expect(text).not.toContain('busy');
      } finally {
        jest.useRealTimers();
      }
    });

    it('only the value true counts', async () => {
      const { mod, processMessageStream } = await load(true);
      processMessageStream.mockImplementation(answering);
      const res = await mod.POST(post({ stream: true, stageEvents: 'yes' }));
      const sent = events(await res.text());
      expect(sent.some(event => 'stage' in event)).toBe(false);
    });
  });
});
