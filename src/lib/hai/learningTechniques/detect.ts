/**
 * Detects a question about learning and memorizing (HAI package B). The result
 * only switches things ON that are safe by themselves: the learning technique
 * section of the prompt (which carries the limits), the reserved places for
 * learning technique cards in the search and the trainee's own quiz and exam
 * data in the data context. It never opens content of an occupation.
 *
 * @module lib/hai/learningTechniques/detect
 */

/** A word that contains one of these parts is about learning (lower case). */
const LEARNING_PARTS = [
  'lern',
  'karteikarte',
  'eselsbr',
  'auswendig',
  'einpräg',
  'einpraeg',
  'behalt',
  'vergess',
  'vergiss',
  'wiederhol',
  'konzentr',
  'prokrastin',
  'aufschieb',
  'prüfungsangst',
  'pruefungsangst',
  'zusammenfass',
  'markier',
  'vorbereit',
  'abrufübung',
  'abrufuebung',
];

/** "merk" only as a verb or "Merkhilfe", not "Merkmal". */
const LEARNING_WORDS = new Set([
  'merke',
  'merken',
  'merkt',
  'merkst',
  'merkhilfe',
  'merkhilfen',
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
    results.some(r => r.sourceType === 'learning_technique')
  );
}

/**
 * Whether a message is about learning and memorizing techniques (also: study
 * plan, repeating, concentration, learning types). Deliberately generous: a
 * false positive only adds the limits and reserves places for cards.
 */
export function isLearningTechniqueQuestion(message: string): boolean {
  return wordsOf(message).some(word => {
    if (LEARNING_WORDS.has(word)) return true;
    if (NOT_LEARNING_PREFIXES.some(prefix => word.startsWith(prefix))) {
      return false;
    }
    return LEARNING_PARTS.some(part => word.includes(part));
  });
}
