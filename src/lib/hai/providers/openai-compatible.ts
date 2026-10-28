/**
 * HAI.ai Generic OpenAI-Compatible Provider
 *
 * Works with any OpenAI-compatible chat-completions endpoint. In production it
 * talks to Sokrates (Open WebUI in front of Ollama), the own AI, and is the only
 * fallback of the chat (package CF1).
 * Configured via environment variables:
 *   - OPENAI_COMPATIBLE_BASE_URL (default: Sokrates test endpoint)
 *   - OPENAI_COMPATIBLE_API_KEY
 *   - OPENAI_COMPATIBLE_MODEL (default: gpt-4o-mini, recommended: sokrates-fast)
 *
 * No model fallback chain — the configured model is used exclusively.
 * No provider-specific headers (HTTP-Referer, X-Title) are sent.
 *
 * Reasoning is off: every request carries `reasoning_effort: "none"`. The models
 * behind Sokrates think by default and spend the whole token limit on it, the
 * answer comes back empty (docs/kfbm-upload-runbook.md, 11.7). An empty answer is
 * an error, never a blank message. The fields `reasoning` and
 * `reasoning_content` of a response are never read.
 *
 * Time limits: a blocking call has one limit for the whole call. A stream is not
 * cut by the length of the answer: the limit counts until the first byte
 * (generous, the first call of a model that is not loaded yet takes 8 to 10
 * seconds) and then the pause between two chunks.
 *
 * Nothing of the conversation is logged: errors and log lines carry the HTTP
 * status, a short error code of the server and a kind, never a body, an address
 * with a query, a key or a text.
 *
 * @module lib/hai/providers/openai-compatible
 */

import { ChatProviderError } from './errors';
import type {
  ChatProvider,
  ChatMessage,
  ChatGenerateOptions,
  ChatResponse,
} from './types';

/** A blocking call, the whole call. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** A stream, until the first byte (the model may have to be loaded first). */
export const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 45_000;
/** A stream, the pause between two chunks. */
export const DEFAULT_IDLE_TIMEOUT_MS = 30_000;

/** Sent with every request: thinking models answer empty otherwise. */
export const REASONING_EFFORT = 'none';

export interface OpenAICompatibleTimeouts {
  requestTimeoutMs: number;
  firstByteTimeoutMs: number;
  idleTimeoutMs: number;
}

/** One abort signal with a timer that can be moved, and a flag that says it fired. */
class Watchdog {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  timedOut = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  arm(ms: number): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort();
    }, ms);
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** A short code of the server (`invalid_request_error`), or null. Never free text. */
function safeErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      error?: { type?: unknown; code?: unknown };
    };
    for (const value of [parsed?.error?.type, parsed?.error?.code]) {
      if (typeof value === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(value)) {
        return value;
      }
    }
  } catch {
    // not JSON
  }
  return null;
}

function safeToken(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z_]{1,30}$/.test(value)
    ? value
    : 'unknown';
}

export class OpenAICompatibleChatProvider implements ChatProvider {
  readonly name = 'openai-compatible';
  private apiKey: string | null = null;
  private baseUrl: string;
  private modelName: string;
  private timeouts: OpenAICompatibleTimeouts;

  constructor(
    baseUrl: string,
    apiKey: string | undefined,
    modelName: string = 'gpt-4o-mini',
    timeouts: Partial<OpenAICompatibleTimeouts> = {}
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.modelName = modelName;
    this.timeouts = {
      requestTimeoutMs: timeouts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      firstByteTimeoutMs:
        timeouts.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS,
      idleTimeoutMs: timeouts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    };

    if (apiKey) {
      this.apiKey = apiKey;
    } else {
      console.warn(
        'HAI.ai [openai-compatible]: No API key provided (OPENAI_COMPATIBLE_API_KEY)'
      );
    }
  }

  isInitialized(): boolean {
    return this.apiKey !== null && this.baseUrl.length > 0;
  }

  private getApiUrl(): string {
    // Sokrates exposes the chat endpoint at /api/chat/completions.
    // The baseUrl already includes the /api prefix.
    return `${this.baseUrl}/chat/completions`;
  }

  private buildMessages(
    systemPrompt: string,
    messages: ChatMessage[],
    userMessage: string
  ): Array<{ role: string; content: string }> {
    return [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userMessage },
    ];
  }

  private buildBody(
    systemPrompt: string,
    messages: ChatMessage[],
    userMessage: string,
    options: ChatGenerateOptions,
    stream: boolean
  ) {
    return {
      model: this.modelName,
      messages: this.buildMessages(systemPrompt, messages, userMessage),
      max_tokens: options.maxOutputTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 0.9,
      reasoning_effort: REASONING_EFFORT,
      ...(options.stopSequences?.length ? { stop: options.stopSequences } : {}),
      stream,
    };
  }

  /** A failure of the connection or of the time limit, without the message of fetch. */
  private connectionError(watchdog: Watchdog, what: string): ChatProviderError {
    if (watchdog.timedOut) {
      console.error(`HAI.ai [openai-compatible]: ${what} timed out`);
      return new ChatProviderError(
        'timeout',
        `OpenAI-compatible API ${what} timed out`
      );
    }
    console.error(`HAI.ai [openai-compatible]: ${what} failed (network)`);
    return new ChatProviderError(
      'network',
      `OpenAI-compatible API ${what} failed`
    );
  }

  private httpError(status: number, body: string): ChatProviderError {
    const code = safeErrorCode(body);
    console.error(
      `HAI.ai [openai-compatible]: API error status=${status}` +
        (code ? ` code=${code}` : '')
    );
    return new ChatProviderError(
      'http',
      `OpenAI-compatible API error: ${status}`,
      status
    );
  }

  private emptyError(finishReason: unknown): ChatProviderError {
    console.warn(
      `HAI.ai [openai-compatible]: empty answer (finish_reason=${safeToken(finishReason)})`
    );
    return new ChatProviderError(
      'empty',
      'OpenAI-compatible API returned an empty answer'
    );
  }

  private extractText(data: unknown): string {
    if (typeof data !== 'object' || data === null) return '';

    const d = data as Record<string, unknown>;

    // Standard OpenAI shape
    const choices = Array.isArray(d.choices) ? d.choices : [];
    const choice = choices[0] as Record<string, unknown> | undefined;
    if (choice) {
      const message = choice.message as Record<string, unknown> | undefined;
      if (typeof message?.content === 'string') {
        return message.content;
      }
      if (typeof choice.text === 'string') {
        return choice.text;
      }
    }

    // Some endpoints return the text directly
    if (typeof d.text === 'string') {
      return d.text;
    }

    return '';
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    userMessage: string,
    options: ChatGenerateOptions = {}
  ): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new Error(
        'HAI.ai [openai-compatible]: Not initialized. Check OPENAI_COMPATIBLE_API_KEY.'
      );
    }

    const body = this.buildBody(
      systemPrompt,
      messages,
      userMessage,
      options,
      false
    );
    const url = this.getApiUrl();
    const watchdog = new Watchdog();
    watchdog.arm(this.timeouts.requestTimeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: watchdog.signal,
        });
      } catch {
        throw this.connectionError(watchdog, 'request');
      }

      let responseText = '';
      try {
        responseText = await response.text();
      } catch {
        if (watchdog.timedOut) throw this.connectionError(watchdog, 'request');
        responseText = '';
      }

      if (!response.ok) {
        throw this.httpError(response.status, responseText);
      }

      let data: unknown;
      try {
        data = JSON.parse(responseText);
      } catch {
        console.error(
          `HAI.ai [openai-compatible]: invalid JSON in response (${responseText.length} chars)`
        );
        throw new ChatProviderError(
          'invalid',
          'OpenAI-compatible API returned invalid JSON'
        );
      }

      const text = this.extractText(data);
      if (!text.trim()) {
        throw this.emptyError(this.extractFinishReason(data));
      }

      const usage = (data as Record<string, unknown>)?.usage as
        | Record<string, number>
        | undefined;

      return {
        text,
        citations: [],
        tokenCount:
          (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
        finishReason: this.extractFinishReason(data),
        provider: this.name,
      };
    } finally {
      watchdog.clear();
    }
  }

  private extractFinishReason(data: unknown): string | undefined {
    const d = data as Record<string, unknown> | undefined;
    const choices = Array.isArray(d?.choices) ? d.choices : [];
    const choice = choices[0] as Record<string, unknown> | undefined;
    return typeof choice?.finish_reason === 'string'
      ? choice.finish_reason
      : undefined;
  }

  async generateResponseStream(
    systemPrompt: string,
    messages: ChatMessage[],
    userMessage: string,
    onChunk: (text: string) => void,
    options: ChatGenerateOptions = {}
  ): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new Error(
        'HAI.ai [openai-compatible]: Not initialized. Check OPENAI_COMPATIBLE_API_KEY.'
      );
    }

    const url = this.getApiUrl();
    const watchdog = new Watchdog();
    // generous until the first byte, then the pause between two chunks
    watchdog.arm(this.timeouts.firstByteTimeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            this.buildBody(systemPrompt, messages, userMessage, options, true)
          ),
          signal: watchdog.signal,
        });
      } catch {
        throw this.connectionError(watchdog, 'streaming request');
      }

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw this.httpError(response.status, errorBody);
      }

      let fullText = '';
      let finishReason: string | undefined;
      let tokenCount = 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ChatProviderError(
          'invalid',
          'OpenAI-compatible API sent no response body for streaming'
        );
      }

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try {
            chunk = await reader.read();
          } catch {
            throw this.connectionError(watchdog, 'stream');
          }
          const { done, value } = chunk;
          if (done) break;
          watchdog.arm(this.timeouts.idleTimeoutMs);

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;

            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              const chunkFinishReason = parsed.choices?.[0]?.finish_reason;

              if (delta?.content) {
                fullText += delta.content;
                onChunk(delta.content);
              }

              if (chunkFinishReason) {
                finishReason = chunkFinishReason;
              }

              if (parsed.usage) {
                tokenCount =
                  (parsed.usage.prompt_tokens ?? 0) +
                  (parsed.usage.completion_tokens ?? 0);
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // a read that was cut by the time limit may still hold the lock
        }
      }

      if (!fullText.trim()) {
        throw this.emptyError(finishReason);
      }

      return {
        text: fullText,
        citations: [],
        tokenCount,
        finishReason,
        provider: this.name,
      };
    } finally {
      watchdog.clear();
    }
  }
}
