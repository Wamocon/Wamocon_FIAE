/**
 * The percentage of a course (Fragenkomplex) for one trainee, in one place.
 *
 * The counts come from the one definition of "enabler completed"
 * (src/lib/catalog/progression.ts, loadCourseProgressions) and from the use
 * cases the trainer approved. The percentage is a weighted mean: the enablers
 * (Themenkreise) count ENABLER_WEIGHT percent and the use cases USE_CASE_WEIGHT
 * percent. A course without use cases is the share of enablers alone, one
 * without enablers the share of use cases alone. The pages show the counts of
 * both parts next to the percentage and say how it is made up, so the number
 * can be followed.
 *
 * Pure module (no database), the routes of the course list and of the dashboard
 * both use it, so the two cannot drift apart.
 */

/** Weight of the enablers in the percentage of a course. */
export const ENABLER_WEIGHT = 0.7;
/** Weight of the use cases in the percentage of a course. */
export const USE_CASE_WEIGHT = 0.3;

export interface CourseProgressCounts {
  enablerTotal: number;
  enablerDone: number;
  useCaseTotal: number;
  useCaseDone: number;
}

/** Whole percent 0 to 100. A course without enablers and use cases is 0. */
export function courseProgressPercent(counts: CourseProgressCounts): number {
  const { enablerTotal, enablerDone, useCaseTotal, useCaseDone } = counts;
  if (enablerTotal === 0 && useCaseTotal === 0) return 0;
  const enablerShare = enablerTotal > 0 ? enablerDone / enablerTotal : 1;
  const useCaseShare = useCaseTotal > 0 ? useCaseDone / useCaseTotal : 1;
  if (enablerTotal > 0 && useCaseTotal > 0) {
    return Math.round(
      (enablerShare * ENABLER_WEIGHT + useCaseShare * USE_CASE_WEIGHT) * 100
    );
  }
  return Math.round((enablerTotal > 0 ? enablerShare : useCaseShare) * 100);
}
