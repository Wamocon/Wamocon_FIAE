/**
 * The order in which a trainee sees the options of a choice question.
 *
 * The author's order (options.order_index) used to be the only order, so the
 * right option sat on the same place for every attempt and could be learned by
 * heart. Now the options are mixed per attempt: the order is a function of
 * trainee, quiz, attempt number and question, so it is the same every time the
 * attempt is loaded (reload, second tab) and another one for the next attempt.
 *
 * Only the order of the list changes. The grading runs on the option id (the
 * submit route compares the chosen id with the stored is_correct), never on a
 * position, so nothing here can change a score. This module is pure.
 */

export interface OrderableOption {
  id: string;
  optionText: string;
  orderIndex?: number | null;
}

/** The seed of one attempt: the same string for the whole attempt. */
export function attemptSeed(
  traineeId: string,
  quizId: string,
  attemptNumber: number
): string {
  return `${traineeId}:${quizId}:${attemptNumber}`;
}

/**
 * An option that points at the others by position or by name ("all of the
 * above", "A and B") only makes sense on its place. A question with such an
 * option keeps the order of the author.
 */
const REFERS_TO_OTHERS = [
  /\b(alle|keine|beide)\b.{0,20}\b(oben|obigen|genannten|vorstehenden|antworten|aussagen|optionen)\b/i,
  /\b(all|none|both) of (the )?(above|these|them)\b/i,
  /^\s*\(?[a-d1-4]\)?\s*(und|and|&|,|oder|or)\s*\(?[a-d1-4]\)?\s*$/i,
  /\b(antwort|option|answer)\s*[a-d1-4]\b/i,
];

function refersToOthers(text: string): boolean {
  return REFERS_TO_OTHERS.some(rx => rx.test(text));
}

// FNV-1a over the seed text, then mulberry32: small, dependency free and the
// same on every runtime (no Math.random, so a result can be reproduced)
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The options of one question in the order of one attempt. The input is first
 * put in the order of the author (order_index, rows without one last, stable)
 * so the result does not depend on the order the database returned them in.
 */
export function orderOptionsForAttempt<T extends OrderableOption>(
  options: ReadonlyArray<T>,
  seed: string,
  questionId: string
): T[] {
  const authored = [...options].sort((a, b) => {
    const byIndex =
      (a.orderIndex ?? Number.MAX_SAFE_INTEGER) -
      (b.orderIndex ?? Number.MAX_SAFE_INTEGER);
    return byIndex !== 0 ? byIndex : String(a.id).localeCompare(String(b.id));
  });
  if (authored.length < 2) return authored;
  if (authored.some(o => refersToOthers(o.optionText))) return authored;

  const random = mulberry32(hash32(`${seed}:${questionId}`));
  const mixed = [...authored];
  for (let i = mixed.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
  }
  return mixed;
}
