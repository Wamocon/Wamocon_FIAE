/**
 * HAI.ai Generic OpenAI-Compatible Provider
 *
 * Works with any OpenAI-compatible chat-completions endpoint.
 * Configured via environment variables:
 *   - OPENAI_COMPATIBLE_BASE_URL (default: Sokrates test endpoint)
 *   - OPENAI_COMPATIBLE_API_KEY
 *   - OPENAI_COMPATIBLE_MODEL (default: gpt-4o-mini)
 *
 * No model fallback chain — the configured model is used exclusively.
 * No provider-specific headers (HTTP-Referer, X-Title) are sent.
 *
 * @module lib/hai/providers/openai-compatible
 */

import type {
  ChatProvider,
  ChatMessage,
  ChatGenerateOptions,
  ChatResponse,
} from './types';

const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAICompatibleChatProvider implements ChatProvider {
  readonly name = 'openai-compatible';
  private apiKey: string | null = null;
  private baseUrl: string;
  private modelName: string;

  constructor(
    baseUrl: string,
    apiKey: string | undefined,
    modelName: string = 'gpt-4o-mini'
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.modelName = modelName;

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

  private createAbortSignal(timeoutMs: number): AbortSignal {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    // Ensure the timeout is cleaned up if the request finishes quickly.
    const originalAbort = controller.abort.bind(controller);
    controller.abort = (reason?: unknown) => {
      clearTimeout(timeout);
      originalAbort(reason);
    };
    return controller.signal;
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

    const body = {
      model: this.modelName,
      messages: this.buildMessages(systemPrompt, messages, userMessage),
      max_tokens: options.maxOutputTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
      top_p: options.topP ?? 0.9,
      ...(options.stopSequences?.length ? { stop: options.stopSequences } : {}),
      stream: false,
    };

    const signal = this.createAbortSignal(DEFAULT_TIMEOUT_MS);
    const url = this.getApiUrl();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(
        `HAI.ai [openai-compatible]: fetch failed for ${url}:`,
        fetchError
      );
      throw new Error(`OpenAI-compatible API request failed: ${message}`);
    }

    let responseText = '';
    try {
      responseText = await response.text();
    } catch {
      responseText = '<unreadable body>';
    }

    if (!response.ok) {
      console.error(
        `HAI.ai [openai-compatible]: API error ${response.status} from ${url}. Body:`,
        responseText.slice(0, 1000)
      );
      throw new Error(
        `OpenAI-compatible API error: ${response.status} - ${responseText.slice(0, 500)}`
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.error(
        `HAI.ai [openai-compatible]: Failed to parse JSON response from ${url}. Body:`,
        responseText.slice(0, 1000)
      );
      throw new Error(
        `OpenAI-compatible API returned invalid JSON: ${responseText.slice(0, 500)}`
      );
    }

    const text = this.extractText(data);
    if (!text) {
      console.warn(
        `HAI.ai [openai-compatible]: Empty content in response from ${url}. Response:`,
        JSON.stringify(data).slice(0, 1000)
      );
    }

    const usage = (data as Record<string, unknown>)?.usage as
      | Record<string, number>
      | undefined;

    return {
      text,
      citations: [],
      tokenCount: (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
      finishReason: this.extractFinishReason(data),
      provider: this.name,
    };
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

    const signal = this.createAbortSignal(DEFAULT_TIMEOUT_MS);
    const url = this.getApiUrl();

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelName,
          messages: this.buildMessages(systemPrompt, messages, userMessage),
          max_tokens: options.maxOutputTokens ?? 2048,
          temperature: options.temperature ?? 0.7,
          top_p: options.topP ?? 0.9,
          ...(options.stopSequences?.length
            ? { stop: options.stopSequences }
            : {}),
          stream: true,
        }),
        signal,
      });
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : String(fetchError);
      console.error(
        `HAI.ai [openai-compatible]: streaming fetch failed for ${url}:`,
        fetchError
      );
      throw new Error(
        `OpenAI-compatible API streaming request failed: ${message}`
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `OpenAI-compatible API error: ${response.status} - ${errorBody}`
      );
    }

    let fullText = '';
    let finishReason: string | undefined;
    let tokenCount = 0;

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error(
        'HAI.ai [openai-compatible]: No response body for streaming'
      );
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
      reader.releaseLock();
    }

    return {
      text: fullText,
      citations: [],
      tokenCount,
      finishReason,
      provider: this.name,
    };
  }
}
