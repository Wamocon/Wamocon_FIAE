// The client of the Sokrates stage (docs/ki-upload-konzept.md 6.3, 9.1 T5, T11, T20).
//
// One job: send one chat completion request to Sokrates and hand back the text of
// the answer. What it does NOT do, on purpose:
//
//   - no fallback to another provider, no provider chain (the chat of the HAI has
//     one, this client must not)
//   - no retries inside a call (a retry is a later step of the queue, with a delay)
//   - no redirects (`redirect: 'error'`): an answer from another address is an error
//   - no logging of any kind: not the key, not the request, not the answer
//
// What it does, before every call and without trusting the caller:
//
//   - the address is checked against the policy again (https, positive list of
//     hosts), so a bug in the caller cannot send an excerpt to another host
//   - the call has a hard time limit that also covers reading the answer
//   - the answer is read with a size limit and stops as soon as it is passed
//   - the key goes into the Authorization header and nowhere else
//
// The result is data, never an exception for an expected failure: the caller
// records the kind of failure and decides what to do (retry, give up).

import type { KiPolicy, KiTarget } from '@/lib/content-upload/ki/config';

export type KiFailureKind =
  | 'timeout'
  | 'http_error'
  | 'network'
  | 'too_large'
  | 'bad_response';

export type KiCallResult =
  | {
      ok: true;
      /** The text of the first choice, cut to maxTextChars. */
      text: string;
      httpStatus: number;
      latencyMs: number;
      promptTokens: number | null;
      completionTokens: number | null;
    }
  | {
      ok: false;
      kind: KiFailureKind;
      /** Set for http_error. */
      httpStatus: number | null;
      latencyMs: number;
      /** A later try may help (timeout, network, 429, 5xx). */
      retryable: boolean;
    };

export interface KiCallInput {
  system: string;
  user: string;
}

export interface KiClientOptions {
  target: KiTarget;
  policy: KiPolicy;
  /** Only for the Authorization header. */
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxResponseBytes: number;
  maxTokens: number;
  /** Replaced in the tests. */
  fetchImpl?: typeof fetch;
  /** Replaced in the tests. */
  now?: () => number;
}

export interface KiClient {
  readonly model: string;
  readonly host: string;
  call(input: KiCallInput): Promise<KiCallResult>;
}

/** Longest text of an answer that is handed on (the schema needs a few hundred). */
export const MAX_TEXT_CHARS = 4000;
/** The request body is cut at this size: an excerpt is at most 2500 characters. */
export const MAX_REQUEST_CHARS = 16_000;

/** Thrown for a bug of the caller (a target that the policy does not allow). */
export class KiPolicyError extends Error {
  constructor(readonly code: 'PROTOCOL' | 'HOST') {
    super(`The target is not allowed (${code})`);
    this.name = 'KiPolicyError';
  }
}

/** The check made right before a call. Throws KiPolicyError. */
export function assertTarget(target: KiTarget, policy: KiPolicy): URL {
  let url: URL;
  try {
    url = new URL(target.url);
  } catch {
    throw new KiPolicyError('PROTOCOL');
  }
  if (
    policy.requireHttps
      ? url.protocol !== 'https:'
      : !/^https?:$/.test(url.protocol)
  ) {
    throw new KiPolicyError('PROTOCOL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new KiPolicyError('PROTOCOL');
  }
  const host = url.host.toLowerCase();
  if (
    !policy.allowedHosts.includes(host) &&
    !policy.allowedHosts.includes(url.hostname.toLowerCase())
  ) {
    throw new KiPolicyError('HOST');
  }
  return url;
}

const isRetryable = (status: number) => status === 429 || status >= 500;

/** The error of fetch for a redirect it was told not to follow. */
function isRedirect(error: unknown): boolean {
  const cause = (error as { cause?: { message?: unknown } } | null)?.cause;
  const message = cause?.message ?? (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' && /redirect/i.test(message);
}

/** Reads a body up to a limit. Null when the limit is passed (the rest is dropped). */
async function readCapped(
  response: Response,
  maxBytes: number
): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(all);
}

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

/** The text and the token counts out of an OpenAI-shaped answer, or null. */
export function readAnswer(body: string): {
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
} | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  const content =
    typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>).content
      : undefined;
  if (typeof content !== 'string') return null;
  const usage =
    typeof record.usage === 'object' && record.usage !== null
      ? (record.usage as Record<string, unknown>)
      : {};
  return {
    text: content.slice(0, MAX_TEXT_CHARS),
    promptTokens: count(usage.prompt_tokens),
    completionTokens: count(usage.completion_tokens),
  };
}

function hostOf(address: string): string {
  try {
    return new URL(address).host.toLowerCase();
  } catch {
    return '';
  }
}

export function createKiClient(options: KiClientOptions): KiClient {
  const doFetch = options.fetchImpl ?? ((...args) => fetch(...args));
  const now = options.now ?? Date.now;

  return {
    model: options.model,
    // the host for the log comes from the address that is called, not from a claim
    host: hostOf(options.target.url),
    async call(input: KiCallInput): Promise<KiCallResult> {
      // The policy is checked on every call: nothing is sent to another host
      const url = assertTarget(options.target, options.policy);
      const started = now();
      const failure = (
        kind: KiFailureKind,
        httpStatus: number | null = null,
        retryable?: boolean
      ): KiCallResult => ({
        ok: false,
        kind,
        httpStatus,
        latencyMs: Math.max(0, now() - started),
        retryable:
          retryable ??
          (kind === 'timeout' ||
            kind === 'network' ||
            (kind === 'http_error' &&
              httpStatus !== null &&
              isRetryable(httpStatus))),
      });

      const body = JSON.stringify({
        model: options.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        max_tokens: options.maxTokens,
        temperature: 0,
        top_p: 1,
        stream: false,
      });
      if (body.length > MAX_REQUEST_CHARS) {
        // A request this large is a bug of the caller, and it is never sent
        throw new KiPolicyError('PROTOCOL');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        let response: Response;
        try {
          response = await doFetch(url.toString(), {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              authorization: `Bearer ${options.apiKey}`,
            },
            body,
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
          });
        } catch (error) {
          // A redirect, a refused connection, a failed lookup or the abort. The
          // text of the error is never kept (it may name the address), it only
          // tells a redirect, which a second try would meet again
          return failure(
            controller.signal.aborted ? 'timeout' : 'network',
            null,
            controller.signal.aborted ? true : !isRedirect(error)
          );
        }
        if (response.status < 200 || response.status > 299) {
          await response.body?.cancel().catch(() => undefined);
          return failure('http_error', response.status);
        }
        let text: string | null;
        try {
          text = await readCapped(response, options.maxResponseBytes);
        } catch {
          return failure(controller.signal.aborted ? 'timeout' : 'network');
        }
        if (text === null) return failure('too_large', response.status);
        const answer = readAnswer(text);
        if (!answer) return failure('bad_response', response.status);
        return {
          ok: true,
          ...answer,
          httpStatus: response.status,
          latencyMs: Math.max(0, now() - started),
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
