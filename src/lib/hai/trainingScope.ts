import {
  getCalendarYear,
  getAusbildungDurationLabel,
  getComponentPhase,
  getPhaseMonthRange,
  getTrainingPhase,
  normalizeDurationYears,
  type AusbildungDurationYears,
  type TrainingComponentPhase,
  type TrainingPhase,
} from '@/lib/ausbildung/duration';
import type { SearchResult } from './vectorSearch';

export interface HaiTrainingScope {
  applies: boolean;
  durationYears: AusbildungDurationYears;
  planLabel: string;
  currentAusbildungsjahr: number;
  currentPhase: TrainingPhase;
  allowedAusbildungsjahre: number[];
  allowedComponentPhases: TrainingComponentPhase[];
  phaseMonthRange: { startMonth: number; endMonth: number };
}

interface ScopeProfile {
  role?: 'TRAINER' | 'TRAINEE';
  startOfTrainingDate?: Date | string | null;
  ausbildungDurationYears?: number | null;
  /**
   * Length of phase 1 in months from the phase plan of the trainee's
   * occupation (KfBM 15). Without it the legacy 18 or 12 months apply.
   */
  phaseOneMonths?: number | null;
}

function parseDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rangeTo(value: number): number[] {
  return Array.from({ length: Math.max(1, value) }, (_, i) => i + 1);
}

export function buildHaiTrainingScope(
  profile: ScopeProfile,
  now: Date = new Date()
): HaiTrainingScope | undefined {
  if (profile.role !== 'TRAINEE') return undefined;

  const durationYears = normalizeDurationYears(profile.ausbildungDurationYears);
  const startDate = parseDate(profile.startOfTrainingDate);
  const currentPhase = startDate
    ? getTrainingPhase(startDate, durationYears, now, profile.phaseOneMonths)
    : 1;
  const currentAusbildungsjahr = startDate
    ? getCalendarYear(startDate, durationYears, now)
    : 1;
  const allowedComponentPhases: TrainingComponentPhase[] =
    currentPhase === 1 ? [1, 3] : [1, 2, 3];

  return {
    applies: true,
    durationYears,
    planLabel: getAusbildungDurationLabel(durationYears),
    currentAusbildungsjahr,
    currentPhase,
    allowedAusbildungsjahre: rangeTo(currentAusbildungsjahr),
    allowedComponentPhases,
    phaseMonthRange: getPhaseMonthRange(
      durationYears,
      currentPhase,
      profile.phaseOneMonths
    ),
  };
}

function numberFromMeta(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function numberArrayFromMeta(value: unknown): number[] {
  if (!Array.isArray(value)) {
    const single = numberFromMeta(value);
    return single === null ? [] : [single];
  }
  return value
    .map(numberFromMeta)
    .filter((item): item is number => item !== null);
}

export function isMetadataAllowedForTrainingScope(
  metadata: Record<string, unknown> | undefined,
  sourceType: string | undefined,
  scope: HaiTrainingScope | undefined
): boolean {
  if (!scope?.applies || !metadata) return true;

  const year = numberFromMeta(metadata.year);
  if (
    sourceType === 'course' &&
    year !== null &&
    !scope.allowedAusbildungsjahre.includes(year)
  ) {
    return false;
  }

  const trainingStages = numberArrayFromMeta(
    metadata.trainingStage ?? metadata.training_stage
  );
  const years = numberArrayFromMeta(metadata.year ?? metadata.years);
  if (
    sourceType !== 'course' &&
    trainingStages.length === 0 &&
    years.length > 0 &&
    !years.some(item => scope.allowedAusbildungsjahre.includes(item))
  ) {
    return false;
  }

  const trainingYears = numberArrayFromMeta(
    metadata.trainingYear ?? metadata.training_year
  );
  if (trainingYears.length > 0) {
    const isSchoolYearMetadata =
      metadata.type === 'lernfeld' || sourceType === 'course';

    if (isSchoolYearMetadata) {
      if (
        !trainingYears.some(year =>
          scope.allowedAusbildungsjahre.includes(year)
        )
      ) {
        return false;
      }
    } else if (
      !trainingYears.some(yearOrPhase =>
        scope.allowedComponentPhases.includes(
          yearOrPhase as TrainingComponentPhase
        )
      )
    ) {
      return false;
    }
  }

  if (
    trainingStages.length > 0 &&
    !trainingStages.some(stage =>
      scope.allowedComponentPhases.includes(stage as TrainingComponentPhase)
    )
  ) {
    return false;
  }

  const componentOrder = numberFromMeta(
    metadata.componentOrderIndex ??
      metadata.trainingComponentOrder ??
      metadata.componentOrder
  );
  // The phase column of the component wins, the order index is the fallback
  // for components without a filled column (see getComponentPhase).
  const componentPhase = getComponentPhase({
    phase: numberFromMeta(
      metadata.componentPhase ?? metadata.trainingComponentPhase
    ),
    kind:
      typeof metadata.componentKind === 'string'
        ? metadata.componentKind
        : null,
    orderIndex: componentOrder,
  });
  if (
    componentPhase !== null &&
    !scope.allowedComponentPhases.includes(componentPhase)
  ) {
    return false;
  }

  return true;
}

export function filterSearchResultsForTrainingScope(
  results: SearchResult[],
  scope: HaiTrainingScope | undefined
): SearchResult[] {
  if (!scope?.applies) return results;
  return results.filter(result =>
    isMetadataAllowedForTrainingScope(result.metadata, result.sourceType, scope)
  );
}

export function buildTrainingScopePrompt(
  scope: HaiTrainingScope | undefined
): string | undefined {
  if (!scope?.applies) return undefined;

  const allowedYears = scope.allowedAusbildungsjahre.join(', ');
  const allowedPhases = scope.allowedComponentPhases.join(', ');

  return `## Ausbildungsplan des Azubis
Plan: ${scope.planLabel}
Aktuelles Ausbildungsjahr: ${scope.currentAusbildungsjahr} von ${scope.durationYears}
Aktuelle Inhaltsfreigabe: Phase ${scope.currentPhase} (${scope.phaseMonthRange.startMonth}. bis ${scope.phaseMonthRange.endMonth}. Ausbildungsmonat)
Freigegebene Ausbildungsjahre: ${allowedYears}
Freigegebene Komponentenphasen: ${allowedPhases} (3 = integrative Inhalte fuer die gesamte Ausbildung)

**WICHTIG:** Beantworte Lernfragen nur mit Inhalten, die fuer diese freigegebenen Jahre/Phasen passend sind. Wenn der Azubi nach zukuenftigen Modulen, spaeteren Ausbildungsjahren oder noch nicht freigegebenen Inhalten fragt, erklaere kurz, dass diese Inhalte spaeter im Kurs behandelt werden, und biete passende aktuelle Themen an. Gib keine Details, Loesungen, Tabellen oder Zusammenfassungen aus zukuenftigen Inhalten preis.`;
}
