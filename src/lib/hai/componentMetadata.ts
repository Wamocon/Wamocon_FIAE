/**
 * Metadata of a training component (Ausbildungsrahmenplan) in the HAI index,
 * written by scripts/reindex-gemini.ts. Pure function over a row of
 * training_components (snake_case columns), no server imports, so the script
 * and the tests can use it.
 *
 * The keys that existed before stay as they are (componentCode, trainingYear,
 * totalHours, useCaseCount). New: componentPhase (the phase column, 1, 2 or
 * null for an integrative component) and componentKind (pflicht, wahl or
 * integrativ). The training scope of HAI (src/lib/hai/trainingScope.ts) reads
 * both and decides with getComponentPhase, so it no longer depends on the
 * order index of the 26 ARP components, which a second occupation does not
 * share. A database without the columns gives null for both.
 */

export interface TrainingComponentRow {
  code: string;
  training_year: number | null;
  total_hours: number;
  phase?: number | null;
  kind?: string | null;
}

export function buildTrainingComponentMetadata(
  component: TrainingComponentRow,
  useCaseCount: number
): Record<string, unknown> {
  return {
    componentCode: component.code,
    trainingYear: component.training_year,
    totalHours: component.total_hours,
    useCaseCount,
    componentPhase: component.phase ?? null,
    componentKind: component.kind ?? null,
  };
}

/**
 * The duration line of the HAI text of a component ("Dauer: 11 Wochen / 440
 * Stunden"). A value that is missing or 0 is left out, so the text never says
 * "0 Stunden" or "0 Wochen"; without both there is no line (null). The reindex
 * script adds the line only when this returns text.
 */
export function componentDurationText(
  totalWeeks: number | string | null | undefined,
  totalHours: number | string | null | undefined
): string | null {
  const positive = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const weeks = positive(totalWeeks);
  const hours = positive(totalHours);
  const parts = [
    weeks !== null ? `${weeks} Wochen` : null,
    hours !== null ? `${hours} Stunden` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `Dauer: ${parts.join(' / ')}` : null;
}
