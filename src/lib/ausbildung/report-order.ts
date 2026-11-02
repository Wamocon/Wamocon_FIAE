/**
 * Order of the activity reports (Ausbildungsnachweise) in the list of a
 * trainee: the newest calendar week on top (year, then week, descending). The
 * day a report was created says nothing about its week (a draft for KW 44 made
 * after KW 41 to 43 would otherwise jump to the top, or a report made late
 * would sit between others), so it only breaks a tie.
 */
export function compareReportsNewestWeekFirst(
  a: { year: number; weekNumber: number; createdAt?: string | Date | null },
  b: { year: number; weekNumber: number; createdAt?: string | Date | null }
): number {
  if (a.year !== b.year) return b.year - a.year;
  if (a.weekNumber !== b.weekNumber) return b.weekNumber - a.weekNumber;
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bt - at;
}
