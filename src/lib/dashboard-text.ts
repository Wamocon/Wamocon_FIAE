/**
 * The sentences of the trainee dashboard that the dashboard route builds
 * (achievements, phase deadlines). The route sends a code and parameters next
 * to the German sentence, the page writes the sentence in the language of the
 * trainee with the translation system. A row without a code (an old answer, a
 * cached one) shows its German sentence as it is.
 */

type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

type Params = Record<string, string | number> | null | undefined;

/** Sentence of an achievement row of the dashboard. */
export function achievementText(
  t: Translate,
  row: { text: string; code?: string; params?: Params }
): string {
  return row.code
    ? t(`dashboard.achievement.${row.code}`, row.params ?? {})
    : row.text;
}

/** Label of a deadline row of the dashboard (the phase and its months). */
export function deadlineLabel(
  t: Translate,
  row: { label: string; labelCode?: string; labelParams?: Params }
): string {
  return row.labelCode
    ? t(`dashboard.deadline.${row.labelCode}`, row.labelParams ?? {})
    : row.label;
}
