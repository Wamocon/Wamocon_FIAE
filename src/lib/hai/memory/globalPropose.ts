/**
 * HAI memory: proposals for the SHARED memory, formed deterministically from
 * counters, WITHOUT any reference to a person.
 *
 * Two sources of counters, both numbers of DIFFERENT users per occupation:
 *  - a preference (style of explanation, length, form of learning) that at least
 *    k users confirmed in their own memory,
 *  - a topic in which at least k users struggle in the quizzes (weakness).
 * Below the minimum k (GLOBAL_MIN_SUPPORT_K) there is no proposal: a count of one
 * to four could point at a person. The database queries apply the same k as HAVING,
 * so a smaller count never leaves the database, and this module drops it once more.
 *
 * The TEXT comes from fixed templates and, for a topic, the title of the enabler.
 * It NEVER comes from something a user typed or said. The result is only a
 * proposal: a platform admin approves it in the admin area.
 *
 * Address (du or Sie) and the way of input (speaking or typing) are individual,
 * they are not offered as shared hints.
 *
 * Pure module (no database).
 *
 * @module lib/hai/memory/globalPropose
 */

import { GLOBAL_MEMORY_MAX_CHARS, GLOBAL_MIN_SUPPORT_K } from './config';
import { weaknessKey, topicLabel } from './memoryDerive';
import { checkMemoryContent } from './text';
import type { PreferenceCounter, WeaknessCounter } from './repo';

/** The templates of the shared hints per preference key. */
export const GLOBAL_PREFERENCE_TEMPLATES: Readonly<Record<string, string>> = {
  'pref.length.short':
    'Viele Azubis wünschen kurze, knappe Antworten. Halte Antworten kurz und biete Einzelheiten auf Nachfrage an.',
  'pref.length.long':
    'Viele Azubis wünschen ausführliche Antworten. Erkläre gründlich und nenne alle Schritte.',
  'pref.explain.examples':
    'Viele Azubis lernen am besten mit Beispielen. Erkläre Neues möglichst mit einem konkreten Beispiel aus dem Berufsalltag.',
  'pref.explain.steps':
    'Viele Azubis wünschen Erklärungen Schritt für Schritt. Gliedere Erklärungen in kleine, nummerierte Schritte.',
  'pref.explain.simple':
    'Viele Azubis wünschen einfache Worte. Erkläre Fachbegriffe kurz, bevor du sie benutzt.',
  'style.form.cards':
    'Viele Azubis lernen gern mit Lernkarten. Biete bei Wiederholungsfragen Lernkarten oder eine kurze Abfrage an.',
  'style.form.quiz':
    'Viele Azubis üben gern mit Quizfragen. Biete nach einer Erklärung eine kurze Abfrage an.',
  'style.form.practice':
    'Viele Azubis lernen gern durch Ausprobieren. Schlage kleine praktische Aufgaben vor.',
  'style.form.visual':
    'Viele Azubis lernen gern mit Skizzen. Beschreibe Zusammenhänge mit einer kurzen Skizze oder einer Aufzählung.',
};

/** The text of a shared hint for a weak topic. */
export function weaknessTemplate(label: string): string {
  return `Bei dem Thema „${label}“ haben viele Azubis Schwierigkeiten. Erkläre es bei Fragen dazu besonders schrittweise und mit einem Beispiel.`;
}

export interface GlobalProposal {
  catalogId: string;
  key: string;
  content: string;
  /** Number of different users, never the users. */
  supportCount: number;
}

/**
 * The proposals of one calculation. Counters below k are dropped, a preference
 * without a template (address, input) is dropped, a topic title that fails the
 * check is dropped. The order is stable (occupation, key).
 */
export function buildGlobalProposals(
  preferences: readonly PreferenceCounter[],
  weaknesses: readonly WeaknessCounter[],
  k: number = GLOBAL_MIN_SUPPORT_K
): GlobalProposal[] {
  const out: GlobalProposal[] = [];

  for (const counter of preferences) {
    if (!(counter.support >= k)) continue;
    const content = GLOBAL_PREFERENCE_TEMPLATES[counter.proposalKey];
    if (!content || !counter.catalogId) continue;
    out.push({
      catalogId: counter.catalogId,
      key: counter.proposalKey,
      content,
      supportCount: Math.floor(counter.support),
    });
  }

  for (const counter of weaknesses) {
    if (!(counter.support >= k)) continue;
    const label = topicLabel(counter.title);
    if (!label || !counter.catalogId || !counter.enablerId) continue;
    const content = weaknessTemplate(label);
    if (
      !checkMemoryContent(content, GLOBAL_MEMORY_MAX_CHARS, { derived: true })
        .ok
    ) {
      continue;
    }
    out.push({
      catalogId: counter.catalogId,
      key: weaknessKey(counter.enablerId),
      content,
      supportCount: Math.floor(counter.support),
    });
  }

  return out.sort(
    (a, b) =>
      a.catalogId.localeCompare(b.catalogId) || a.key.localeCompare(b.key)
  );
}
