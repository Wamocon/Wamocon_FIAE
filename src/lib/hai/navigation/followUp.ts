/**
 * The follow-up request without a new target: "dann bring mich dahin", "du
 * navigierst", "öffne die Seite", "ja", "mach das".
 *
 * Such a sentence names no page. Which page is meant comes from the history of
 * the session, on the server and deterministically (never from the model): the
 * page the last turns were about, either because the person named it or
 * because the platform offered it (a question for the own trainees comes with
 * the card "Auszubildende"). Only when the history holds exactly one page the
 * request is carried out, and it still goes through the allow list and the
 * level of the person (resolve.ts). Without a clear page the platform asks
 * where to go, with two or three pages of the level as examples.
 *
 * The history is the text of the earlier messages of the session. It gives no
 * right: the path always comes from the allow list for the level of the
 * person, so a trainee never gets a page of the trainer area.
 *
 * Pure module without server imports.
 *
 * @module lib/hai/navigation/followUp
 */

import {
  historyText,
  resolveDataIntent,
  type HistoryTurnMessage,
} from '../dataIntent';
import { foldText } from './fold';
import { detectNavigationIntent, mentionedTargets } from './intent';
import {
  staticTargetFor,
  type NavigationLevel,
  type StaticTargetId,
} from './targets';

/**
 * What the follow-up is: a clear request to be taken there ("command"), or a
 * short agreement ("confirm": "ja", "mach das"), which only counts right after
 * an answer that offered a page.
 */
export type FollowUpKind = 'command' | 'confirm';

/** A follow-up is short. */
const MAX_LENGTH = 90;

/** Not a request to go anywhere: an explanation, a solution, a content question. */
const NOT_A_FOLLOW_UP =
  /\b(?:erklaer\w*|was\s+ist|was\s+sind|wie\s+funktioniert|loesung\w*|schreib\w*|programmier\w*)\b/;

/**
 * Clear requests to be taken to "the" page, folded text. They carry no name of
 * a page (a text with a name goes through detectNavigationIntent first).
 */
const COMMAND_PATTERNS: readonly RegExp[] = [
  // "bring mich dahin", "fuehr mich bitte hin", "nimm mich mit", "lotse mich dorthin"
  /\b(?:bring|bringe|bringst|fuehr|fuehre|fuehrst|leit|leite|leitest|nimm|nehm\w*|lotse|lotsen|schick\w*)\s+(?:\w+\s+){0,2}(?:mich|uns)\s+(?:\w+\s+){0,2}(?:hin|dahin|dorthin|mit)\b/,
  // "kannst du mich dahin bringen", "du kannst mich doch durch das System fuehren"
  /\b(?:mich|uns)\b(?:\s+\w+){0,3}\s+(?:hinbringen|hinfuehren|dahin|dorthin|hin)\b/,
  /\b(?:mich|uns)\b(?:\s+\w+){0,4}\s+durch\s+(?:das|die|den|dieses)\s+(?:system|plattform|menue\w*|seiten)\b/,
  /\bdurch\s+(?:das|die)\s+(?:system|plattform)\s+(?:fuehren|navigieren|leiten|gehen)\b/,
  // "du navigierst", "du fuehrst mich", "du oeffnest sie"
  /\bdu\s+(?:navigierst|fuehrst|bringst|oeffnest|leitest|gehst|machst)\b/,
  // "navigier du", "navigiere bitte", "fuehre du mich"
  /\bnavigier(?:e|en)?\s+(?:du|bitte|mich|uns|sie|es|jetzt|mal|doch)\b/,
  // "oeffne die Seite", "oeffne sie", "mach sie auf", "ruf die Seite auf"
  /\b(?:oeffne|oeffnen|oeffnest)\s+(?:(?:bitte|doch|mal|jetzt|dann)\s+)*(?:die\s+seite|diese\s+seite|seite|sie|es|das|diese|dieses)(?:\s+(?:bitte|doch|mal|jetzt|sofort|auf|dann))*$/,
  /\b(?:mach|mache|ruf|rufe)\s+(?:\w+\s+){0,2}(?:die\s+seite|diese\s+seite|seite|sie|es|das)\s+(?:\w+\s+){0,2}auf\b/,
  /\bwie\s+komme\s+ich\s+(?:\w+\s+)?(?:dahin|dorthin|hin)\b/,
];

/**
 * A short agreement: "ja", "ja bitte", "gern", "mach das", "okay mach", "los",
 * "oeffnen", "ja oeffne sie". Folded text, whole message.
 */
const CONFIRM_PATTERN =
  /^(?:(?:ja|jap|jo|ok|okay|gern|gerne|klar|genau|bitte|los|dann|mach|mache|tu|tue|das|es|mal|doch|sehr|gut|super|oeffne|oeffnen|sie|dort|dahin|hin|aber|natuerlich|selbstverstaendlich)\s*){1,5}$/;

/** How many earlier questions of the person are looked at for the page. */
const HISTORY_TURNS = 3;

/** An answer that offered or named a page: the words a "ja" can refer to. */
const OFFER_CUE =
  /\b(?:oeffn\w*|menuepunkt\w*|navigier\w*|seite|karte|knopf|hinfuehr\w*|dorthin|dahin)\b/;

/** The kind of the follow-up in the message, or null when it is none. */
export function detectNavigationFollowUp(message: string): FollowUpKind | null {
  if (typeof message !== 'string') return null;
  const text = foldText(message);
  if (!text || text.length > MAX_LENGTH) return null;
  if (NOT_A_FOLLOW_UP.test(text)) return null;
  if (COMMAND_PATTERNS.some(pattern => pattern.test(text))) return 'command';
  if (CONFIRM_PATTERN.test(text)) return 'confirm';
  return null;
}

/** The last answer of the platform offered or named a page (what a "ja" answers). */
export function lastAnswerOfferedPage(
  history: readonly HistoryTurnMessage[] | undefined
): boolean {
  if (!history) return false;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') continue;
    return OFFER_CUE.test(foldText(historyText(history[i])));
  }
  return false;
}

/**
 * The pages the last turns were about, newest turn first, up to three turns
 * back. The first turn that names or offers a page decides:
 *  - a question for the own trainees (the platform put the card "Auszubildende"
 *    under that answer; only for the trainer levels),
 *  - the page the person named in the question (a navigation request),
 *  - the pages the answer talks about (menu names and words for them).
 * More than one page in that turn means "not clear".
 */
export function targetsFromHistory(
  history: readonly HistoryTurnMessage[] | undefined,
  level: NavigationLevel
): StaticTargetId[] {
  if (!history || history.length === 0) return [];
  const questionIndexes: number[] = [];
  history.forEach((message, index) => {
    if (message.role === 'user') questionIndexes.push(index);
  });
  for (const index of questionIndexes.slice(-HISTORY_TURNS).reverse()) {
    const question = historyText(history[index]);
    const answer =
      history[index + 1] && history[index + 1].role !== 'user'
        ? historyText(history[index + 1])
        : '';

    if (
      level !== 'TRAINEE' &&
      resolveDataIntent(question, 'TRAINER', history.slice(0, index)) ===
        'trainee_overview'
    ) {
      return ['trainees'];
    }

    const found = new Set<StaticTargetId>();
    const named = detectNavigationIntent(question);
    if (named?.kind === 'static') found.add(named.target);
    for (const target of mentionedTargets(answer)) found.add(target);
    if (found.size > 0) return Array.from(found);
  }
  return [];
}

/** Pages of a level that are a good example when the platform asks where to go. */
const EXAMPLES: Readonly<Record<NavigationLevel, readonly StaticTargetId[]>> = {
  TRAINEE: ['dashboard', 'activity_reports', 'courses'],
  TRAINER: ['trainees', 'reviews', 'dashboard'],
  ADMIN: ['trainees', 'reviews', 'dashboard'],
};

/** "A, B oder C" from the labels of pages the level may open. */
function labelList(
  ids: readonly StaticTargetId[],
  level: NavigationLevel
): string[] {
  const labels: string[] = [];
  for (const id of ids) {
    const target = staticTargetFor(id, level);
    if (target && !labels.includes(target.label)) labels.push(target.label);
  }
  return labels.slice(0, 3);
}

function joinOr(labels: readonly string[]): string {
  return labels.length > 1
    ? `${labels.slice(0, -1).join(', ')} oder ${labels[labels.length - 1]}`
    : (labels[0] ?? 'Dashboard');
}

/**
 * The question back when the history holds no clear page (none or several):
 * short, with two or three pages of the level as examples. Several candidates
 * of the history come first (limited to the pages of the level), the examples
 * of the level fill up. No path and no card: the person names the page, the
 * platform opens it.
 */
export function askWhereToText(
  candidates: readonly StaticTargetId[],
  level: NavigationLevel
): string {
  const fromHistory = labelList(candidates, level);
  const labels =
    fromHistory.length >= 2 ? fromHistory : labelList(EXAMPLES[level], level);
  return `Gern, wohin soll ich dich führen? Zum Beispiel zu ${joinOr(labels)}. Sage mir den Namen des Menüpunkts, dann öffnet die Plattform die Seite sofort.`;
}
