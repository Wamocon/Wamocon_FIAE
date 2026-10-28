/**
 * Loads the learning technique cards from the repository (files only, no
 * database). Used by tests and by the ingest script, never by the app at
 * runtime (the app reads the cards from the index).
 *
 * @module lib/hai/learningTechniques/loader
 */

import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import {
  parseLearningTechniqueCard,
  validateCardSet,
  type LearningTechniqueCard,
} from './schema';

export const LEARNING_TECHNIQUES_DIR = path.join(
  'content',
  'hai',
  'learning-techniques'
);

/**
 * Reads, validates and returns all cards of a directory, sorted by rank. Throws
 * on the first card or set rule that is broken (nothing is half loaded).
 */
export function loadLearningTechniqueCards(
  dir: string = path.join(process.cwd(), LEARNING_TECHNIQUES_DIR)
): LearningTechniqueCard[] {
  const files = readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort();
  const cards = files.map(name => {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
    } catch (error) {
      throw new Error(
        `Learning technique card ${name} is not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    const card = parseLearningTechniqueCard(raw, name);
    // The file name carries the rank and the id: a mismatch is a copy error
    const expected = `${String(card.rank).padStart(2, '0')}-${card.id}.json`;
    if (name !== expected) {
      throw new Error(
        `Learning technique card ${name} must be named ${expected}`
      );
    }
    return card;
  });
  validateCardSet(cards);
  return cards.sort((a, b) => a.rank - b.rank);
}
