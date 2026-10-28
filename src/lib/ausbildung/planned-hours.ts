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
