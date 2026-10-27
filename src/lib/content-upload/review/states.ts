// Which file states mean what in the review list. Small and without imports of the
// server side, so the page of the browser can use it too.

import type { FileStatus } from '@/lib/content-upload/staging/status';

/** File states in which a decision may be written. */
export const DECIDABLE: readonly FileStatus[] = [
  'proposed_rules',
  'unclear',
  'proposed_ki',
  'decided',
];

/** File states in which a file takes part in a group of versions. */
export const GROUPABLE: readonly FileStatus[] = [
  'proposed_rules',
  'unclear',
  'proposed_ki',
  'decided',
  'applied',
];

/**
 * Reasons of a proposal in the band medium that say the content was not checked
 * with full certainty (a marker word of a solution, a file that could not be read or
 * was cut, an archive folder above the tree). A click does not take such a proposal
 * as it stands: the person names the assignment (decision O13, the protection of
 * the solutions must not be one click away).
 */
export const UNCHECKED_REASONS: ReadonlySet<string> = new Set([
  'SOLUTION_MARKER',
  'CONTENT_UNREADABLE',
  'INPUT_TRUNCATED',
  'ARCHIVE_ABOVE_TREE',
]);

/** Failed, rejected or expired: no proposal exists, the list names the code. */
const PROBLEM: readonly FileStatus[] = ['failed', 'rejected', 'expired'];
const LEFT_OUT: readonly FileStatus[] = ['merged', 'skipped', 'superseded'];

export function isProblem(status: FileStatus): boolean {
  return PROBLEM.includes(status);
}

/** Merged copies, skipped and superseded files. */
export function isLeftOut(status: FileStatus): boolean {
  return LEFT_OUT.includes(status);
}
