// The id of the catalog FIAE (TRAINING_CATALOG_IDS.FIAE, a test keeps them equal).
// Not imported from the schema: this file is also used by the client page.
const FIAE_CATALOG_ID = '00000000-0000-4000-8000-000000000001';

type UseCaseHoursInput = {
  plannedHours?: number | null;
};

export function normalizePlannedHours({
  plannedHours,
}: UseCaseHoursInput): number {
  const hours = Number(plannedHours) || 0;

  if (hours === 400) return 40;

  return hours;
}

/**
 * The line under the title of a training component: the code and, only when the
 * component has hours, the hours with their unit ("K1 • 440 Std gesamt"). A
 * component without hours (0, empty, unknown) shows the code alone, never
 * "0 Std gesamt".
 */
export function componentHoursLabel(
  code: string,
  totalHours: number | string | null | undefined,
  unit: string
): string {
  const hours = Number(totalHours);
  return Number.isFinite(hours) && hours > 0
    ? `${code} \u2022 ${hours} ${unit}`
    : code;
}

/**
 * Whether the hours of a use case limit what a trainee can book. A use case
 * with hours (> 0) always limits. A use case without hours of an occupation
 * other than FIAE has no target given (the Rahmenplan of KfBM has no hours per
 * use case yet) and is not limited: nothing is "exhausted" and nothing is
 * "overbooked". FIAE stays as it always was (0 hours = nothing to book), and an
 * unknown catalog fails closed.
 */
export function isHoursLimited(
  plannedHours: number | null | undefined,
  catalogId: string | null | undefined
): boolean {
  if (normalizePlannedHours({ plannedHours }) > 0) return true;
  if (!catalogId || catalogId === FIAE_CATALOG_ID) return true;
  return false;
}
