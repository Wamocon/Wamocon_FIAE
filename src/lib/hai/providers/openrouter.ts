/**
 * HAI.ai OpenRouter Provider
 *
 * Wraps OpenRouter's OpenAI-compatible API for chat generation.
 * Uses free-tier models with automatic model fallback when rate-limited.
 *
 * Free models on OpenRouter share global rate limits across all users.
 * When one model's backend (e.g., Venice) is rate-limited, we automatically
 * try the next free model in the fallback chain instead of waiting.
 *
 * NOTE: OpenRouter does NOT provide embeddings.
 *       Embeddings are always handled by the Gemini provider.
 *
 * @module lib/hai/providers/openrouter
 */

import type {
  ChatProvider,
  ChatMessage,
  ChatGenerateOptions,
  ChatResponse,
} from './types';

// ============================================================================
// FREE MODEL FALLBACK CHAIN
// ============================================================================

/**
 * Ordered list of free models to try. If the first is rate-limited (429),
 * we immediately try the next one instead of waiting 8+ seconds per retry.
 * All models use the ':free' suffix to ensure zero cost.
 */
const FREE_MODEL_CHAIN = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'qwen/qwen3-coder:free',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'deepseek/deepseek-r1-0528:free',
  'openai/gpt-oss-120b:free',
  'stepfun/step-3.5-flash:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
];

/** How many times to retry the full model chain before giving up */
const MAX_CHAIN_RETRIES = 2;
/** Delay (ms) between full chain retry rounds */
const CHAIN_RETRY_DELAY_MS = 10_000;

// ============================================================================
// OPENROUTER CHAT PROVIDER
// ============================================================================

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export class OpenRouterChatProvider implements ChatProvider {
  readonly name = 'openrouter';
  private apiKey: string | null = null;
  private modelName: string;

  constructor(
    apiKey: string | undefined,
    modelName: string = FREE_MODEL_CHAIN[0]
  ) {
    this.modelName = modelName;

    if (apiKey) {
      this.apiKey = apiKey;
    } else {
      console.warn(
        'HAI.ai [OpenRouter]: No API key provided (OPENROUTER_API_KEY)'
      );
    }
  }

  isInitialized(): boolean {
    return this.apiKey !== null;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    userMessage: string,
    options: ChatGenerateOptions = {}
  ): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new Error(
        'HAI.ai [OpenRouter]: Not initialized. Check OPENROUTER_API_KEY.'
      );
    }

    const openRouterMessages = this.buildMessages(
      systemPrompt,
      messages,
      userMessage
    );

    const response = await this.callWithModelFallback(async (model: string) => {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wamocon.com',
          'X-Title': 'HAI.ai - WAMOCON Lernbegleiter',
        },
        body: JSON.stringify({
          model,
          messages: openRouterMessages,
          max_tokens: options.maxOutputTokens ?? 2048,
          temperature: options.temperature ?? 0.7,
          top_p: options.topP ?? 0.9,
          ...(options.stopSequences?.length
            ? { stop: options.stopSequences }
            : {}),
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'Unknown error');
        const error = new Error(
          `OpenRouter API error: ${res.status} - ${errorBody}`
        ) as any;
        error.status = res.status;
        throw error;
      }

      return res.json();
    });

    const choice = response.choices?.[0];
    const text = choice?.message?.content || '';

    return {
      text,
      citations: [], // RAG citations are added by the pipeline, not the provider
      tokenCount:
        (response.usage?.prompt_tokens ?? 0) +
        (response.usage?.completion_tokens ?? 0),
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
        'HAI.ai [OpenRouter]: Not initialized. Check OPENROUTER_API_KEY.'
      );
    }

    const openRouterMessages = this.buildMessages(
      systemPrompt,
      messages,
      userMessage
    );

    const response = await this.callWithModelFallback(async (model: string) => {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://wamocon.com',
          'X-Title': 'HAI.ai - WAMOCON Lernbegleiter',
        },
        body: JSON.stringify({
          model,
          messages: openRouterMessages,
          max_tokens: options.maxOutputTokens ?? 2048,
          temperature: options.temperature ?? 0.7,
          top_p: options.topP ?? 0.9,
          ...(options.stopSequences?.length
            ? { stop: options.stopSequences }
            : {}),
          stream: true,
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => 'Unknown error');
        const error = new Error(
          `OpenRouter API error: ${res.status} - ${errorBody}`
        ) as any;
        error.status = res.status;
        throw error;
      }

      return res;
    });

    let fullText = '';
    let finishReason: string | undefined;
    let tokenCount = 0;

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('HAI.ai [OpenRouter]: No response body for streaming');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6); // Remove 'data: ' prefix
          if (data === '[DONE]') {
            continue;
          }

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

            // Capture usage from the final chunk (OpenRouter sends it in the last SSE event)
            if (parsed.usage) {
              tokenCount =
                (parsed.usage.prompt_tokens ?? 0) +
                (parsed.usage.completion_tokens ?? 0);
            }
          } catch {
            // Skip malformed JSON lines (e.g., partial data)
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

  /**
   * Build OpenAI-compatible messages array from our generic format.
   * System prompt goes as a system message, then history, then user message.
   */
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

  /**
   * Try the request with each free model in the fallback chain.
   * On 429 (rate limit), immediately move to the next model instead of waiting.
   * On 404 (model unavailable), skip to the next model.
   * On server errors (500/502/503), retry the SAME model once before moving on.
   * On 402 (spend limit), fail immediately — it won't resolve.
   *
   * If ALL models are rate-limited on the first pass, waits CHAIN_RETRY_DELAY_MS
   * and retries the entire chain up to MAX_CHAIN_RETRIES times. Free-tier rate
   * limits are short-lived (seconds) so a brief pause often clears them.
   */
  private async callWithModelFallback<T>(
    fn: (model: string) => Promise<T>
  ): Promise<T> {
    // Build model list: start with configured model, then add remaining chain models
    const models = [
      this.modelName,
      ...FREE_MODEL_CHAIN.filter(m => m !== this.modelName),
    ];

    for (let round = 0; round <= MAX_CHAIN_RETRIES; round++) {
      if (round > 0) {
        console.warn(
          `HAI.ai [OpenRouter]: All models rate-limited. Waiting ${CHAIN_RETRY_DELAY_MS / 1000}s before retry round ${round + 1}/${MAX_CHAIN_RETRIES + 1}...`
        );
        await new Promise(resolve => setTimeout(resolve, CHAIN_RETRY_DELAY_MS));
      }

      for (const model of models) {
        try {
          const result = await fn(model);
          if (model !== this.modelName) {
            console.log(
              `HAI.ai [OpenRouter]: Primary model rate-limited. Succeeded with fallback: ${model}`
            );
          }
          return result;
        } catch (error: any) {
          const status = error.status || error.code;
          const message = error.message || '';

          // 402 from a backend provider (e.g. Venice) = provider-level spend limit,
          // not the user's OpenRouter account limit. Treat like 429 — skip to next model.
          // Only fail immediately if the error is from OpenRouter itself (no provider_name).
          if (status === 402) {
            const isProviderLevel =
              message.includes('provider_name') ||
              message.includes('Provider returned error');
            if (isProviderLevel) {
              console.warn(
                `HAI.ai [OpenRouter]: ${model} backend returned 402 (provider spend limit). Trying next free model...`
              );
              continue;
            }
            // Account-level 402 — truly fatal
            console.error(
              'HAI.ai [OpenRouter]: API key spend limit exceeded. Increase limit at https://openrouter.ai/settings/keys'
            );
            throw error;
          }

          const isRateLimited =
            status === 429 ||
            message.includes('rate_limit') ||
            message.includes('Rate limit');

          // 404 = model/endpoint not found — skip to next model
          const isModelUnavailable =
            status === 404 || message.includes('No endpoints found');

          const isServerError =
            status === 500 || status === 502 || status === 503;

          const isTransient =
            message.includes('ECONNREFUSED') || message.includes('timeout');

          if (isRateLimited || isModelUnavailable) {
            // 429 or 404: Don't wait, immediately try next model
            console.warn(
              `HAI.ai [OpenRouter]: ${model} ${isRateLimited ? 'rate-limited (429)' : 'unavailable (404)'}. Trying next free model...`
            );
            continue;
          }

          if (isServerError || isTransient) {
            // Server error: retry same model ONCE with short delay
            console.warn(
              `HAI.ai [OpenRouter]: ${model} returned ${status}. Retrying once in 2s...`
            );
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              return await fn(model);
            } catch (retryError: any) {
              console.warn(
                `HAI.ai [OpenRouter]: ${model} retry failed. Trying next model...`
              );
              continue;
            }
          }

          // Unknown error — don't retry, let it propagate
          throw error;
        }
      }
    }

    // All models and all retry rounds exhausted
    const modelList = models.join(', ');
    throw new Error(
      `HAI.ai [OpenRouter]: All free models rate-limited after ${MAX_CHAIN_RETRIES + 1} rounds. Tried: ${modelList}. Please try again in a few minutes.`
    );
  }
}
