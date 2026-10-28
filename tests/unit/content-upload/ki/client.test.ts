/**
 * @jest-environment node
 */
// The client of the Sokrates stage against a stand-in server on localhost: what
// leaves, what is refused before anything leaves, and what happens when the server
// misbehaves. No real model and no other host is ever contacted.
import {
  KiPolicyError,
  assertTarget,
  createKiClient,
  readAnswer,
} from '@/lib/content-upload/ki/client';
import {
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_LIMITS,
} from '@/lib/content-upload/ki/config';
import {
  answers,
  completion,
  localConfig,
  reply,
  startFakeSokrates,
  type FakeSokrates,
} from '../../../helpers/fakeSokrates';

let fake: FakeSokrates;
beforeEach(async () => {
  fake = await startFakeSokrates();
});
afterEach(async () => {
  await fake.close();
});

function clientFor(
  overrides: Parameters<typeof localConfig>[1] = {},
  extra: Parameters<typeof localConfig>[2] = {}
) {
  const config = localConfig(fake, overrides, extra);
  return {
    config,
    client: createKiClient({
      target: config.target,
      policy: config.policy,
      apiKey: config.apiKey,
      model: config.model,
      timeoutMs: config.limits.timeoutMs,
      maxResponseBytes: config.limits.maxResponseBytes,
      maxTokens: config.limits.maxTokens,
      reasoningEffort: config.reasoningEffort,
    }),
  };
}

const INPUT = { system: 'SYSTEM TEXT', user: 'USER TEXT' };

describe('a successful call', () => {
  it('sends one request with the fixed parameters and hands back the text', async () => {
    fake.setHandler(answers(() => '{"typ":"quiz"}'));
    const { client } = clientFor();
    const result = await client.call(INPUT);
    expect(result).toMatchObject({
      ok: true,
      text: '{"typ":"quiz"}',
      httpStatus: 200,
      promptTokens: 120,
      completionTokens: 40,
    });
    expect(fake.requests).toHaveLength(1);
    const [seen] = fake.requests;
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/api/chat/completions');
    expect(seen.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'SYSTEM TEXT' },
        { role: 'user', content: 'USER TEXT' },
      ],
      max_tokens: 400,
      reasoning_effort: 'none',
      temperature: 0,
      top_p: 1,
      stream: false,
    });
  });

  it('sends the reasoning effort of the configuration, none by default', async () => {
    const { client } = clientFor({}, { reasoningEffort: 'low' });
    await client.call(INPUT);
    expect(fake.requests[0].body?.reasoning_effort).toBe('low');
  });

  it('puts the key into the Authorization header and nowhere else', async () => {
    const { client } = clientFor({}, { apiKey: 'KEY-ABC-123' });
    await client.call(INPUT);
    const [seen] = fake.requests;
    expect(seen.headers.authorization).toBe('Bearer KEY-ABC-123');
    expect(seen.raw).not.toContain('KEY-ABC-123');
    expect(seen.url).not.toContain('KEY-ABC-123');
    const others = Object.entries(seen.headers).filter(
      ([name]) => name !== 'authorization'
    );
    expect(JSON.stringify(others)).not.toContain('KEY-ABC-123');
  });

  it('does not log anything, whatever happens', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      level => jest.spyOn(console, level).mockImplementation(() => undefined)
    );
    try {
      const { client } = clientFor({}, { apiKey: 'KEY-LOG-PROBE' });
      await client.call(INPUT);
      fake.setHandler((_s, res) => reply(res, 500, 'KEY-LOG-PROBE boom'));
      await client.call(INPUT);
      fake.setHandler((_s, res) => reply(res, 200, 'not json'));
      await client.call(INPUT);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('an answer that cannot be used', () => {
  it('reports a server error as http_error and says whether a retry may help', async () => {
    for (const [status, retryable] of [
      [500, true],
      [502, true],
      [503, true],
      [429, true],
      [400, false],
      [401, false],
      [403, false],
      [404, false],
    ] as const) {
      fake.setHandler((_s, res) => reply(res, status, '{"error":"x"}'));
      const { client } = clientFor();
      const result = await client.call(INPUT);
      expect(result).toMatchObject({
        ok: false,
        kind: 'http_error',
        httpStatus: status,
        retryable,
      });
    }
  });

  it.each([
    ['not json at all', 'not json'],
    ['json without choices', '{"hello":1}'],
    ['choices that are not a list', '{"choices":"x"}'],
    ['a choice without a message', '{"choices":[{}]}'],
    [
      'a message whose content is not text',
      '{"choices":[{"message":{"content":5}}]}',
    ],
    ['an empty body', ''],
  ])(
    'reports %s as bad_response, never as an exception',
    async (_name, body) => {
      fake.setHandler((_s, res) => reply(res, 200, body));
      const { client } = clientFor();
      expect(await client.call(INPUT)).toMatchObject({
        ok: false,
        kind: 'bad_response',
        retryable: false,
      });
    }
  );

  it.each([
    ['an empty content', '', 'stop'],
    ['a content of blanks only', ' \n\t ', 'stop'],
    ['an empty content cut by the token limit', '', 'length'],
    ['a content that is null', null, 'length'],
  ])(
    'reports %s as empty and retryable, never as a proposal',
    async (_name, content, finish) => {
      fake.setHandler((_s, res) =>
        reply(
          res,
          200,
          JSON.stringify({
            choices: [
              {
                index: 0,
                finish_reason: finish,
                message: { role: 'assistant', content },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 400 },
          })
        )
      );
      const { client } = clientFor();
      expect(await client.call(INPUT)).toMatchObject({
        ok: false,
        kind: 'empty',
        retryable: true,
      });
    }
  );

  it('never reads, hands on or logs the reasoning of the model', async () => {
    const THOUGHT = 'GEDANKE-NICHT-WEITERGEBEN-4711';
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
      level => jest.spyOn(console, level).mockImplementation(() => undefined)
    );
    try {
      const { client } = clientFor();
      // reasoning next to a usable content: only the content is handed on
      fake.setHandler((_s, res) =>
        reply(
          res,
          200,
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: '{"typ":"quiz"}',
                  reasoning: THOUGHT,
                  reasoning_content: THOUGHT,
                },
              },
            ],
          })
        )
      );
      const withContent = await client.call(INPUT);
      expect(withContent).toMatchObject({ ok: true, text: '{"typ":"quiz"}' });
      expect(JSON.stringify(withContent)).not.toContain(THOUGHT);

      // reasoning and nothing else: an empty answer, the reasoning is no substitute
      fake.setHandler((_s, res) =>
        reply(
          res,
          200,
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: {
                  role: 'assistant',
                  content: '',
                  reasoning: `{"typ":"quiz","komponente":"K1"} ${THOUGHT}`,
                  reasoning_content: THOUGHT,
                },
              },
            ],
          })
        )
      );
      const onlyReasoning = await client.call(INPUT);
      expect(onlyReasoning).toMatchObject({ ok: false, kind: 'empty' });
      expect(JSON.stringify(onlyReasoning)).not.toContain(THOUGHT);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(
      readAnswer(
        JSON.stringify({
          choices: [{ message: { content: 'x', reasoning: THOUGHT } }],
        })
      )
    ).toEqual({ text: 'x', promptTokens: null, completionTokens: null });
  });

  it('stops reading an answer that is too large, by header and by stream', async () => {
    const big = 'x'.repeat(64 * 1024);
    fake.setHandler((_s, res) => reply(res, 200, completion(big)));
    const { client } = clientFor({ maxResponseBytes: 8 * 1024 });
    expect(await client.call(INPUT)).toMatchObject({
      ok: false,
      kind: 'too_large',
      retryable: false,
    });

    // no Content-Length: a chunked stream that never ends
    let sent = 0;
    fake.setHandler((_s, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      const timer = setInterval(() => {
        if (res.destroyed || sent > 5_000_000) {
          clearInterval(timer);
          res.end();
          return;
        }
        sent += 1024;
        res.write('x'.repeat(1024));
      }, 1);
      res.on('close', () => clearInterval(timer));
    });
    expect(await client.call(INPUT)).toMatchObject({
      ok: false,
      kind: 'too_large',
    });
    // it stopped long before the server was done
    expect(sent).toBeLessThan(1_000_000);
  });

  it('cuts the text of the answer that it hands on', async () => {
    fake.setHandler(answers(() => 'y'.repeat(20_000)));
    const { client } = clientFor({ maxResponseBytes: 64 * 1024 });
    const result = await client.call(INPUT);
    expect(result.ok && result.text.length).toBe(4000);
  });
});

describe('a server that is slow or gone', () => {
  it('gives up after the time limit, also when the answer starts and never ends', async () => {
    fake.setHandler(() => undefined); // never answers
    const { client } = clientFor({ timeoutMs: 150 });
    const started = Date.now();
    expect(await client.call(INPUT)).toMatchObject({
      ok: false,
      kind: 'timeout',
      retryable: true,
    });
    expect(Date.now() - started).toBeLessThan(2000);

    fake.setHandler((_s, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"choices":'); // and then nothing
    });
    expect(await client.call(INPUT)).toMatchObject({
      ok: false,
      kind: 'timeout',
    });
  });

  it('uses a time limit of 30 seconds by default, to the millisecond', async () => {
    expect(DEFAULT_LIMITS.timeoutMs).toBe(30_000);
    jest.useFakeTimers();
    try {
      let seenSignal: AbortSignal | undefined;
      const hang = ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          seenSignal = init.signal as AbortSignal;
          seenSignal.addEventListener('abort', () => reject(new Error('x')));
        })) as unknown as typeof fetch;
      const config = localConfig(fake, { timeoutMs: DEFAULT_LIMITS.timeoutMs });
      const client = createKiClient({
        target: config.target,
        policy: config.policy,
        apiKey: config.apiKey,
        model: config.model,
        timeoutMs: config.limits.timeoutMs,
        maxResponseBytes: config.limits.maxResponseBytes,
        maxTokens: config.limits.maxTokens,
        reasoningEffort: config.reasoningEffort,
        fetchImpl: hang,
      });
      const pending = client.call(INPUT);
      await jest.advanceTimersByTimeAsync(29_999);
      expect(seenSignal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(seenSignal?.aborted).toBe(true);
      expect(await pending).toMatchObject({
        ok: false,
        kind: 'timeout',
        retryable: true,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports a refused connection as network, retryable', async () => {
    const { client } = clientFor();
    await fake.close();
    expect(await client.call(INPUT)).toMatchObject({
      ok: false,
      kind: 'network',
      retryable: true,
    });
    fake = await startFakeSokrates();
  });
});

describe('redirects', () => {
  it('never follows one: the second server is not contacted and nothing is read from it', async () => {
    const elsewhere = await startFakeSokrates(answers(() => '{"typ":"quiz"}'));
    try {
      fake.setHandler((_s, res) => {
        res.writeHead(302, { location: `${elsewhere.url}/chat/completions` });
        res.end();
      });
      const { client } = clientFor();
      const result = await client.call(INPUT);
      expect(result).toMatchObject({ ok: false, retryable: false });
      expect(elsewhere.requests).toHaveLength(0);
      // 307 and 308 would repeat the POST with the body: also refused
      for (const status of [301, 303, 307, 308]) {
        fake.setHandler((_s, res) => {
          res.writeHead(status, {
            location: `${elsewhere.url}/chat/completions`,
          });
          res.end();
        });
        expect((await client.call(INPUT)).ok).toBe(false);
      }
      expect(elsewhere.requests).toHaveLength(0);
    } finally {
      await elsewhere.close();
    }
  });
});

describe('the policy is checked before anything is sent', () => {
  const fetchSpy = jest.fn();
  beforeEach(() => fetchSpy.mockReset());

  const make = (url: string, policy: Parameters<typeof assertTarget>[1]) =>
    createKiClient({
      target: { url, host: 'declared.example' },
      policy,
      apiKey: 'k',
      model: 'm',
      timeoutMs: 1000,
      maxResponseBytes: 1000,
      maxTokens: 10,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });
  const production = {
    requireHttps: true,
    allowedHosts: DEFAULT_ALLOWED_HOSTS,
  };

  it('refuses http and a foreign host without a single call of fetch', async () => {
    const refused = [
      'http://sokrates.test-qualitaetsmanagement.com/api/chat/completions',
      'https://api.openai.com/v1/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/chat',
      'https://sokrates.test-qualitaetsmanagement.com.evil.example/api/chat/completions',
      'https://u:p@sokrates.test-qualitaetsmanagement.com/api/chat/completions',
      'https://sokrates.test-qualitaetsmanagement.com/api/chat/completions?x=1',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
    ];
    for (const url of refused) {
      await expect(make(url, production).call(INPUT)).rejects.toBeInstanceOf(
        KiPolicyError
      );
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a local server unless the policy of a test says otherwise', async () => {
    await expect(
      make(`${fake.url}/chat/completions`, production).call(INPUT)
    ).rejects.toBeInstanceOf(KiPolicyError);
    expect(fake.requests).toHaveLength(0);
    expect(() =>
      assertTarget(
        { url: `${fake.url}/chat/completions`, host: 'x' },
        { requireHttps: false, allowedHosts: ['127.0.0.1'] }
      )
    ).not.toThrow();
  });

  it('refuses a request body that is larger than any excerpt can make it', async () => {
    const { client } = clientFor();
    await expect(
      client.call({ system: 'a', user: 'b'.repeat(20_000) })
    ).rejects.toBeInstanceOf(KiPolicyError);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('readAnswer', () => {
  it('reads the first choice and the token counts, and ignores bad counts', () => {
    expect(
      readAnswer(
        '{"choices":[{"message":{"content":"hi"}},{"message":{"content":"no"}}],"usage":{"prompt_tokens":-1,"completion_tokens":2.5}}'
      )
    ).toEqual({ text: 'hi', promptTokens: null, completionTokens: null });
    expect(readAnswer('{"choices":[{"message":{"content":""}}]}')).toEqual({
      empty: true,
    });
    expect(readAnswer('null')).toBeNull();
    expect(readAnswer('[]')).toBeNull();
  });
});
