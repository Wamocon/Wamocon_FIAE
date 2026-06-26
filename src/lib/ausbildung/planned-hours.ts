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
