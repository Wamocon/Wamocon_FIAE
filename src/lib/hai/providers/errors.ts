/**
 * HAI.ai chat provider errors (package CF1)
 *
 * Two typed errors and one function for the log:
 *
 *   - ChatProviderError: one failed call of one provider, with a stable kind and
 *     an HTTP status. Its message never carries the body of a response, the
 *     address, a key or any content of the conversation.
 *   - ChatUnavailableError: no provider could answer. The caller shows a clear
 *     message to the user (key `hai.error.chatUnavailable`), it never switches
 *     silently to a provider that is not allowed.
 *   - describeChatFailure: a short, content free text for the log.
 *
 * @module lib/hai/providers/errors
 */

export type ChatFailureKind =
  | 'http'
  | 'empty'
  | 'network'
  | 'timeout'
  | 'invalid';

export class ChatProviderError extends Error {
  readonly kind: ChatFailureKind;
  readonly status?: number;

  constructor(kind: ChatFailureKind, message: string, status?: number) {
    super(message);
    this.name = 'ChatProviderError';
    this.kind = kind;
    this.status = status;
  }
}

/** Why there is no Sokrates fallback (or that there is one). Never a value of a variable. */
export type FallbackState =
  /** the fallback exists: Sokrates, key set, address on the positive list */
  | 'sokrates'
  /** HAI_CHAT_FALLBACK=none */
  | 'disabled'
  /** OPENAI_COMPATIBLE_API_KEY is not set (or cannot be a bearer token) */
  | 'no_key'
  /** the address of Sokrates is not https or not on the positive list of hosts */
  | 'target_rejected'
  /** the primary provider already is Sokrates, a second try would be the same call */
  | 'primary_is_sokrates';

export type ChatUnavailableReason =
  /** the primary failed and there is no fallback */
  | 'no_fallback'
  /** the primary failed and Sokrates failed too (or the primary was not ready) */
  | 'fallback_failed'
  /** a provider broke off after the first text was sent, a second answer would be glued on */
  | 'interrupted'
  /** no provider is ready at all (no key) */
  | 'no_provider';

/** The code a caller can test without importing the class. */
export const CHAT_UNAVAILABLE_CODE = 'HAI_CHAT_UNAVAILABLE';

/** The i18n key of the message for the user (src/locales/de.json, en.json). */
export const CHAT_UNAVAILABLE_I18N_KEY = 'hai.error.chatUnavailable';

export class ChatUnavailableError extends Error {
  readonly code = CHAT_UNAVAILABLE_CODE;
  readonly reason: ChatUnavailableReason;
  readonly fallback: FallbackState;
  /**
   * The last provider did not answer in time or said it is overloaded (see
   * isModelBusyError). The caller then tells the person the truth (the model is
   * busy, try again in a minute) instead of "not reachable".
   */
  readonly modelBusy: boolean;

  constructor(
    reason: ChatUnavailableReason,
    fallback: FallbackState,
    detail = '',
    modelBusy = false
  ) {
    super(
      `HAI.ai: chat unavailable (${reason}, fallback ${fallback})` +
        (detail ? `. ${detail}` : '')
    );
    this.name = 'ChatUnavailableError';
    this.reason = reason;
    this.fallback = fallback;
    this.modelBusy = modelBusy;
  }
}

/** The code the client tests: the model is busy or too slow, a retry may work. */
export const MODEL_BUSY_CODE = 'MODEL_BUSY';

/** The i18n key of the message for the user (src/locales/de.json, en.json). */
export const MODEL_BUSY_I18N_KEY = 'hai.error.modelBusy';

/** What the client is told about when to try again (seconds, a hint only). */
export const MODEL_BUSY_RETRY_AFTER_SEC = 30;

/** HTTP statuses that mean "too many requests" or "the gateway waited too long". */
const MODEL_BUSY_STATUSES: ReadonlySet<number> = new Set([
  429, 502, 503, 504, 524,
]);

/**
 * Whether a failure of a chat provider means "busy or too slow" and not "wrong
 * setup": a time limit (the model server queues requests), 429, 502, 503, 504 or
 * 524. A key that is refused (401, 403), a bad request (400) or an empty answer
 * is a different thing and keeps the general message. Reads only the kind, the
 * name and the status, never a message (it could carry parts of the request).
 */
export function isModelBusyError(error: unknown): boolean {
  if (error instanceof ChatProviderError) {
    if (error.kind === 'timeout') return true;
    return (
      error.kind === 'http' &&
      error.status !== undefined &&
      MODEL_BUSY_STATUSES.has(error.status)
    );
  }
  if (typeof error === 'object' && error !== null) {
    const e = error as { name?: unknown; status?: unknown; code?: unknown };
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    const status = typeof e.status === 'number' ? e.status : e.code;
    return typeof status === 'number' && MODEL_BUSY_STATUSES.has(status);
  }
  return false;
}

/** The body fields the client reads for a busy model (no internals, no names). */
export function modelBusyPayload(): {
  code: typeof MODEL_BUSY_CODE;
  retryAfterSec: number;
} {
  return { code: MODEL_BUSY_CODE, retryAfterSec: MODEL_BUSY_RETRY_AFTER_SEC };
}

export function isChatUnavailableError(
  error: unknown
): error is ChatUnavailableError {
  return (
    error instanceof ChatUnavailableError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === CHAT_UNAVAILABLE_CODE)
  );
}

/**
 * A short text for the log that says what kind of failure it was and nothing
 * else: the message of a provider can carry parts of the request or the answer,
 * so it is never used.
 */
export function describeChatFailure(error: unknown): string {
  if (error instanceof ChatProviderError) {
    return error.status !== undefined
      ? `${error.kind} status=${error.status}`
      : error.kind;
  }
  if (typeof error === 'object' && error !== null) {
    const e = error as { name?: unknown; status?: unknown; code?: unknown };
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'timeout';
    const status = typeof e.status === 'number' ? e.status : e.code;
    if (typeof status === 'number' && status >= 100 && status <= 599) {
      return `status=${status}`;
    }
    if (
      typeof e.name === 'string' &&
      /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(e.name)
    ) {
      return e.name;
    }
  }
  return 'error';
}
