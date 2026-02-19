/**
 * HAI.ai Ollama Embedding Provider
 *
 * Wraps the local Ollama API for embedding generation.
 * Uses nomic-embed-text (768 dims) by default — no rate limits, free, fast.
 *
 * API: POST http://localhost:11434/api/embed
 *
 * @module lib/hai/providers/ollama
 */

import type { EmbeddingProvider, EmbeddingResult } from './types';

// ============================================================================
// OLLAMA EMBEDDING PROVIDER
// ============================================================================

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private _initialized = false;

  constructor(
    baseUrl: string = 'http://localhost:11434',
    model: string = 'nomic-embed-text',
    dimensions: number = 768
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, ''); // Strip trailing slash
    this.model = model;
    this.dimensions = dimensions;

    // We'll validate connection on first use (lazy init)
    // Mark as initialized — actual availability is checked via health endpoint
    this._initialized = true;
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Check if Ollama server is running and the model is available
   */
  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        return { ok: false, error: `Ollama server returned ${res.status}` };
      }

      const data = await res.json();
      const models = (data.models || []).map((m: any) => m.name);
      const hasModel = models.some(
        (name: string) =>
          name === this.model || name.startsWith(`${this.model}:`)
      );

      if (!hasModel) {
        return {
          ok: false,
          error: `Model "${this.model}" not found. Available: ${models.join(', ')}. Run: ollama pull ${this.model}`,
        };
      }

      return { ok: true };
    } catch (error: any) {
      const isVercel = process.env.VERCEL === '1';
      const isLocalhost =
        this.baseUrl.includes('localhost') ||
        this.baseUrl.includes('127.0.0.1');

      if (error.name === 'TimeoutError' || error.code === 'ECONNREFUSED') {
        if (isVercel && isLocalhost) {
          return {
            ok: false,
            error: `Cannot connect to Ollama on localhost from Vercel. Set HAI_EMBEDDING_PROVIDER=gemini in Vercel environment variables.`,
          };
        }
        return {
          ok: false,
          error: 'Ollama server not running. Start it with: ollama serve',
        };
      }
      return {
        ok: false,
        error: `Cannot connect to Ollama at ${this.baseUrl}: ${error.message}`,
      };
    }
  }

  /**
   * Generate embedding for a single text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const result = await this.callOllamaEmbed([text]);
    return { embedding: result[0] };
  }

  /**
   * Generate embeddings for multiple texts in batch.
   * Ollama's /api/embed supports batch input natively — much faster than
   * sequential calls and no rate limiting needed (local model).
   */
  async generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    // Ollama can handle batches, but let's cap at 50 per request
    // to avoid memory issues on smaller machines
    const BATCH_SIZE = 50;
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const embeddings = await this.callOllamaEmbed(batch);
      results.push(...embeddings.map(emb => ({ embedding: emb })));
    }

    return results;
  }

  /**
   * Call Ollama's /api/embed endpoint
   *
   * Request:  { model: string, input: string | string[] }
   * Response: { model: string, embeddings: number[][] }
   */
  private async callOllamaEmbed(
    input: string[],
    retries = 3
  ): Promise<number[][]> {
    try {
      // nomic-embed-text context = 8192 tokens; German ≈ 2.5 chars/token → cap at 4000 chars
      const MAX_CHARS = 4000;
      const safeInput = input.map(t =>
        t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) + '…' : t
      );

      const res = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: safeInput.length === 1 ? safeInput[0] : safeInput,
        }),
        // 2 minute timeout for large batches
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        const errorMsg = `Ollama embed failed (${res.status}): ${errorBody}`;

        // If model not found, provide helpful error
        if (res.status === 404 || errorBody.includes('not found')) {
          throw new Error(
            `Model "${this.model}" not found in Ollama. Run: ollama pull ${this.model}`
          );
        }

        throw new Error(errorMsg);
      }

      const data = await res.json();

      if (!data.embeddings || !Array.isArray(data.embeddings)) {
        throw new Error(
          `Unexpected Ollama response format: missing embeddings array`
        );
      }

      // Validate dimensions
      for (const emb of data.embeddings) {
        if (emb.length !== this.dimensions) {
          console.warn(
            `HAI.ai [Ollama]: Expected ${this.dimensions} dims, got ${emb.length}. ` +
              `Update HAI_EMBEDDING_DIMENSIONS=${emb.length} in .env.local`
          );
          // Don't throw — pgvector will handle the mismatch
          break;
        }
      }

      return data.embeddings;
    } catch (error: any) {
      // Retry on connection errors (Ollama might be starting up)
      if (retries > 0 && this.isRetryableError(error)) {
        const delay = (4 - retries) * 2000; // 2s, 4s, 6s
        console.warn(
          `HAI.ai [Ollama]: ${error.message}. Retrying in ${delay}ms... (${retries} left)`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.callOllamaEmbed(input, retries - 1);
      }
      throw error;
    }
  }

  /**
   * Determine if an error is retryable (connection issues, server starting)
   */
  private isRetryableError(error: any): boolean {
    const msg = error.message || '';
    return (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.name === 'TimeoutError' ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('ECONNRESET') ||
      msg.includes('fetch failed') ||
      msg.includes('network')
    );
  }
}
