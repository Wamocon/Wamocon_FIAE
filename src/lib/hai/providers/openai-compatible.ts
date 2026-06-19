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

    const response = await fetch(this.getApiUrl(), {
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
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `OpenAI-compatible API error: ${response.status} - ${errorBody}`
      );
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || '';

    return {
      text,
      citations: [],
      tokenCount:
        (data.usage?.prompt_tokens ?? 0) +
        (data.usage?.completion_tokens ?? 0),
      finishReason: choice?.finish_reason ?? undefined,
      provider: this.name,
    };
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

    const response = await fetch(this.getApiUrl(), {
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
    });

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
