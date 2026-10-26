// Reads the text of a cell of the mapping table (phase 4.5): the learning field
// references of a school year column ("LF 2,3", "alle Lernfelder", "nur
// betrieblich") and cleans cell text. Pure functions, no file access.
//
// Rules: nothing is guessed. A cell that is not one of the known forms is
// "unparseable" and is reported by the caller, a number outside 1 to 13 is
// handed back as invalid and never turned into another number.

import { LEARNING_FIELD_COUNT } from './model';

export type LearningFieldRefs =
  | { kind: 'empty' }
  /** "alle Lernfelder": all learning fields of the school year of the column. */
  | { kind: 'all' }
  /** "nur betr./beh.", "nur betrieblich": taught in the company only. */
  | { kind: 'company-only' }
  | {
      kind: 'numbers';
      /** Valid numbers (1 to 13), unique, in the order of the cell. */
      numbers: number[];
      /** Numbers outside 1 to 13. */
      invalid: number[];
    }
  | { kind: 'unparseable' };

// Control characters (also the escaped form _x0002_ of a spreadsheet), the soft
// hyphen, zero width characters and the byte order mark.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­​-‍﻿]/g;
const ESCAPED_CONTROL = /_x[0-9a-fA-F]{4}_/g;

/**
 * Text of a cell without control characters. A line break inside a word (a
 * syllable break of the copied source: "Daten", break, "pflege") is joined, any
 * other line break becomes a space. Hyphens inside words stay.
 */
export function cleanCell(text: string | null | undefined): string {
  if (text === null || text === undefined) return '';
  return (
    String(text)
      .replace(ESCAPED_CONTROL, '')
      .replace(CONTROL, '')
      .replace(/\u00a0/g, ' ')
      // hyphen at the end of the line: "anwen-" break "dungen"
      .replace(/(\p{L})-\r?\n[ \t]*(\p{Ll})/gu, '$1$2')
      // plain break inside a word (no space before the break, lower case on
      // both sides); a space before the break is a real word break
      .replace(/(\p{Ll})\r?\n[ \t]*(\p{Ll})/gu, '$1$2')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

const MAX_TOKENS = 40;
/** Longer cells are not learning field references, no pattern runs on them. */
const MAX_CELL_LENGTH = 2000;

/** Removes trailing dots and white space in one pass. */
function trimEnd(value: string): string {
  let end = value.length;
  while (end > 0 && /[.\s]/.test(value[end - 1])) end -= 1;
  return value.slice(0, end);
}

/**
 * Learning field references of one cell. Accepted: LF2,3 / LF 2 / LF 2,3,4 /
 * Lernfeld 3 / LF 5, LF 7 / LF 5 und 7 / LF 5 / 7 (any case, any spacing),
 * "alle Lernfelder" and "nur betr./beh." or "nur betrieblich".
 */
export function parseLearningFieldRefs(
  text: string | null | undefined
): LearningFieldRefs {
  const cleaned = cleanCell(text);
  if (cleaned.length > MAX_CELL_LENGTH) return { kind: 'unparseable' };
  const value = trimEnd(cleaned.toLowerCase());
  if (value === '') return { kind: 'empty' };
  if (/^alle\b/.test(value)) {
    return /^alle(?:\s+lernfelder)?$/.test(value)
      ? { kind: 'all' }
      : { kind: 'unparseable' };
  }
  if (/^nur\s+betr/.test(value)) return { kind: 'company-only' };

  const head = /^(?:lernfelder|lernfeld|lf)\s*:?\s*(.*)$/.exec(value);
  if (!head) return { kind: 'unparseable' };
  const tokens = head[1]
    .split(/\s*(?:,|;|\/|&|\+|\bund\b)\s*/)
    .map(token =>
      token.replace(/^(?:lernfelder|lernfeld|lf)\s*:?\s*/, '').trim()
    )
    .filter(token => token !== '');
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) {
    return { kind: 'unparseable' };
  }
  const numbers: number[] = [];
  const invalid: number[] = [];
  for (const token of tokens) {
    if (!/^\d{1,3}$/.test(token)) return { kind: 'unparseable' };
    const number = Number(token);
    const list =
      number >= 1 && number <= LEARNING_FIELD_COUNT ? numbers : invalid;
    if (!list.includes(number)) list.push(number);
  }
  return { kind: 'numbers', numbers, invalid };
}
