/**
 * The caches of the lists that a trainee reads (Lernen, Quizze, dashboard).
 *
 * The routes keep their answers in the Data Cache for up to five minutes (and a
 * stale answer is served once more while it is refreshed). A change of what the
 * lists show has to clear it, or the trainee sees the old list for a while: the
 * key holds the trainee and the catalogs of the scope, not the courses they are
 * members of or the quizzes assigned to them. Call this after every write that
 * changes the memberships (course_members), the assignments of global quizzes
 * (quiz_assignments) or the enrollment of a trainee.
 *
 * It clears the tags of all trainees (the cache tag is the resource, not the
 * user), which is cheap and rare: these writes are made by a trainer or an
 * admin.
 */

import { apiCache } from '@/lib/api-cache';

/** Resource tags of the trainee lists (the first two parts of their cache keys). */
export const TRAINEE_LIST_CACHE_TAGS = [
  'trainee_courses',
  'trainee_quizzes',
  'trainee_dashboard',
] as const;

export function invalidateTraineeListCaches(): void {
  for (const tag of TRAINEE_LIST_CACHE_TAGS) apiCache.invalidate(tag);
}
