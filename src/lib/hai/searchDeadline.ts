/**
 * Time limit for the knowledge search of a question about the own data.
 *
 * The search starts with the embedding of the question at Sokrates, a shared
 * machine that needed 5 to 36 seconds for it under load (docs/hai-geschwindigkeit.md).
 * A question about the own data ("Wie ist mein Fortschritt?", "Wann habe ich
 * Berufsschule?", "Welche Abgaben sind offen?") is answered from the live data of
 * the platform and needs no search at all, so it must not wait for it: the turn
 * waits a few seconds and then goes on without the search.
 *
 * What the model is told instead is the note below, not the standing text "no
 * context was found" (that text would be wrong here: the search did not run, it
 * did not come back empty). A knowledge question has no such limit.
 *
 * Pure module (no database, no model).
 *
 * @module lib/hai/searchDeadline
 */

import { foldUmlauts } from './dayQuestion';

/** How long a question about the own data waits for the knowledge search. */
export const DATA_QUESTION_SEARCH_DEADLINE_MS = 4_000;

/** A longer text is a knowledge question, not a quick question about the own data. */
const DATA_QUESTION_MAX_CHARS = 160;

/** The person talks about herself or her group ("mein Fortschritt", "habe ich", "meine Azubis"). */
const FIRST_PERSON =
  /\b(?:ich|mir|mich|mein|meine|meinen|meinem|meiner|meines|wir|uns|unser\w*)\b/;

/** What the live data of the platform holds (folded text, no umlauts). */
const DATA_CUES =
  /fortschritt|wie weit|noch offen|was fehlt|wie stehe|mein stand|kalender|wann habe|berufsschule|schulblock|naechste pruefung|pruefungstermin|wann schreibe|\bnoten?\b|bestanden|ergebnis|abgabe|abgegeben|eingereicht|rueckmeldung|feedback|nachweis|berichtsheft|benachrichtigung|neuigkeiten|\btermine?\b|zu bewerten|azubis|auszubildende/;

/**
 * A short question that is about the own data. Both parts are needed: the
 * person speaks about herself and names something the live data holds, so
 * "Was ist ein Block in Python?" or "Erkläre die Zwischenprüfung" stay knowledge
 * questions with the full search.
 */
export function isPersonalDataQuestion(message: string): boolean {
  if (message.trim().length === 0) return false;
  if (message.length > DATA_QUESTION_MAX_CHARS) return false;
  const folded = foldUmlauts(message);
  return FIRST_PERSON.test(folded) && DATA_CUES.test(folded);
}

/** The limit for the search of this question in ms, or null (no limit). */
export function searchDeadlineMs(message: string): number | null {
  return isPersonalDataQuestion(message)
    ? DATA_QUESTION_SEARCH_DEADLINE_MS
    : null;
}

/**
 * The text the model gets when the search did not run (limit, embedding or
 * database failed). Instead of "no context found": the answer comes from the
 * live data and the persona, and the model says honestly that it could not look
 * into the documents. Names no provider, no address, no error.
 */
export const SEARCH_UNAVAILABLE_NOTE = `### Wissenssuche gerade nicht verfügbar
Die Suche in den Unterlagen konnte für diese Frage nicht ausgeführt werden (sie war gerade zu langsam oder gestört). Es liegen dir daher keine Auszüge aus den Unterlagen vor. Das heißt nicht, dass es dazu nichts gibt.
- Beantworte die Frage mit den aktuellen Plattform-Daten, wenn die Antwort dort steht.
- Fragen zum Inhalt von Kursen oder Unterlagen: Sage kurz und ehrlich, dass du gerade nicht in den Unterlagen nachsehen konntest, und bitte darum, es in einer Minute noch einmal zu versuchen.
- Nenne keine Quellen und erfinde keine Details.`;

export type DeadlineOutcome<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

/**
 * Waits for `work` at most `ms`. After the limit the outcome is `timedOut` and
 * the work is left to finish on its own (its late result or error is dropped).
 * Without a limit it just waits. A rejection of `work` before the limit is thrown.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  ms: number | null
): Promise<DeadlineOutcome<T>> {
  if (ms === null) return { timedOut: false, value: await work };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const limit = new Promise<{ timedOut: true }>(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  // a late failure of the abandoned work must not become an unhandled rejection
  work.catch(() => undefined);
  try {
    return await Promise.race([
      work.then(value => ({ timedOut: false as const, value })),
      limit,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
