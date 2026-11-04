/**
 * Cleaning and checking of the values the HAI wants to put into a form (pure,
 * shared by the server and the browser, so both check the same way).
 *
 * Rules:
 *  - only the value types of the register (text, textarea, number, select)
 *  - control and invisible characters are removed, markup is removed (tags),
 *    line breaks become spaces in a one line field
 *  - a value that is too long is REJECTED, not cut (the person would get half a
 *    sentence), a number outside its range or step is rejected, a select value
 *    must be in the list
 *
 * @module lib/hai/uiActions/values
 */

import type { UiFieldDef } from './registry';

export type UiValueResult =
  | { ok: true; value: string }
  | { ok: false; reason: UiValueProblem };

export type UiValueProblem =
  | 'type'
  | 'too_long'
  | 'too_short'
  | 'out_of_range'
  | 'not_allowed';

/** Characters without a visible form: control (not \n and \t), bidi, zero width. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u061C\u180E\u200B-\u200F\u2060-\u2064\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** The most characters read from a raw value before it is rejected as too long. */
const RAW_SLACK = 4;

/** Text without control characters and markup. Line breaks stay as "\n". */
export function stripMarkup(text: string): string {
  return (
    text
      .replace(INVISIBLE, '')
      .replace(/\r\n?|[\u2028\u2029\u0085]/g, '\n')
      .replace(/\t/g, ' ')
      // tags and comments (also half a tag at the end). A lone angle bracket as
      // in "x < 5" is no markup and stays, the value is only ever set as text.
      .replace(/<\/?[A-Za-z!][^>]*>?/g, '')
  );
}

function cleanText(field: UiFieldDef, raw: unknown): UiValueResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'type' };
  const max = field.maxLength ?? 0;
  // a huge raw text is no input to clean, it is too long
  if (raw.length > max * RAW_SLACK + 200) {
    return { ok: false, reason: 'too_long' };
  }
  let value = stripMarkup(raw);
  if (field.type === 'text') {
    value = value.replace(/\s+/g, ' ').trim();
  } else {
    value = value
      .split('\n')
      .map(line => line.replace(/[ ]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  if (value.length > max) return { ok: false, reason: 'too_long' };
  if (value.length < (field.minLength ?? 0)) {
    return { ok: false, reason: 'too_short' };
  }
  return { ok: true, value };
}

function cleanNumber(field: UiFieldDef, raw: unknown): UiValueResult {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (
    typeof raw === 'string' &&
    /^\d{1,4}(?:[.,]\d{1,2})?$/.test(raw.trim())
  ) {
    n = Number(raw.trim().replace(',', '.'));
  } else {
    return { ok: false, reason: 'type' };
  }
  if (!Number.isFinite(n)) return { ok: false, reason: 'type' };
  if (n < (field.min ?? -Infinity) || n > (field.max ?? Infinity)) {
    return { ok: false, reason: 'out_of_range' };
  }
  if (field.step) {
    const steps = n / field.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      return { ok: false, reason: 'out_of_range' };
    }
  }
  return { ok: true, value: String(n) };
}

function cleanSelect(field: UiFieldDef, raw: unknown): UiValueResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'type' };
  const value = raw.trim();
  return field.options?.includes(value)
    ? { ok: true, value }
    : { ok: false, reason: 'not_allowed' };
}

/** Clean and check one value against its field of the register. */
export function cleanFieldValue(
  field: UiFieldDef,
  raw: unknown
): UiValueResult {
  switch (field.type) {
    case 'text':
    case 'textarea':
      return cleanText(field, raw);
    case 'number':
      return cleanNumber(field, raw);
    case 'select':
      return cleanSelect(field, raw);
    default:
      return { ok: false, reason: 'type' };
  }
}
