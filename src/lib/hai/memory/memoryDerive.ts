/**
 * HAI memory: proposals about the learning state and the weaknesses of a trainee,
 * derived from the data that is already on the platform (no model call).
 *
 * Inputs (loaded by deriveData.ts, one occupation): the graded quiz attempts per
 * topic (the topic is an enabler) and the progress (completed enablers of the
 * occupation, the same numbers the day companion shows, see dayProgress.ts).
 * Everything here is arithmetic and templates:
 *  - a WEAKNESS is a topic with at least WEAKNESS_MIN_ATTEMPTS graded attempts and
 *    an average score below WEAKNESS_BELOW_SCORE percent, the weakest first, at
 *    most WEAKNESS_MAX_TOPICS. The text names the TOPIC only, never a question,
 *    an answer or a solution.
 *  - the LEARNING STATE is one line with the date and the count of completed
 *    enablers. It is a snapshot ("Stand am ..."), not a forecast.
 * The entries are proposals: the user is asked, nothing acts before the yes.
 * Both are a processing of personal performance data and therefore stay behind
 * the agreement with data protection and the works council (docs/hai-gedaechtnis.md).
 *
 * Pure module (no database).
 *
 * @module lib/hai/memory/memoryDerive
 */

import {
  USER_MEMORY_MAX_CHARS,
  WEAKNESS_BELOW_SCORE,
  WEAKNESS_MAX_TOPICS,
  WEAKNESS_MIN_ATTEMPTS,
} from './config';
import { checkMemoryContent, cleanMemoryLine } from './text';

/** Graded quiz attempts of the trainee in one topic (an enabler). */
export interface TopicStat {
  enablerId: string;
  title: string;
  attempts: number;
  /** Average score in percent over the graded attempts. */
  avgScore: number;
}

/** Progress of the trainee in one occupation. */
export interface ProgressStat {
  completed: number;
  total: number;
}

export interface DerivedCandidate {
  kind: 'weakness' | 'learning_state';
  key: string;
  content: string;
}

/** Key of the learning state entry (one per user and occupation). */
export const LEARNING_STATE_KEY = 'state.progress';

/** Key of the weakness entry of a topic. */
export function weaknessKey(enablerId: string): string {
  return `weak.${enablerId}`;
}

/** The title of a topic for the text: one line, bounded, or null if it is not usable. */
export function topicLabel(title: string): string | null {
  const label = cleanMemoryLine(title, 80);
  if (label === '') return null;
  // the title is content of the platform, but it ends up in a prompt: the light list
  return checkMemoryContent(label, 80, { derived: true }).ok ? label : null;
}

/** dd.mm.yyyy of a date (UTC), the way the interface shows a day. */
export function formatDay(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${date.getUTCFullYear()}`;
}

/** The weakest topics as proposals (weakest first). */
export function deriveWeaknesses(
  topics: readonly TopicStat[],
  options: { minAttempts?: number; below?: number; max?: number } = {}
): DerivedCandidate[] {
  const minAttempts = options.minAttempts ?? WEAKNESS_MIN_ATTEMPTS;
  const below = options.below ?? WEAKNESS_BELOW_SCORE;
  const max = options.max ?? WEAKNESS_MAX_TOPICS;

  const out: DerivedCandidate[] = [];
  const weak = topics
    .filter(
      topic =>
        Number.isFinite(topic.avgScore) &&
        topic.attempts >= minAttempts &&
        topic.avgScore < below
    )
    .sort((a, b) => a.avgScore - b.avgScore || b.attempts - a.attempts);
  for (const topic of weak) {
    if (out.length >= max) break;
    const label = topicLabel(topic.title);
    if (!label || !topic.enablerId) continue;
    const content = `Tut sich beim Thema „${label}“ schwer (Quizergebnisse unter ${below} Prozent).`;
    if (
      !checkMemoryContent(content, USER_MEMORY_MAX_CHARS, { derived: true }).ok
    ) {
      continue;
    }
    out.push({
      kind: 'weakness',
      key: weaknessKey(topic.enablerId),
      content,
    });
  }
  return out;
}

/** The learning state as a proposal, or null when there is nothing to say yet. */
export function deriveLearningState(
  progress: ProgressStat | null,
  now: Date
): DerivedCandidate | null {
  if (!progress) return null;
  const { completed, total } = progress;
  if (!(total >= 1) || !(completed >= 1) || completed > total) return null;
  return {
    kind: 'learning_state',
    key: LEARNING_STATE_KEY,
    content: `Lernstand am ${formatDay(now)}: ${completed} von ${total} Enablern abgeschlossen.`,
  };
}

/** All candidates of one calculation: the weaknesses first, then the state. */
export function deriveCandidates(
  input: { topics: readonly TopicStat[]; progress: ProgressStat | null },
  now: Date
): DerivedCandidate[] {
  const out = deriveWeaknesses(input.topics);
  const state = deriveLearningState(input.progress, now);
  if (state) out.push(state);
  return out;
}
