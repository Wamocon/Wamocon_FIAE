/**
 * Hours as people read them: the number format of the language (German
 * "72,5", never "72.5") and no needless ".0" ("80", not "80.0"). Pure, no
 * imports.
 */
export function formatHours(value: number, language: string = 'de'): string {
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 10) / 10;
  return rounded.toLocaleString(language === 'en' ? 'en-US' : 'de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
}

/**
 * What is left of a use case while a report is being written: the hours the
 * server counts without this report (`remaining`, other reports are already
 * taken off) minus what is typed into the open form. It follows every change
 * of the input and can go below zero (then the form warns). `typed` is not a
 * number while the field is empty, that counts as 0.
 */
export function remainingAfterEntry(
  remaining: number,
  typed: number | null | undefined
): number {
  const entered = Number(typed);
  return remaining - (Number.isFinite(entered) ? entered : 0);
}
