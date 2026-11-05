/**
 * Small helpers for how stored content titles and texts are shown to a
 * trainee. Pure, no imports. The stored text stays as it is, only the display
 * is made uniform (one capital letter at the start, one word per thing).
 */

/**
 * A title starts with a capital letter. German content titles of the import
 * sometimes start in lower case ("bürowirtschaftliche Abläufe organisieren").
 * Only the first character changes, a title that starts with a digit, a
 * quotation mark or anything that has no capital form stays as it is.
 */
export function capitalizeFirst(text: string | null | undefined): string {
  const value = text ?? '';
  const first = value.charAt(0);
  return first === '' ? value : first.toLocaleUpperCase('de') + value.slice(1);
}

/**
 * true when two texts say the same for a reader: they differ only in white
 * space, capitals or a closing full stop. The page uses it to not show a
 * description that only repeats the title.
 */
export function sameText(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const norm = (text: string | null | undefined) =>
    (text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.\s]+$/, '')
      .toLocaleLowerCase('de');
  return norm(a) !== '' && norm(a) === norm(b);
}

/**
 * The description of an imported enabler starts with a generated sentence,
 * for example: In diesem Modul "Titel" werden folgende Inhalte behandelt:
 * For the trainee the unit is a Themenkreis, so the display says so. Any other
 * text is returned unchanged.
 */
export function themenkreisDescription(text: string): string {
  return text.replace(
    /^(\s*)In diesem Modul(?=\s+")/,
    '$1In diesem Themenkreis'
  );
}
