/**
 * HAI memory: recognises an EXPLICIT statement about a preference in a message of
 * the user (pattern matching in German, no model call).
 *
 * "antworte kürzer", "bitte duzen", "erklär mir das mit Beispielen", "ich lerne
 * besser mit Karten": the user says it about himself, so the HAI may ask whether
 * it should be remembered. An uncertain case produces NOTHING:
 *  - a question ("Wie antworte ich kürzer?", "Was heißt duzen?"),
 *  - a negation, a condition or a doubt next to the pattern ("nicht kürzer",
 *    "wenn du magst", "vielleicht"),
 *  - a quotation or a long text (a pasted text is no statement),
 *  - two contradicting statements about the same thing ("kürzer und ausführlicher").
 *
 * The text of the entry NEVER comes from the message: it comes from the fixed
 * template of the pattern, so nothing a person typed can reach the memory, and the
 * entry is always about style, never about content. Pure module.
 *
 * @module lib/hai/memory/memoryDetect
 */

import { DETECT_MAX_MESSAGE_CHARS } from './config';
import { foldForCheck } from './text';

export type DetectedKind = 'preference' | 'learning_style';

export interface MemoryCandidate {
  kind: DetectedKind;
  /** Stable key, also the dimension: `pref.length.short` has the dimension `pref.length`. */
  key: string;
  /** The fixed template text of the entry. */
  content: string;
}

interface Pattern {
  kind: DetectedKind;
  key: string;
  content: string;
  /** Matched against the folded message (ae, oe, ue, ss). */
  test: RegExp;
}

const POLITE = String.raw`(?:bitte\s+|mal\s+|doch\s+|ruhig\s+)*`;
const AMOUNT = String.raw`(?:etwas\s+|viel\s+|immer\s+|generell\s+|grundsaetzlich\s+|ab\s+jetzt\s+|kuenftig\s+|in\s+zukunft\s+)*`;

/** The patterns, in the order the candidates are offered. */
const PATTERNS: readonly Pattern[] = [
  {
    kind: 'preference',
    key: 'pref.length.short',
    content: 'Bevorzugt kurze, knappe Antworten.',
    test: new RegExp(
      [
        String.raw`\b(?:antworte|antwortet|antworten|schreib|schreibe|erklaer|erklaere|fass|fasse|sag|sage)\w*\s+${POLITE}(?:(?:etwas\s+|viel\s+)?(?:kuerzer|knapper|praegnanter)|(?:immer|generell|grundsaetzlich|ab\s+jetzt|kuenftig|in\s+zukunft)\s+kurz)\b`,
        String.raw`\b(?:halt|halte)\s+dich\s+${POLITE}${AMOUNT}kurz\b`,
        String.raw`\bfass\s+dich\s+${POLITE}${AMOUNT}kurz\b`,
        String.raw`\b(?:ich\s+(?:moechte|will|haette\s+gern|haette\s+gerne|brauche|bevorzuge|mag)|gib\s+mir|gerne|bitte)\s+${AMOUNT}(?:kurze|knappe|kuerzere)\s+antworten\b`,
        String.raw`\bnicht\s+so\s+lang(?:e|atmig)?\s+antworten\b`,
      ].join('|')
    ),
  },
  {
    kind: 'preference',
    key: 'pref.length.long',
    content: 'Bevorzugt ausführliche, detaillierte Antworten.',
    test: new RegExp(
      [
        String.raw`\b(?:antworte|antwortet|antworten|schreib|schreibe|erklaer|erklaere)\w*\s+${POLITE}${AMOUNT}(?:ausfuehrlicher|detaillierter|genauer|ausfuehrlich|detailliert)\b`,
        String.raw`\b(?:ich\s+(?:moechte|will|haette\s+gern|haette\s+gerne|brauche|bevorzuge|mag)|gib\s+mir|gerne|bitte)\s+${AMOUNT}(?:ausfuehrliche|detaillierte|genauere)\s+antworten\b`,
      ].join('|')
    ),
  },
  {
    kind: 'preference',
    key: 'pref.address.du',
    content: 'Möchte mit Du angesprochen werden.',
    test: new RegExp(
      [
        String.raw`\b(?:bitte\s+)?(?:duze|duz|duzen|duzt)\s+(?:mich|uns)\b`,
        String.raw`\b(?:bitte|gern|gerne)\s+(?:mich\s+|uns\s+)?duzen\b`,
        String.raw`\bdu\s+kannst\s+(?:mich|uns)\s+(?:gern|gerne|ruhig)?\s*duzen\b`,
        String.raw`\bsag\s+(?:ruhig\s+|bitte\s+)?du\s+zu\s+mir\b`,
        String.raw`\bsprich\s+mich\s+(?:bitte\s+)?mit\s+du\s+an\b`,
      ].join('|')
    ),
  },
  {
    kind: 'preference',
    key: 'pref.address.sie',
    content: 'Möchte mit Sie angesprochen werden.',
    test: new RegExp(
      [
        String.raw`\b(?:bitte\s+)?(?:siez|siezen|siezt)\s+(?:mich|uns)\b`,
        String.raw`\b(?:bitte|gern|gerne)\s+(?:mich\s+|uns\s+)?siezen\b`,
        String.raw`\bsprich\s+mich\s+(?:bitte\s+)?mit\s+sie\s+an\b`,
        String.raw`\bsprechen\s+sie\s+mich\s+(?:bitte\s+)?mit\s+sie\s+an\b`,
        String.raw`\bsag\s+(?:bitte\s+)?sie\s+zu\s+mir\b`,
      ].join('|')
    ),
  },
  {
    kind: 'preference',
    key: 'pref.explain.examples',
    content: 'Versteht Erklärungen am besten mit Beispielen.',
    test: new RegExp(
      [
        String.raw`\berklaer\w*\s+(?:mir\s+)?(?:das\s+|es\s+|dies\s+)?${POLITE}${AMOUNT}(?:mit|an|anhand)\s+(?:einem\s+|einer\s+|konkreten\s+|praktischen\s+|vielen\s+)?beispiel\w*\b`,
        String.raw`\bgib\s+(?:mir\s+)?${POLITE}(?:mehr|immer|noch\s+mehr)\s+beispiele\b`,
        String.raw`\b(?:mit|anhand\s+von)\s+beispielen?\s+(?:bitte|erklaeren|erklaert)\b`,
      ].join('|')
    ),
  },
  {
    kind: 'preference',
    key: 'pref.explain.steps',
    content: 'Möchte Erklärungen Schritt für Schritt.',
    test: new RegExp(
      [
        String.raw`\berklaer\w*\s+(?:mir\s+)?(?:das\s+|es\s+|dies\s+)?${POLITE}${AMOUNT}(?:schritt\s+fuer\s+schritt|in\s+kleinen\s+schritten|schrittweise)\b`,
        String.raw`\b(?:bitte\s+)?immer\s+schritt\s+fuer\s+schritt\b`,
      ].join('|')
    ),
  },
  {
    kind: 'preference',
    key: 'pref.explain.simple',
    content: 'Möchte Erklärungen in einfachen Worten.',
    test: new RegExp(
      [
        String.raw`\berklaer\w*\s+(?:mir\s+)?(?:das\s+|es\s+|dies\s+)?${POLITE}${AMOUNT}(?:einfacher|ganz\s+einfach|in\s+einfachen\s+worten|in\s+einfacher\s+sprache|verstaendlicher)\b`,
        String.raw`\bin\s+einfachen\s+worten\s+(?:bitte|erklaeren)\b`,
      ].join('|')
    ),
  },
  {
    kind: 'learning_style',
    key: 'style.form.cards',
    content: 'Lernt besser mit Lernkarten.',
    test: /\bich\s+lerne\s+(?:viel\s+|deutlich\s+)?(?:besser|am\s+besten|lieber)\s+(?:mit|durch)\s+(?:karteikarten|lernkarten|karten|flashcards)\b/,
  },
  {
    kind: 'learning_style',
    key: 'style.form.quiz',
    content: 'Lernt besser mit Quizfragen.',
    test: /\bich\s+lerne\s+(?:viel\s+|deutlich\s+)?(?:besser|am\s+besten|lieber)\s+(?:mit|durch)\s+(?:quiz|quizfragen|quizzen|fragen)\b/,
  },
  {
    kind: 'learning_style',
    key: 'style.form.practice',
    content: 'Lernt besser durch praktisches Ausprobieren.',
    test: /\bich\s+lerne\s+(?:viel\s+|deutlich\s+)?(?:besser|am\s+besten|lieber)\s+(?:mit|durch)\s+(?:praxis|praktische\w*\s+\w+|ausprobieren|uebungsaufgaben|aufgaben)\b/,
  },
  {
    kind: 'learning_style',
    key: 'style.form.visual',
    content: 'Lernt besser mit Skizzen und Diagrammen.',
    test: /\bich\s+lerne\s+(?:viel\s+|deutlich\s+)?(?:besser|am\s+besten|lieber)\s+(?:mit|durch)\s+(?:bildern|skizzen|diagrammen|grafiken|zeichnungen)\b/,
  },
  {
    kind: 'learning_style',
    key: 'style.input.voice',
    content: 'Spricht lieber mit der HAI, als zu tippen.',
    test: /\bich\s+(?:spreche|rede|diktiere)\s+(?:viel\s+)?(?:lieber|gern|gerne)\b|\bich\s+(?:tippe|schreibe)\s+(?:nicht\s+so\s+)?ungern\b/,
  },
  {
    kind: 'learning_style',
    key: 'style.input.text',
    content: 'Tippt lieber, als zu sprechen.',
    test: /\bich\s+(?:tippe|schreibe)\s+(?:viel\s+)?(?:lieber|gern|gerne)\b|\bich\s+(?:spreche|rede)\s+(?:nicht\s+so\s+)?ungern\b/,
  },
];

/** The first word of a question: such a message is no statement. */
const QUESTION_START =
  /^\s*(?:was|wie|warum|wieso|weshalb|wozu|wer|wann|wo|woher|welche[rsmn]?|kannst\s+du\s+mir\s+erklaeren|kann\s+man|gibt\s+es|ist\s+es|darf\s+ich)\b/;

/** A doubt, a condition or a wish that is not meant: no proposal. */
const UNSURE =
  /\b(?:wenn|falls|vielleicht|eventuell|eigentlich|koennte|koennten|wuerde|wuerdest|angenommen|stell\s+dir\s+vor|hypothetisch|zum\s+beispiel\s+wenn|spaeter\s+mal|manchmal|teilweise|sagt|sagte|meint|meinte|laut|behauptet|fragt|fragte)\b/;

/** A negation in front of the matched words. */
const NEGATION_BEFORE =
  /\b(?:nicht|nie|niemals|kein|keine|keinen|ohne|auf\s+keinen\s+fall|bloss\s+nicht)\s+(?:\w+\s+){0,3}$/;

/** The dimension of a key: `pref.length.short` -> `pref.length`. */
export function dimensionOf(key: string): string {
  const index = key.lastIndexOf('.');
  return index > 0 ? key.slice(0, index) : key;
}

/** A quotation of the pattern, not a statement: "erkläre mit Beispielen" in quotes. */
function hasQuote(message: string): boolean {
  return /["„“”«»‚‘’]/.test(message) || /'[^']{4,}'/.test(message);
}

/**
 * The candidates of one message, in the order of the patterns, at most one per
 * dimension. Nothing for a question, a doubt, a negation, a quotation, a long
 * text, or when two patterns of the same dimension contradict each other.
 */
export function detectMemoryCandidates(message: string): MemoryCandidate[] {
  if (typeof message !== 'string') return [];
  const trimmed = message.trim();
  if (trimmed === '' || trimmed.length > DETECT_MAX_MESSAGE_CHARS) return [];
  if (hasQuote(trimmed)) return [];

  const folded = foldForCheck(trimmed);
  if (folded.includes('?')) return [];
  if (QUESTION_START.test(folded)) return [];
  if (UNSURE.test(folded)) return [];

  const hits: Pattern[] = [];
  for (const pattern of PATTERNS) {
    const match = pattern.test.exec(folded);
    if (!match) continue;
    // a negation in front of the matched words: not a statement
    const before = folded.slice(0, match.index);
    if (NEGATION_BEFORE.test(before)) continue;
    // a negation inside the matched words ("nicht so lange Antworten" is itself a pattern)
    hits.push(pattern);
  }

  // two patterns of the same dimension contradict each other: unsure, so nothing
  const perDimension = new Map<string, Pattern[]>();
  for (const hit of hits) {
    const list = perDimension.get(dimensionOf(hit.key)) ?? [];
    list.push(hit);
    perDimension.set(dimensionOf(hit.key), list);
  }
  const out: MemoryCandidate[] = [];
  for (const hit of hits) {
    const list = perDimension.get(dimensionOf(hit.key)) ?? [];
    if (list.length !== 1) continue;
    out.push({ kind: hit.kind, key: hit.key, content: hit.content });
  }
  return out;
}
