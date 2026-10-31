/**
 * HAI.ai embeddings through Sokrates (the own AI, Open WebUI in front of Ollama).
 *
 * Calls the OpenAI compatible route `<base>/embeddings` with a bearer key. The
 * model is `qwen3-embedding` in the gateway of Sokrates, that is `qwen3-embedding:8b`
 * of Ollama (4096 dimensions by itself). The column of the
 * index has 3072 dimensions, so the vector is cut to the first `dimensions`
 * values and normalized again (the model is trained for that: Matryoshka). A
 * measurement on 400 questions and about 8000 text parts gave the same quality
 * as Gemini (MRR 0.46 against 0.47).
 *
 * The vectors of two models cannot be compared, so an index has to be built
 * with the same provider that answers the questions (see the reindex script).
 *
 * @module lib/hai/providers/sokrates-embedding
 */

import type { EmbeddingProvider, EmbeddingResult } from './types';

const BATCH_SIZE = 16;
const MAX_CHARS = 4000;
const REQUEST_TIMEOUT_MS = 60_000;

/** The first `dimensions` values, normalized to length 1. */
export function cutAndNormalize(
  vector: number[],
  dimensions: number
): number[] {
  const cut = vector.length > dimensions ? vector.slice(0, dimensions) : vector;
  let sum = 0;
  for (const value of cut) sum += value * value;
  const length = Math.sqrt(sum);
  if (!Number.isFinite(length) || length === 0) return cut;
  return cut.map(value => value / length);
}

export class SokratesEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible';
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly model: string;

  constructor(
    baseUrl: string,
    apiKey: string | undefined,
    model: string,
    dimensions: number
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey && apiKey.trim() !== '' ? apiKey : null;
    this.model = model;
    this.dimensions = dimensions;
  }

  isInitialized(): boolean {
    return this.apiKey !== null && this.baseUrl !== '' && this.model !== '';
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const [first] = await this.embed([text]);
    return { embedding: first };
  }

  async generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const vectors = await this.embed(texts.slice(i, i + BATCH_SIZE));
      results.push(...vectors.map(embedding => ({ embedding })));
    }
    return results;
  }

  private async embed(input: string[]): Promise<number[][]> {
    if (!this.isInitialized()) {
      throw new Error('Sokrates embeddings are not configured');
    }
    const safeInput = input.map(text =>
      text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '…' : text
    );
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: safeInput,
        dimensions: this.dimensions,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // the body is not echoed: it may hold the request
      throw new Error(`Sokrates embeddings failed (${res.status})`);
    }
    const data = (await res.json()) as {
      data?: Array<{ index?: number; embedding?: number[] }>;
    };
    const rows = Array.isArray(data.data) ? [...data.data] : [];
    rows.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (
      rows.length !== safeInput.length ||
      rows.some(row => !Array.isArray(row.embedding))
    ) {
      throw new Error('Unexpected Sokrates embeddings response');
    }
    return rows.map(row =>
      cutAndNormalize(row.embedding as number[], this.dimensions)
    );
  }
}
