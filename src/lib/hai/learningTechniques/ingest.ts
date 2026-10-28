/**
 * Ingest path of the learning technique cards into the HAI index.
 *
 * Nothing here runs by itself. The function is called by
 * scripts/hai-learning-techniques.ts, which is a dry run unless --apply is
 * given. A dry run touches neither the database nor an embedding model.
 *
 * Rules:
 *  - only released cards (review.reviewed === true) are indexed; the default of
 *    every card is not released
 *  - platform scope: trainingCatalogId null, visibility 'all', organization
 *    null (see indexScope.ts and buildScopeCondition in vectorSearch.ts)
 *  - one chunk per card
 *  - a card that is no longer released (or was deleted from the repository)
 *    loses its chunks in the index, so withdrawing a release takes effect
 *
 * @module lib/hai/learningTechniques/ingest
 */

import { chunkDocument } from '../chunker';
import { LEARNING_TECHNIQUE_SOURCE_TYPE } from '../indexScope';
import type { IndexContentOptions, IndexResult } from '../embeddings';
import {
  cardIndexText,
  cardMetadata,
  cardSourceId,
  deliverableCards,
} from './cards';
import type { LearningTechniqueCard } from './schema';

export interface IngestDeps {
  /** Writes the chunks of one source (embeds, calls the embedding model). */
  indexContent: (options: IndexContentOptions) => Promise<IndexResult>;
  /** Source ids of the learning technique cards that are in the index now. */
  listIndexedSourceIds: () => Promise<string[]>;
  /** Removes all chunks of one source. */
  removeSource: (sourceId: string) => Promise<boolean>;
}

export interface IngestPlanEntry {
  cardId: string;
  sourceId: string;
  released: boolean;
  chunks: number;
  characters: number;
}

export interface IngestSummary {
  dryRun: boolean;
  total: number;
  released: number;
  indexed: number;
  skipped: number;
  failed: number;
  removed: number;
  /** Upper bound of embedding calls (chunks of released cards). */
  embeddingCalls: number;
  plan: IngestPlanEntry[];
  errors: string[];
}

/** Title and content of a card as they are written to the index. */
export function cardIndexInput(
  card: LearningTechniqueCard,
  total: number
): { title: string; content: string } {
  return {
    title: `Lerntechnik: ${card.title}`,
    content: cardIndexText(card, total),
  };
}

export async function ingestLearningTechniques(
  cards: readonly LearningTechniqueCard[],
  deps: IngestDeps | null,
  options: { dryRun: boolean }
): Promise<IngestSummary> {
  const total = cards.length;
  const released = deliverableCards(cards);
  const releasedIds = new Set(released.map(card => card.id));

  const plan: IngestPlanEntry[] = cards.map(card => {
    const { title, content } = cardIndexInput(card, total);
    const chunks = chunkDocument(content, title, {
      maxChunkSize: 500,
      overlap: 50,
      preserveParagraphs: true,
      preserveSentences: true,
    });
    return {
      cardId: card.id,
      sourceId: cardSourceId(card.id),
      released: releasedIds.has(card.id),
      chunks: chunks.length,
      characters: chunks.reduce((sum, c) => sum + c.content.length, 0),
    };
  });

  const summary: IngestSummary = {
    dryRun: options.dryRun,
    total,
    released: released.length,
    indexed: 0,
    skipped: 0,
    failed: 0,
    removed: 0,
    embeddingCalls: plan
      .filter(entry => entry.released)
      .reduce((sum, entry) => sum + entry.chunks, 0),
    plan,
    errors: [],
  };

  if (options.dryRun) return summary;
  if (!deps) throw new Error('ingestLearningTechniques needs deps to apply');

  for (const card of released) {
    const { title, content } = cardIndexInput(card, total);
    const result = await deps.indexContent({
      sourceType: LEARNING_TECHNIQUE_SOURCE_TYPE,
      sourceId: cardSourceId(card.id),
      title,
      content,
      metadata: cardMetadata(card),
      // Platform scope: no occupation, for everyone, no owner
      trainingCatalogId: null,
      visibility: 'all',
      organizationId: null,
    });
    if (!result.success) {
      summary.failed++;
      summary.errors.push(`${card.id}: ${result.error ?? 'index failed'}`);
    } else {
      summary.indexed += result.chunksIndexed;
      summary.skipped += result.chunksSkipped;
    }
  }

  // Withdrawn or deleted cards must leave the index
  const wanted = new Set(released.map(card => cardSourceId(card.id)));
  for (const sourceId of await deps.listIndexedSourceIds()) {
    if (wanted.has(sourceId)) continue;
    if (await deps.removeSource(sourceId)) summary.removed++;
    else summary.errors.push(`could not remove source ${sourceId}`);
  }

  return summary;
}

/** Real dependencies (database and embedding model). Loaded lazily. */
export async function createIngestDeps(): Promise<IngestDeps> {
  const embeddings = await import('../embeddings');
  return {
    indexContent: options => embeddings.indexContent(options),
    listIndexedSourceIds: async () =>
      (await embeddings.getIndexedSources())
        .filter(s => s.sourceType === LEARNING_TECHNIQUE_SOURCE_TYPE)
        .map(s => s.sourceId),
    removeSource: sourceId =>
      embeddings.removeEmbeddings(LEARNING_TECHNIQUE_SOURCE_TYPE, sourceId),
  };
}
