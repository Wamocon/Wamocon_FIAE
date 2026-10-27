// Pattern checks of an excerpt (docs/ki-upload-konzept.md, 5.3 and 6.5): personal
// data, instruction text for a model, signs of a customer document and the
// marker words of a solution. Pure functions on text.
//
// All patterns are written so that their running time is linear in the text:
// bounded quantifiers, no nested repetition, lookarounds that stop a run of
// digits or letters from starting a match at every position. The texts that
// reach them are short (an excerpt, or one paragraph at a time), but a hostile
// file decides what is in them, so the tests feed every function long hostile
// input.
//
// These are blocklists. They reduce what leaves the platform, they do not
// prove that nothing leaves it. The owner has decided that this is what is
// built (O7), the Restrisiko is named in the concept.

import { SOLUTION_MARKERS } from '../content-import/apply/guard';

import { foldConfusables } from './text-clean';

// --- Personal data -----------------------------------------------------------

export interface Redaction {
  text: string;
  /** E-mail, IBAN, telephone, tax number, name: counts for the threshold. */
  personal: number;
  /** Links and file names: replaced, but no personal data. */
  other: number;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]{1,300}/gi;
const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g;
const IBAN_PATTERN =
  /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/gi;
const TAX_PATTERNS = [
  /\bDE ?\d{9}\b/g,
  /(?<![\d/])\d{2,3}\/\d{3}\/\d{4,5}(?![\d/])/g,
];
const PHONE_PATTERNS = [
  /(?<![\w+])(?:\+|00)[1-9]\d{0,2}[\s./()-]{0,3}(?:\d[\s./()-]{0,2}){6,12}\d(?!\d)/g,
  /(?<![\d\w])\(?0\d{2,5}\)?[\s/.-]{0,2}\d(?:[\s/.-]{0,2}\d){5,9}(?!\d)/g,
];
// A form of address (Herr, Frau, Dr., Prof.) and one to three names that start
// with a capital letter: "Frau Dr. Anna Schmidt-Meier", "Sehr geehrter Herr X".
const NAME_PATTERN =
  /(?<!\p{L})(?:Sehr\s+geehrte[rs]?\s+)?(?:(?:Herrn?|Frau|Fr\.|Hr\.|Prof\.|Dr\.)\s+){1,3}[A-ZÄÖÜ][\p{L}'-]{1,30}(?:\s+[A-ZÄÖÜ][\p{L}'-]{1,30}){0,2}/gu;
const FILE_NAME_PATTERN =
  /(?<![\p{L}\p{N}_.-])[\p{L}\p{N}_.-]{1,80}\.(?:docx?|pdf|xlsx?|pptx?|zip|msg|eml)(?![\p{L}\p{N}])/giu;

/**
 * Replaces the personal patterns by a placeholder and counts them. Links and
 * file names are replaced too (a file name can hold a customer name or a text
 * that speaks to a model) and counted apart.
 */
export function redactPersonalData(input: string): Redaction {
  let text = input;
  let personal = 0;
  let other = 0;
  const replace = (
    pattern: RegExp,
    placeholder: string,
    kind: 'personal' | 'other'
  ) => {
    text = text.replace(pattern, () => {
      if (kind === 'personal') personal += 1;
      else other += 1;
      return placeholder;
    });
  };
  replace(URL_PATTERN, '[Link]', 'other');
  replace(EMAIL_PATTERN, '[E-Mail]', 'personal');
  replace(IBAN_PATTERN, '[IBAN]', 'personal');
  for (const pattern of TAX_PATTERNS)
    replace(pattern, '[Steuer-ID]', 'personal');
  for (const pattern of PHONE_PATTERNS)
    replace(pattern, '[Telefon]', 'personal');
  replace(NAME_PATTERN, '[Name]', 'personal');
  replace(FILE_NAME_PATTERN, '[Datei]', 'other');
  return { text, personal, other };
}

// --- Instruction text --------------------------------------------------------

const INSTRUCTION_PATTERNS: Array<[code: string, pattern: RegExp]> = [
  [
    'IGNORE_DE',
    /\bignorier(?:e|t|en\s+sie)\s+(?:bitte\s+)?(?:alle[sn]?|die|diese[n]?|deine?|vorherige[n]?|bisherige[n]?|obige[n]?|sämtliche|jede)\b/i,
  ],
  [
    'IGNORE_EN',
    /\bignore\s+(?:all|any|the|previous|prior|above|your|these|those)\b/i,
  ],
  [
    'FORGET_DE',
    /\bvergiss\b.{0,40}\b(?:alles|anweisung|regeln|vorherig|bisherig)/i,
  ],
  ['FORGET_EN', /\bforget\s+(?:everything|all|your|previous|the|what)\b/i],
  ['SYSTEM_PROMPT', /\bsystem[\s-]?prompt\b|\bsystemnachricht\b/i],
  ['ANSWER_ONLY_DE', /\bantworte\s+(?:nur|ausschlie(?:ß|ss)lich|immer|mit)\b/i],
  [
    'ANSWER_ONLY_EN',
    /\b(?:answer|respond|reply|output)\s+(?:only|exclusively)\b/i,
  ],
  ['ROLE_DE', /\bdu\s+bist\s+(?:jetzt|nun|ab\s+sofort)\b/i],
  ['ROLE_EN', /\byou\s+are\s+now\b/i],
  ['NEW_RULES_DE', /\bneue[n]?\s+anweisung(?:en)?\b/i],
  ['NEW_RULES_EN', /\bnew\s+(?:instructions?|rules?)\b/i],
  [
    'CLASSIFY_AS_DE',
    /\bordne\b[^.\n]{0,40}\b(?:als|zu)\s+(?:K\s?\d|quiz|szenario|enabler|use)/i,
  ],
  [
    'CLASSIFY_AS_EN',
    /\bclassify\s+(?:this|the|that)\s+(?:file|document|text)\s+as\b/i,
  ],
  [
    'OVERRIDE',
    /\b(?:disregard|override|bypass)\b[^.\n]{0,30}\b(?:instruction|rule|prompt|polic)/i,
  ],
  ['CHAT_MARKUP', /<\|[a-z_]{2,20}\|>|\[\/?INST\]/i],
  ['DELIMITER', /AUSZUG-[0-9a-f]{8,}/i],
  ['JAILBREAK', /\bjailbreak\b|\bprompt\s+injection\b/i],
];

/**
 * Codes of the instruction patterns found in a text: typical wording of an
 * instruction to a model. Text for a model that holds such wording is not
 * sent. A blocklist, not a protection, the protection is the check of the
 * answer (6.4).
 */
export function findInstructionText(text: string): string[] {
  const folded = foldConfusables(text);
  return INSTRUCTION_PATTERNS.filter(([, pattern]) => pattern.test(folded)).map(
    ([code]) => code
  );
}

// --- Customer documents ------------------------------------------------------

const LEGAL_FORM = /\b(?:GmbH|mbH|AG|KG|UG|OHG|GbR|e\.\s?V\.)(?![\p{L}\p{N}])/u;
const POSTAL_CODE = /(?<!\d)\d{5}\s+\p{Lu}\p{L}{2,}/u;
const STREET =
  /\b\p{Lu}[\p{L}-]{2,30}(?:stra(?:\u{df}|ss)e|str\.|weg|platz|allee|gasse|ring|damm)\s+\d{1,4}[a-z]?(?![\p{L}\p{N}])/u;

// A sign counts when it carries a VALUE, not when the word only stands in a
// text. Teaching text speaks about the IBAN, the tax number and the customer
// number all the time ("Die IBAN besteht aus 22 Zeichen"), a customer
// document has "Rechnungsnummer: R-2026-0815" and "IBAN DE89 3704 ...".
/** A value after a label: a few characters and a digit, no further than a few. */
const VALUE = String.raw`[\s:.#-]{0,4}[A-Za-z0-9/_.-]{0,12}\d`;

const CUSTOMER_PATTERNS: Array<[cls: string, pattern: RegExp]> = [
  [
    'invoice',
    new RegExp(
      String.raw`\b(?:Rechnungs(?:nummer|[\s-]?nr\.?)|Rechnung\s+Nr\.?|Invoice\s+(?:No|Number|#))${VALUE}`,
      'i'
    ),
  ],
  [
    'customer_id',
    new RegExp(
      String.raw`\b(?:Kunden|Mandanten|Debitoren|Vertrags|Auftrags|Bestell|Angebots|Lieferschein)(?:nummer|[\s-]?nr\.?)${VALUE}`,
      'iu'
    ),
  ],
  [
    'tax_register',
    /\bDE ?\d{9}\b|(?<![\d/])\d{2,3}\/\d{3}\/\d{4,5}(?![\d/])|\bHR[AB]\s?\d{2,7}\b/i,
  ],
  // an IBAN (the pattern of the personal data, without the global flag)
  ['bank', new RegExp(IBAN_PATTERN.source, 'i')],
  [
    'bank',
    new RegExp(String.raw`\b(?:Kontonummer|Konto[\s-]?Nr\.?|BLZ)${VALUE}`, 'i'),
  ],
];
const LETTER_SALUTATION =
  /\bSehr\s+geehrte[rs]?\s+(?:Damen\s+und\s+Herren|Frau|Herr)\b/i;
const LETTER_CLOSING =
  /\b(?:Mit\s+freundlichen\s+Gr(?:ü|ue)(?:ß|ss)en|Hochachtungsvoll)\b/i;
const MANAGING_DIRECTOR = /Gesch(?:ä|ae)ftsf(?:ü|ue)hr(?:er|erin|ung)\s*:/i;
/**
 * The own letterhead of the platform owner. It stands in the own documents (also
 * the source files of the courses) and is no sign of a customer document.
 */
const OWN_LETTERHEAD =
  /WAMOCON\s+GmbH\s*,?\s*Mergenthalerallee\s+79\s*-\s*81\s*,?\s*65760\s+Eschborn/gi;
const MAX_LINES = 5000;
const MAX_LINE_CHARS = 2000;

/**
 * True for a line that is nothing but the own letterhead: the page header that
 * every page of an own PDF repeats. Such a line is no part of the text of the
 * document, and as the first line it would hide the heading from the parsers.
 */
export function isOwnLetterheadLine(line: string): boolean {
  const probe = foldConfusables(line.slice(0, MAX_LINE_CHARS));
  const rest = probe.replace(OWN_LETTERHEAD, '');
  return rest !== probe && rest.replace(/[\s,.;:|-]/g, '') === '';
}

/**
 * The classes of customer document signs a text shows, each with a value: an
 * invoice number, a customer or order number, a tax or register number, an
 * IBAN or account number, a letter (salutation and closing), a letterhead
 * (legal form with a postal code, a managing director line or a street with a
 * postal code). The own letterhead of the owner is ignored. One class alone is
 * common in teaching text, two or more are a customer document (decided by the
 * caller).
 */
export function customerDocumentClasses(text: string): string[] {
  const found = new Set<string>();
  let salutation = false;
  let closing = false;
  const lines = foldConfusables(text).split('\n').slice(0, MAX_LINES);
  for (const raw of lines) {
    const line = raw.slice(0, MAX_LINE_CHARS).replace(OWN_LETTERHEAD, ' ');
    for (const [cls, pattern] of CUSTOMER_PATTERNS) {
      if (!found.has(cls) && pattern.test(line)) found.add(cls);
    }
    if (LETTER_SALUTATION.test(line)) salutation = true;
    if (LETTER_CLOSING.test(line)) closing = true;
    if (found.has('letterhead')) continue;
    const plz = POSTAL_CODE.test(line);
    if (
      (plz && (LEGAL_FORM.test(line) || STREET.test(line))) ||
      MANAGING_DIRECTOR.test(line)
    ) {
      found.add('letterhead');
    }
  }
  if (salutation && closing) found.add('letter');
  return [...found];
}

// --- Marker words of a solution ---------------------------------------------

// A marker found anywhere in a text, as the views for trainees refuse them
// (toTraineeQuiz, toTraineeScenario, toTraineeUseCase) plus the variants the
// concept names. Stricter than the list of the guard on purpose: an excerpt is
// short and leaves the platform, a harmless line that is cut is cheap.
const MARKER_ANYWHERE: RegExp[] = [
  /Richtige\s+Antwort/i,
  /Kurzbegr(?:ü|ue)ndung/i,
  /L(?:ö|oe)sungs?szenario/i,
  /Fachwissen\s+zur\s+L(?:ö|oe)sung/i,
  /Musterl(?:ö|oe)sung/i,
  /Korrekte\s+Antwort/i,
  /Antwortschl(?:ü|ue)ssel/i,
  /L(?:ö|oe)sungsvorschlag/i,
  /^[^\S\n]*Bewertungskriterien[^\S\n]*(?::[^\S\n]*)?$/im,
  /^[^\S\n]*L(?:ö|oe)sung[^\S\n]*(?::[^\S\n]*)?$/im,
  // Labels of an answer or an explanation at the start of a line, German and English
  /^[^\S\n]*(?:Antwort|Richtig|Korrekt|Erkl(?:ä|ae)rung|Begr(?:ü|ue)ndung|Correct[^\S\n]+answer|Answer|Solution|Rationale|Explanation)[^\S\n]*:/im,
  /\bAnswer[^\S\n]+key\b/i,
  /\bCorrect[^\S\n]+answer\b/i,
];

/** True when a text shows a marker word of a solution. */
export function hasSolutionMarker(text: string): boolean {
  const folded = foldConfusables(text);
  return (
    MARKER_ANYWHERE.some(marker => marker.test(folded)) ||
    SOLUTION_MARKERS.some(marker => marker.test(folded))
  );
}
