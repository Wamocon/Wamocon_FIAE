/**
 * Points of an exam result (trainer grading). Pure functions, shared by the
 * route and the dialog so both sides answer the same: whole points from 0 up to
 * the maximum, the maximum from 1 up to a sane limit.
 *
 * The database keeps the points (integer) and the percentage, not the maximum,
 * so the maximum of a saved result is derived from the two (deriveMaxPoints).
 * A value above the maximum that was saved before this check stays readable and
 * can be corrected: nothing here throws on it.
 */

/** Largest maximum of points a result can have (the column is an integer). */
export const MAX_EXAM_POINTS_LIMIT = 100000;

export type ExamPointsProblem =
  | 'POINTS_INVALID'
  | 'MAX_POINTS_INVALID'
  | 'POINTS_ABOVE_MAX';

export type ExamPointsCheck =
  | { ok: true; points: number; maxPoints: number }
  | { ok: false; code: ExamPointsProblem };

function wholeNumber(value: unknown): number | null {
  if (typeof value === 'string') {
    if (value.trim() === '') return null;
    return wholeNumber(Number(value));
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value;
}

/** Checks the pair (points, maximum) of a grading. */
export function checkExamPoints(
  points: unknown,
  maxPoints: unknown
): ExamPointsCheck {
  const max = wholeNumber(maxPoints);
  if (max === null || max < 1 || max > MAX_EXAM_POINTS_LIMIT) {
    return { ok: false, code: 'MAX_POINTS_INVALID' };
  }
  const value = wholeNumber(points);
  if (value === null || value < 0) return { ok: false, code: 'POINTS_INVALID' };
  if (value > max) return { ok: false, code: 'POINTS_ABOVE_MAX' };
  return { ok: true, points: value, maxPoints: max };
}

/**
 * The maximum of a saved result, from points and percentage (percentage =
 * points / maximum * 100). Unknown (null) when it cannot be told, for example
 * 0 points.
 */
export function deriveMaxPoints(
  points: number | null | undefined,
  percentage: number | null | undefined
): number | null {
  if (points === null || points === undefined) return null;
  if (percentage === null || percentage === undefined || percentage <= 0) {
    return null;
  }
  const max = Math.round((points / percentage) * 100);
  return Number.isFinite(max) && max >= 1 ? max : null;
}

/** true when a (saved) result is above its maximum. */
export function isAboveMax(
  points: number | null | undefined,
  maxPoints: number | null | undefined
): boolean {
  return (
    points !== null &&
    points !== undefined &&
    maxPoints !== null &&
    maxPoints !== undefined &&
    points > maxPoints
  );
}
