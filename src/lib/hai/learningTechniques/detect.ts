/**
 * Detects a question about learning and memorizing (HAI package B). The result
 * only switches things ON that are safe by themselves: the learning technique
 * section of the prompt (which carries the limits), the reserved places for
 * learning technique cards in the search and the trainee's own quiz and exam
 * data in the data context. It never opens content of an occupation.
 *
 * @module lib/hai/learningTechniques/detect
 */

import { LEARNING_TECHNIQUE_SOURCE_TYPE } from '../indexScope';

/** A word that STARTS with one of these parts is about learning (lower case). */
const LEARNING_PREFIXES = [
  'lern',
  'karteikarte',
  'eselsbr',
  'auswendig',
  'einpräg',
  'einpraeg',
  'vergess',
  'vergiss',
  'prokrastin',
  'aufschieb',
  'prüfungsangst',
  'pruefungsangst',
  'konzentr',
  'abrufübung',
  'abrufuebung',
];

/**
 * Whole words that are about learning. Words with a common technical or
 * everyday meaning are NOT matched by a stem: "Merkmal", "wiederholt" (a loop
 * repeats), "markieren" (a line), "Vorbehalt", "vorbereitet" (a statement).
 */
const LEARNING_WORDS = new Set([
  'merke',
  'merken',
  'merkt',
  'merkst',
  'merkhilfe',
  'merkhilfen',
  'behalten',
  'behalte',
  'wiederholen',
  'wiederhole',
  'wiederholung',
  'wiederholungen',
  'vorbereiten',
  'vorbereitung',
  'prüfungsvorbereitung',
  'pruefungsvorbereitung',
]);

/** Words with "lern" that are about the platform, not about learning. */
const NOT_LEARNING_PREFIXES = [
  'lernfeld',
  'lernplattform',
  'lernzentrum',
  'lernbegleiter',
  'lernfortschritt',
  'lernstand',
];

function wordsOf(message: string): string[] {
  return message
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Whether the learning technique section applies to a turn: the message is a
 * learning question, or learning technique cards were retrieved.
 */
export function usesLearningTechniques(
  message: string,
  results: ReadonlyArray<{ sourceType: string }>
): boolean {
  return (
    isLearningTechniqueQuestion(message) ||
    results.some(r => r.sourceType === LEARNING_TECHNIQUE_SOURCE_TYPE)
  );
}

/**
 * Whether a message is about learning and memorizing techniques (also: study
 * plan, repeating, concentration, learning types). Matches whole words or
 * word starts. A false positive adds the limits to the prompt, reserves places
 * for cards in the search and, for a trainee, loads the own progress and
 * calendar data (learning_query), so the word lists stay narrow.
 */
export function isLearningTechniqueQuestion(message: string): boolean {
  return wordsOf(message).some(word => {
    if (LEARNING_WORDS.has(word)) return true;
    if (NOT_LEARNING_PREFIXES.some(prefix => word.startsWith(prefix))) {
      return false;
    }
    return LEARNING_PREFIXES.some(prefix => word.startsWith(prefix));
  });
}
