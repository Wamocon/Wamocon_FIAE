/**
 * HAI memory: cleaning and checking the text of an entry.
 *
 * Pure module. Every entry passes `checkMemoryContent` when it is created or
 * changed, and `cleanMemoryLine` once more when it goes into the prompt (a row
 * that reached the database by another way is still cleaned and checked). The
 * check is the fixed rule behind the safety sentence of the memory: an entry may
 * only describe style and emphasis, never ask for a solution, a role, another
 * occupation, a link or an instruction to the model.
 *
 * Texts are compared with folded umlauts (ae, oe, ue, ss), invisible characters
 * and accents removed, so "Musterlösung", "Musterloesung" and "Muster-lösung"
 * meet the same pattern.
 *
 * @module lib/hai/memory/text
 */

import { sanitizePromptData } from '../../prompt-sanitize';
import { isSolutionRequest } from '../solutionRequest';

/** Why an entry was turned away (a stable code, the interface says it in words). */
export type MemoryRejectReason =
  | 'empty'
  | 'too_long'
  | 'solution'
  | 'instruction'
  | 'role'
  | 'occupation'
  | 'link';

export type MemoryContentCheck =
  | { ok: true; content: string }
  | { ok: false; reason: MemoryRejectReason };

/** Lower case, umlauts as ae/oe/ue/ss, marks and invisible characters removed. */
export function foldForCheck(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '');
}

/**
 * One line of text without anything that could open a section, a list or a
 * markup in the prompt or the interface: invisible and control characters, line
 * breaks, markdown and angle brackets are gone, blanks are collapsed.
 */
export function cleanMemoryLine(text: string, maxLength = Infinity): string {
  return sanitizePromptData(String(text ?? ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\r\n\t\u2028\u2029\u0085]+/g, ' ')
    .replace(/[*`<>#\[\]{}|\\_~^]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** A request for a solution or the answers (the same rule as the gate before the model). */
const SOLUTION_WORDS = new RegExp(
  [
    'loesung',
    'bewertungsschluessel',
    'erwartungshorizont',
    'richtige[nr]?\\s+antwort',
    'korrekte[nr]?\\s+antwort',
    'antworten?\\s+(?:direkt|sofort|gleich|vorab|verrat|zeig|nenn|geb|gib|vorsag)',
    '(?:verrat|zeig|nenn|geb|gib|vorsag|sag)\\w*\\s+(?:mir\\s+)?(?:die\\s+|alle\\s+)?(?:antwort|ergebnis|schluessel|musterantwort|quizantwort)',
    'ohne\\s+(?:nachdenken|hinweise?|einschraenkung|filter|regeln|pruefung)',
    '(?:schreib|liefer|geb|gib|erstell)\\w*\\s+(?:mir\\s+)?(?:den\\s+|die\\s+|das\\s+)?(?:komplett|fertig|vollstaendig)\\w*\\s+(?:code|programm|aufgabe|quelltext|skript)',
    'komplett\\w*\\s+(?:code|programm|aufgabe)\\s+(?:schreib|liefer|geb)',
    '(?:pruefungs|quiz|test)\\s*(?:fragen\\s*)?(?:antwort|loesung)',
  ].join('|')
);

/** A sentence that talks to the model, the system or its rules. */
const INSTRUCTION_WORDS = new RegExp(
  [
    '\\bignorier',
    '\\bvergiss\\b',
    '\\bvergessen\\s+sie\\b',
    '\\b(?:system|developer|entwickler)\\s*[- ]?(?:prompt|nachricht|anweisung)',
    '\\bprompt\\b',
    '\\banweisung',
    '\\bdu\\s+bist\\s+(?:jetzt|nun|ab\\s+sofort)\\b',
    '\\btu\\s+so\\s+als\\b',
    '\\bjailbreak',
    '\\bpersona\\b',
    '\\bschutz\\w*\\b',
    '\\bberechtigung',
    '\\bfreischalt',
    '\\bfreigabe',
    '\\bzugriff',
    '\\bumgeh',
    '\\bueberschreib',
    '\\bdeaktivier',
    '\\bdebug\\b',
    '\\bentwicklermodus\\b',
    '\\bdan\\b',
    '\\bbeschraenkung',
  ].join('|')
);

/**
 * The light list for an entry that the platform built itself from a template and
 * the title of a topic (weakness, learning state): only a sentence that talks to
 * the model counts, an IT topic such as "Zugriffsrechte" is fine.
 */
const INJECTION_WORDS = new RegExp(
  [
    '\\bignorier',
    '\\bvergiss\\b',
    '\\bprompt\\b',
    '\\banweisung',
    '\\bdu\\s+bist\\s+(?:jetzt|nun|ab\\s+sofort)\\b',
    '\\btu\\s+so\\s+als\\b',
    '\\bjailbreak',
  ].join('|')
);

/** A claim about the role of the person (the role comes from the server only). */
const ROLE_WORDS =
  /\b(?:ich\s+bin|bin\s+ich|als|wie)\s+(?:der\s+|die\s+|ein\s+|eine\s+|einen\s+|euer\s+|dein\s+)?(?:trainer|ausbilder|dozent|lehrer|admin|administrator|super\s*admin|pruefer|chef|leiter)\w*|\b(?:trainer|ausbilder|admin)[\s-]*(?:rechte|modus|zugang|rolle)\b/;

/** The names of the occupations of the platform: an entry never points at another one. */
const OCCUPATION_WORDS =
  /\b(?:fiae|kfbm|fachinformatiker\w*|anwendungsentwicklung|kauf(?:mann|frau|leute)\w*|bueromanagement|anderen?\s+beruf\w*|anderer\s+beruf\w*|fremden?\s+beruf\w*|jeden?\s+beruf\w*|alle\s+berufe)\b/;

/** A link, an address or a markdown link. */
const LINK_PATTERN =
  /(?:https?:\/\/|\bwww\.|\bftp:\/\/|\]\s*\(|\bmailto:|\b[a-z0-9-]+\.(?:com|de|org|net|io|ai)\b)/;

/**
 * Checks and cleans the text of an entry. The result is the cleaned text or the
 * reason it was turned away. `maxLength` is the limit of the kind of entry; a
 * longer text is turned away, never cut off silently.
 *
 * `extraBlocked` are further words to keep out (for example the names of the
 * other occupations of a persona), compared folded. `derived` is for an entry
 * the platform built from a template and a topic title: it gets the light list
 * (link, solution, a sentence to the model), not the strict one.
 */
export function checkMemoryContent(
  text: unknown,
  maxLength: number,
  options: { extraBlocked?: readonly string[]; derived?: boolean } = {}
): MemoryContentCheck {
  if (typeof text !== 'string') return { ok: false, reason: 'empty' };
  const content = cleanMemoryLine(text);
  if (content === '') return { ok: false, reason: 'empty' };
  if (content.length > maxLength) return { ok: false, reason: 'too_long' };

  const folded = foldForCheck(text);
  if (LINK_PATTERN.test(folded)) return { ok: false, reason: 'link' };
  if (
    SOLUTION_WORDS.test(folded) ||
    isSolutionRequest(text) ||
    isSolutionRequest(content)
  ) {
    return { ok: false, reason: 'solution' };
  }
  if (options.derived) {
    if (INJECTION_WORDS.test(folded)) {
      return { ok: false, reason: 'instruction' };
    }
    return { ok: true, content };
  }
  if (ROLE_WORDS.test(folded)) return { ok: false, reason: 'role' };
  if (INSTRUCTION_WORDS.test(folded)) {
    return { ok: false, reason: 'instruction' };
  }
  if (OCCUPATION_WORDS.test(folded)) {
    return { ok: false, reason: 'occupation' };
  }
  const extraBlocked = options.extraBlocked ?? [];
  for (const word of extraBlocked) {
    const needle = foldForCheck(word).trim();
    if (needle.length >= 3 && folded.includes(needle)) {
      return { ok: false, reason: 'occupation' };
    }
  }
  return { ok: true, content };
}
