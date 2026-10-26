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
