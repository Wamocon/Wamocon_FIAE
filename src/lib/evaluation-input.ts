/**
 * What a trainer sends when it grades a weekly evaluation: the shape checks
 * that routes share (src/app/api/weekly-evaluations and
 * src/app/api/trainer/evaluations/[id]). A value that fails a check is a 400,
 * never a 500 from the database and never an essay in a text column. Texts use
 * the limits of src/lib/input-limits.ts, ids the check of src/lib/uuid.ts.
 */

import { NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import db from '@/db';
import { mesSoftskillCriteria } from '@/db/migrations/schemas/schema';
import {
  MAX_COMMENT_LENGTH,
  MAX_REASON_LENGTH,
  invalidText,
} from '@/lib/input-limits';
import { badRequestUnlessUuid } from '@/lib/uuid';

/** The values of the database enum performance_rating. */
export const GRADES = ['1', '2', '3', '4', '5', '6'];

/**
 * A grade as the database knows it: 1 to 6, sent as a string or a number. A
 * list or an object that merely prints like a grade is none.
 */
export const isGrade = (value: unknown): boolean =>
  (typeof value === 'string' || typeof value === 'number') &&
  GRADES.includes(String(value));

/** A week has about ten criteria, the limit only stops a runaway request. */
export const MAX_SOFTSKILL_RATINGS = 100;

const invalid = (message: string) =>
  NextResponse.json({ error: message }, { status: 400 });

/**
 * 400 for an input that would end in a 500 (a grade outside the enum, a
 * criterion that is no uuid, an entry that is no object) or that is too long.
 * Checked before anything is read or written. An empty value (undefined, null,
 * empty string) of a grade or a text is "not given" here, each route decides
 * what it needs.
 */
export function invalidEvaluationInput(
  body: Record<string, any>
): NextResponse | null {
  const text =
    invalidText('trainerComment', body.trainerComment, MAX_COMMENT_LENGTH) ??
    invalidText('releaseComment', body.releaseComment, MAX_COMMENT_LENGTH) ??
    invalidText('editReason', body.editReason, MAX_REASON_LENGTH);
  if (text) return text;

  if (body.trainerRating && !isGrade(body.trainerRating)) {
    return invalid('Invalid trainerRating');
  }
  if (body.releaseRating && !isGrade(body.releaseRating)) {
    return invalid('Invalid releaseRating');
  }

  // Not a list: ignored, as before
  if (!Array.isArray(body.softskillRatings)) return null;
  if (body.softskillRatings.length > MAX_SOFTSKILL_RATINGS) {
    return invalid('Too many softskillRatings');
  }
  for (const rating of body.softskillRatings) {
    if (!rating || typeof rating !== 'object' || Array.isArray(rating)) {
      return invalid('Invalid softskillRatings');
    }
    const { criterionId } = rating;
    // An entry without a criterion is skipped, as before
    if (
      criterionId !== undefined &&
      criterionId !== null &&
      criterionId !== ''
    ) {
      const badId = badRequestUnlessUuid('criterionId', criterionId);
      if (badId) return badId;
    }
    const entryText =
      invalidText(
        'trainerComment',
        rating.trainerComment,
        MAX_COMMENT_LENGTH
      ) ??
      invalidText('releaseComment', rating.releaseComment, MAX_COMMENT_LENGTH);
    if (entryText) return entryText;
    if (rating.trainerRating && !isGrade(rating.trainerRating)) {
      return invalid('Invalid trainerRating');
    }
    if (rating.releaseRating && !isGrade(rating.releaseRating)) {
      return invalid('Invalid releaseRating');
    }
  }
  return null;
}

/**
 * The stricter checks of PUT /api/trainer/evaluations/[id], on top of
 * invalidEvaluationInput. That route writes the values as they are, so a value
 * that is present has to be usable:
 *  - every softskill entry names a criterion (a uuid)
 *  - a trainer rating that is present is a grade (the column is NOT NULL, null,
 *    empty and 0 would end in a 500), a release rating is a grade or null
 *    (null clears it)
 *  - the standard assessment saves a grade for every entry, a new rating row
 *    cannot be created without one
 */
export function invalidTrainerAssessmentInput(
  body: Record<string, any>,
  isReleaseEdit: boolean
): NextResponse | null {
  const shared = invalidEvaluationInput(body);
  if (shared) return shared;

  const trainerGiven = (value: unknown) => value !== undefined;
  const releaseGiven = (value: unknown) =>
    value !== undefined && value !== null;

  if (isReleaseEdit) {
    if (trainerGiven(body.trainerRating) && !isGrade(body.trainerRating)) {
      return invalid('Invalid trainerRating');
    }
    if (releaseGiven(body.releaseRating) && !isGrade(body.releaseRating)) {
      return invalid('Invalid releaseRating');
    }
  }

  if (!Array.isArray(body.softskillRatings)) return null;
  for (const rating of body.softskillRatings as Record<string, any>[]) {
    const badId = badRequestUnlessUuid('criterionId', rating.criterionId);
    if (badId) return badId;
    if (!isReleaseEdit && !isGrade(rating.trainerRating)) {
      return invalid('Invalid trainerRating');
    }
    if (isReleaseEdit) {
      if (
        trainerGiven(rating.trainerRating) &&
        !isGrade(rating.trainerRating)
      ) {
        return invalid('Invalid trainerRating');
      }
      if (
        releaseGiven(rating.releaseRating) &&
        !isGrade(rating.releaseRating)
      ) {
        return invalid('Invalid releaseRating');
      }
    }
  }
  return null;
}

/**
 * 400 when one of the criteria of the entries does not exist, null otherwise.
 * One query for all of them. An unknown criterion would end in a foreign key
 * error after the evaluation was already written.
 */
export async function unknownCriterion(
  softskillRatings: unknown
): Promise<NextResponse | null> {
  const criterionIds = [
    ...new Set(
      (Array.isArray(softskillRatings) ? softskillRatings : [])
        .map((entry: { criterionId?: unknown }) => entry.criterionId)
        .filter(Boolean)
        .map(id => String(id).toLowerCase())
    ),
  ] as string[];
  if (criterionIds.length === 0) return null;
  const found = await db
    .select({ id: mesSoftskillCriteria.id })
    .from(mesSoftskillCriteria)
    .where(inArray(mesSoftskillCriteria.id, criterionIds as any));
  const known = new Set(found.map(row => String(row.id)));
  return criterionIds.some(id => !known.has(id))
    ? invalid('Unknown criterionId')
    : null;
}

/**
 * A validated grade as the text of the enum (3 becomes '3'). Values that are
 * not given (undefined, null, empty) stay as they are, a grade that was not
 * validated is not touched.
 */
export function asGrade<T>(value: T): T | string {
  return isGrade(value) ? String(value) : value;
}

/** The softskill entries with their grades as enum texts, anything else as sent. */
export function normalizeSoftskillGrades(softskillRatings: unknown): unknown {
  if (!Array.isArray(softskillRatings)) return softskillRatings;
  return softskillRatings.map(entry =>
    entry && typeof entry === 'object'
      ? {
          ...entry,
          trainerRating: asGrade(entry.trainerRating),
          releaseRating: asGrade(entry.releaseRating),
        }
      : entry
  );
}
