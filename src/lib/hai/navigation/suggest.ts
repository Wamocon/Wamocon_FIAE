/**
 * The nearest pages or records for a name that matched nothing (pure).
 *
 * A recognized request to open something that has no exact target is never left
 * to the model: the platform answers with the two or three nearest targets as
 * cards (similarity of the names), or with the pages of the level as examples.
 *
 * @module lib/hai/navigation/suggest
 */

import { foldText } from './fold';
import {
  staticTargetFor,
  type NavigationLevel,
  type StaticTargetId,
} from './targets';

const MIN_WORD = 3;
/** A score below this is no similarity. */
const MIN_SCORE = 0.34;

/** Words of the query that carry no name ("öffne", "den", "bitte"). */
const FILLER = new Set([
  'oeffne',
  'oeffnen',
  'oeffnest',
  'bitte',
  'mal',
  'mir',
  'mich',
  'uns',
  'den',
  'dem',
  'der',
  'die',
  'das',
  'des',
  'ein',
  'eine',
  'einen',
  'zum',
  'zur',
  'zu',
  'auf',
  'und',
  'geh',
  'gehe',
  'bring',
  'bringe',
  'fuehr',
  'fuehre',
  'navigier',
  'navigiere',
  'ruf',
  'rufe',
  'mach',
  'mache',
  'seite',
  'meine',
  'meinen',
  'mein',
  'meiner',
  'doch',
  'jetzt',
  'sofort',
  'noch',
  'wieder',
  'kannst',
  'du',
]);

function words(text: string): string[] {
  return foldText(text)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter(word => word.length >= MIN_WORD);
}

/** Edit distance up to 1 (an insert, a delete or a change of one letter). */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function wordScore(word: string, candidate: string): number {
  if (word === candidate) return 1;
  if (word.length >= 4 && candidate.length >= 4) {
    if (candidate.startsWith(word) || word.startsWith(candidate)) return 0.8;
    if (candidate.includes(word) || word.includes(candidate)) return 0.65;
  }
  if (
    word.length >= 5 &&
    candidate.length >= 5 &&
    withinOneEdit(word, candidate)
  ) {
    return 0.6;
  }
  return 0;
}

/** 0 to 1: how well the words of the query are found in the names. */
export function nameSimilarity(query: string, names: string): number {
  const wanted = words(query).filter(word => !FILLER.has(word));
  const have = words(names);
  if (wanted.length === 0 || have.length === 0) return 0;
  let total = 0;
  for (const word of wanted) {
    total += Math.max(0, ...have.map(candidate => wordScore(word, candidate)));
  }
  return total / wanted.length;
}

/** The best matches of a query among items, best first, at most `limit`. */
export function rankByName<T>(
  query: string,
  items: readonly T[],
  namesOf: (item: T) => string,
  limit = 3
): T[] {
  return items
    .map(item => ({ item, score: nameSimilarity(query, namesOf(item)) }))
    .filter(entry => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item);
}

/**
 * Words people use for a page, next to its label from the menu: the synonyms
 * the recognition knows (intent.ts) and a few more. Only for the nearest-pages
 * answer, the recognition itself is in intent.ts.
 */
export const PAGE_WORDS: Readonly<Partial<Record<StaticTargetId, string>>> = {
  dashboard: 'startseite startbildschirm uebersicht home',
  activity_reports:
    'berichtsheft wochenbericht taetigkeitsnachweis nachweis berichte',
  school: 'schule berufsschule lernfeld lernfelder pruefung klausur noten',
  calendar: 'blockkalender schulkalender termine bloecke',
  profile: 'profil einstellungen konto zertifikate',
  quizzes: 'quiz quizze pruefung test abfrage',
  courses:
    'kurs kurse modul module lernen lernstoff enabler use case themenkreis',
  trainer_feedback: 'feedback rueckmeldung ausbilder trainer',
  trainees: 'azubis auszubildende lehrlinge trainees liste',
  reviews: 'bewertungen offen reviews pruefliste abgaben',
  content_management:
    'inhaltsverwaltung inhalte kurse module enabler use case verwalten',
  statistics: 'statistik auswertung kennzahlen analysen',
  organizations: 'organisationen mandanten berufe',
  users: 'benutzer nutzer verwaltung konten',
  evaluations: 'wochenbewertung bewertung selbsteinschaetzung leistung',
  certificate: 'zeugnis arbeitszeugnis zertifikat',
  content_upload: 'import upload inhalte hochladen',
  hai_admin: 'hai index ki assistent',
  hai_memory: 'gedaechtnis hai',
};

/** One page a request may be about: the id, its target for the level and the names. */
export interface PageCandidate {
  id: StaticTargetId;
  path: string;
  label: string;
  reason: string;
}

/** The pages of the level whose label or words are nearest to the query. */
export function nearestPages(
  query: string,
  ids: readonly StaticTargetId[],
  level: NavigationLevel,
  limit = 3
): PageCandidate[] {
  const candidates: PageCandidate[] = [];
  for (const id of ids) {
    const target = staticTargetFor(id, level);
    if (target) candidates.push({ id, ...target });
  }
  return rankByName(
    query,
    candidates,
    candidate => `${candidate.label} ${PAGE_WORDS[candidate.id] ?? ''}`,
    limit
  );
}
