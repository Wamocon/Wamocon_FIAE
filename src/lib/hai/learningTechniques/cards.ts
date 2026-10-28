/**
 * Learning technique cards: index text, stable source id and the release gate.
 * Pure module (no file or database access).
 *
 * @module lib/hai/learningTechniques/cards
 */

import { createHash } from 'crypto';
import type { LearningTechniqueCard } from './schema';

/** Namespace of the uuid v5 that names the source of a card. Never change. */
const SOURCE_ID_NAMESPACE = '6f1d3c52-8a4e-4b1a-9c27-5d0e7a9b3f10';

/**
 * Stable source id (uuid v5) of a card: the same card id always lands on the
 * same hai_embeddings rows, so a second run updates and does not duplicate.
 */
export function cardSourceId(cardId: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(SOURCE_ID_NAMESPACE.replace(/-/g, ''), 'hex'))
    .update(`learning-technique:${cardId}`, 'utf8')
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

const LEVEL_LABEL = {
  hoch: 'hoch',
  mittel: 'mittel',
  niedrig: 'niedrig',
} as const;

/**
 * Text of a card as it is indexed and later shown to the model (one chunk, at
 * most 2000 characters). The wording is fixed here so a changed card changes
 * the content hash and is embedded again.
 */
export function cardIndexText(
  card: LearningTechniqueCard,
  total: number
): string {
  const lines = [
    `Lerntechnik: ${card.title}`,
    `Nutzen: ${LEVEL_LABEL[card.effectiveness]} (Rang ${card.rank} von ${total}, Einordnung nach Dunlosky et al. 2013)`,
    `Was ist das: ${card.what}`,
    `Wann sinnvoll: ${card.whenUseful}`,
    `Drei Schritte: 1) ${card.steps[0]} 2) ${card.steps[1]} 3) ${card.steps[2]}`,
    `Beispiel Fachinformatik (FIAE): ${card.examples.FIAE}`,
    `Beispiel Büromanagement (KfBM): ${card.examples.KFBM}`,
    `Hilft bei Fragen wie: ${card.keywords.join(', ')}`,
    `Quelle: ${card.source.citation}`,
  ];
  return lines.join('\n');
}

/** Cards that a human has released. The default of every card is: not released. */
export function deliverableCards(
  cards: readonly LearningTechniqueCard[]
): LearningTechniqueCard[] {
  return cards.filter(card => card.review.reviewed === true);
}

/** Metadata stored with every chunk of a card (no scope fields on purpose). */
export function cardMetadata(
  card: LearningTechniqueCard
): Record<string, unknown> {
  return {
    cardId: card.id,
    rank: card.rank,
    effectiveness: card.effectiveness,
    contentKind: 'learning_technique',
  };
}
