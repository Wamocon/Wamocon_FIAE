// A stand-in for Sokrates on localhost for the tests of the model stage. No real
// model, no connection to any other host: the server answers whatever the test
// tells it to, and records what it was sent (so a test can prove what left the
// platform and what did not).

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { KiConfig } from '@/lib/content-upload/ki/config';
import { DEFAULT_LIMITS } from '@/lib/content-upload/ki/config';

export interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  raw: string;
  /** The parsed JSON body, or null. */
  body: {
    model?: string;
    messages?: { role: string; content: string }[];
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
  } | null;
}

export type Handler = (
  seen: Seen,
  res: http.ServerResponse
) => void | Promise<void>;

export interface FakeSokrates {
  /** The base url, as the variable of the chat would hold it (…/api). */
  url: string;
  port: number;
  requests: Seen[];
  setHandler(handler: Handler): void;
  close(): Promise<void>;
}

/** An answer in the shape of an OpenAI chat completion. */
export function completion(
  content: string,
  usage: { prompt_tokens: number; completion_tokens: number } = {
    prompt_tokens: 120,
    completion_tokens: 40,
  }
): string {
  return JSON.stringify({
    id: 'fake',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage,
  });
}

export function reply(
  res: http.ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {}
) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body);
}

/** A handler that answers 200 with the JSON the function returns (an object or a text). */
export function answers(
  make: (seen: Seen, index: number) => object | string
): Handler {
  let index = 0;
  return (seen, res) => {
    const value = make(seen, index++);
    reply(
      res,
      200,
      completion(typeof value === 'string' ? value : JSON.stringify(value))
    );
  };
}

export async function startFakeSokrates(
  handler: Handler = answers(() => ({
    typ: 'unbekannt',
    komponente: null,
    enabler: null,
    stufe: null,
    konfidenz: 0,
    begruendung: '',
  }))
): Promise<FakeSokrates> {
  let current = handler;
  const requests: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Seen['body'] = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      const seen: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        raw,
        body,
      };
      requests.push(seen);
      Promise.resolve(current(seen, res)).catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/api`,
    port,
    requests,
    setHandler(next) {
      current = next;
    },
    close: () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * The configuration for a test against a local server: plain http and the host
 * 127.0.0.1 are allowed ONLY here. The configuration of the app can not be made
 * like this (loadKiConfig always demands https and the positive list).
 */
export function localConfig(
  fake: Pick<FakeSokrates, 'url'>,
  overrides: Partial<KiConfig['limits']> = {},
  extra: Partial<Pick<KiConfig, 'apiKey' | 'model'>> = {}
): KiConfig {
  return {
    target: {
      url: `${fake.url}/chat/completions`,
      host: new URL(fake.url).host,
    },
    policy: { requireHttps: false, allowedHosts: ['127.0.0.1'] },
    apiKey: extra.apiKey ?? 'test-key-NOT-A-SECRET',
    model: extra.model ?? 'test-model',
    limits: { ...DEFAULT_LIMITS, timeoutMs: 2000, ...overrides },
  };
}
