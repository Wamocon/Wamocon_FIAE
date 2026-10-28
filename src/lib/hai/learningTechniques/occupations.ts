/**
 * Occupation markers of the examples on the learning technique cards.
 *
 * The examples of a card are written per occupation (FIAE, KfBM). A word of
 * the typical content of one occupation must not appear in the example of the
 * other one, and an answer for a trainee of one occupation must not carry the
 * example of the other (see answerLint.ts). Lower case stems, matched as
 * substrings of the lower cased text.
 *
 * @module lib/hai/learningTechniques/occupations
 */

export type ExampleOccupationCode = 'FIAE' | 'KFBM';

export const OCCUPATION_MARKERS: Record<
  ExampleOccupationCode,
  readonly string[]
> = {
  FIAE: [
    'sql',
    'datenbank',
    'netzwerk',
    'schleife',
    'struktogramm',
    'primärschlüssel',
    'normalform',
    'normalisierung',
    'datenpaket',
    'queue',
  ],
  KFBM: [
    'rechnung',
    'buchung',
    'geschäftsbrief',
    'angebotsvergleich',
    'büroorganisation',
    'eingangspost',
    'schriftverkehr',
    'vertragsart',
    'prozentrechnung',
    'terminplanung',
    'invoice',
  ],
};

/** The other occupation of a pair. */
export function otherOccupation(
  code: ExampleOccupationCode
): ExampleOccupationCode {
  return code === 'FIAE' ? 'KFBM' : 'FIAE';
}

/** Markers of the given occupation found in the text (lower case compare). */
export function findMarkers(
  text: string,
  code: ExampleOccupationCode
): string[] {
  const lower = text.toLowerCase();
  return OCCUPATION_MARKERS[code].filter(marker => lower.includes(marker));
}

/** Example occupation of a catalog code, or null (no example for it). */
export function toExampleOccupation(
  catalogCode: string | null | undefined
): ExampleOccupationCode | null {
  const code = (catalogCode ?? '').trim().toUpperCase();
  return code === 'FIAE' || code === 'KFBM' ? code : null;
}
