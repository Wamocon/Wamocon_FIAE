/**
 * HAI.ai Gemini Provider
 *
 * Wraps Google Gemini API for both chat and embedding generation.
 * Embeddings: gemini-embedding-001 (upgraded from deprecated text-embedding-004)
 * Chat: gemini-flash-latest (latest stable Flash model)
 *
 * @module lib/hai/providers/gemini
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import type {
  ChatProvider,
  EmbeddingProvider,
  ChatMessage,
  ChatGenerateOptions,
  ChatResponse,
  EmbeddingResult,
} from './types';

// ============================================================================
// GEMINI CHAT PROVIDER
// ============================================================================

export class GeminiChatProvider implements ChatProvider {
  readonly name = 'gemini';
  private model: GenerativeModel | null = null;

  constructor(
    apiKey: string | undefined,
    modelName: string = 'gemini-flash-latest'
  ) {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.7,
          topP: 0.9,
        },
      });
    } else {
      console.warn('HAI.ai [Gemini Chat]: No API key provided');
    }
  }

  isInitialized(): boolean {
    return this.model !== null;
  }

  async generateResponse(
    systemPrompt: string,
    messages: ChatMessage[],
    userMessage: string,
    options: ChatGenerateOptions = {}
  ): Promise<ChatResponse> {
    if (!this.model) {
      throw new Error(
        'HAI.ai [Gemini Chat]: Not initialized. Check GEMINI_API_KEY.'
      );
    }

    const tools = options.enableWebSearch
      ? [{ googleSearch: {} } as any]
      : undefined;

    const history = [
      { role: 'user' as const, parts: [{ text: `[SYSTEM]: ${systemPrompt}` }] },
      {
        role: 'model' as const,
        parts: [
          { text: 'Verstanden. Ich bin HAI.ai, dein digitaler Lernbegleiter.' },
        ],
      },
      ...messages.map(m => ({
        role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: m.content }],
      })),
    ];

    const chat = this.model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
        topK: options.topK ?? 40,
        stopSequences: options.stopSequences,
      },
      tools,
    });

    const result = await this.callWithRetry(() =>
      chat.sendMessage(userMessage)
    );
    const response = result.response;
    const candidate = response.candidates?.[0];

    // Extract web citations from grounding metadata
    const citations = this.extractGroundingCitations(candidate);

    return {
      text: response.text(),
      citations,
      finishReason: candidate?.finishReason,
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
    if (!this.model) {
      throw new Error(
        'HAI.ai [Gemini Chat]: Not initialized. Check GEMINI_API_KEY.'
      );
    }

    const tools = options.enableWebSearch
      ? [{ googleSearch: {} } as any]
      : undefined;

    const history = [
      { role: 'user' as const, parts: [{ text: `[SYSTEM]: ${systemPrompt}` }] },
      {
        role: 'model' as const,
        parts: [
          { text: 'Verstanden. Ich bin HAI.ai, dein digitaler Lernbegleiter.' },
        ],
      },
      ...messages.map(m => ({
        role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: m.content }],
      })),
    ];

    const chat = this.model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: options.maxOutputTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        topP: options.topP ?? 0.9,
      },
      tools,
    });

    const result = await this.callWithRetry(() =>
      chat.sendMessageStream(userMessage)
    );
    let fullText = '';

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullText += chunkText;
      onChunk(chunkText);
    }

    const fullResponse = await result.response;
    const candidate = fullResponse.candidates?.[0];
    const citations = this.extractGroundingCitations(candidate);

    return {
      text: fullText,
      citations,
      finishReason: candidate?.finishReason,
      provider: this.name,
    };
  }

  /**
   * Extract web citations from Gemini's grounding metadata
   */
  private extractGroundingCitations(candidate: any): ChatResponse['citations'] {
    const citations: ChatResponse['citations'] = [];

    if (candidate?.groundingMetadata?.groundingChunks) {
      for (const chunk of candidate.groundingMetadata.groundingChunks) {
        if (chunk.web?.uri && chunk.web?.title) {
          citations.push({
            title: chunk.web.title,
            url: chunk.web.uri,
            sourceType: 'web',
          });
        }
      }
    }

    return citations;
  }

  /**
   * Retry on 429 Rate Limit and 503 Overloaded errors
   */
  private async callWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 1000
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      const status = error.status || error.code;
      const message = error.message || '';

      const isRetryable =
        status === 429 ||
        status === 503 ||
        message.includes('429') ||
        message.includes('503') ||
        message.includes('Overloaded') ||
        message.includes('RESOURCE_EXHAUSTED');

      if (retries > 0 && isRetryable) {
        const waitTime =
          status === 429 || message.includes('429')
            ? Math.max(delay, 3000)
            : delay;
        console.warn(
          `HAI.ai [Gemini Chat]: ${status || 'Error'}. Retrying in ${waitTime}ms... (${retries} left)`
        );
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.callWithRetry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }
}

// ============================================================================
// GEMINI EMBEDDING PROVIDER
// ============================================================================

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly dimensions: number;
  private model: GenerativeModel | null = null;

  constructor(
    apiKey: string | undefined,
    modelName: string = 'gemini-embedding-001',
    dimensions: number = 3072
  ) {
    this.dimensions = dimensions;

    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({ model: modelName });
    } else {
      console.warn('HAI.ai [Gemini Embedding]: No API key provided');
    }
  }

  isInitialized(): boolean {
    return this.model !== null;
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (!this.model) {
      throw new Error(
        'HAI.ai [Gemini Embedding]: Not initialized. Check GEMINI_API_KEY.'
      );
    }

    const result = await this.callWithRetry(async () => {
      return this.model!.embedContent({
        content: { role: 'user', parts: [{ text }] },
        // outputDimensionality is supported by gemini-embedding-001
        // 3072 is native for gemini-embedding-001 (no need to specify)
        ...(this.dimensions !== 3072
          ? { outputDimensionality: this.dimensions }
          : {}),
      } as any);
    });

    return {
      embedding: result.embedding.values,
    };
  }

  async generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (!this.model) {
      throw new Error('HAI.ai [Gemini Embedding]: Not initialized.');
    }

    const results: EmbeddingResult[] = [];
    const batchSize = 5; // Process 5 at a time to respect rate limits

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );
      results.push(...batchResults);

      // Delay between batches to respect free tier limits
      if (i + batchSize < texts.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return results;
  }

  /**
   * Retry on 429 Rate Limit and 503 Overloaded errors
   * CRITICAL: This was MISSING for embeddings in the old code
   */
  private async callWithRetry<T>(
    fn: () => Promise<T>,
    retries = 3,
    delay = 2000
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      const status = error.status || error.code;
      const message = error.message || '';

      const isRetryable =
        status === 429 ||
        status === 503 ||
        message.includes('429') ||
        message.includes('503') ||
        message.includes('RESOURCE_EXHAUSTED') ||
        message.includes('Overloaded') ||
        message.includes('quota');

      if (retries > 0 && isRetryable) {
        // For 429, wait longer (rate limit)
        const waitTime =
          status === 429 || message.includes('429')
            ? Math.max(delay, 5000)
            : delay;
        console.warn(
          `HAI.ai [Gemini Embedding]: ${status || 'Error'}. Retrying in ${waitTime}ms... (${retries} left)`
        );
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.callWithRetry(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }
}
