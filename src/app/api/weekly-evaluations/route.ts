import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  weeklyEvaluations,
  weeklySoftskillRatings,
  mesSoftskillCriteria,
  gradeEditHistory,
} from '@/db/migrations/schemas/schema';
import { eq, and, asc, inArray } from 'drizzle-orm';
import {
  isErrorResponse,
  requireTrainer,
  requireUser,
} from '@/lib/auth/session';
import {
  loadReportForSession,
  notGradable,
  ratingAccessCondition,
  traineeAccessCondition,
} from '@/lib/auth/activity-report-access';
import {
  MAX_COMMENT_LENGTH,
  MAX_REASON_LENGTH,
  invalidText,
  readJsonObject,
} from '@/lib/input-limits';
import { badRequestUnlessUuid } from '@/lib/uuid';

const GRADES = ['1', '2', '3', '4', '5', '6'];
const isGrade = (value: unknown) => GRADES.includes(String(value));
/** A week has about ten criteria, the limit only stops a runaway request. */
const MAX_SOFTSKILL_RATINGS = 100;

/**
 * 400 for an input that would end in a 500 (a grade outside the enum, a
 * criterion that is no uuid, an entry that is no object) or that is too long.
 * Checked before anything is read or written.
 */
function invalidEvaluationInput(
  body: Record<string, any>
): NextResponse | null {
  const invalid = (message: string) =>
    NextResponse.json({ error: message }, { status: 400 });

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

// GET: Get evaluation for a specific activity report
// A trainee reads the evaluation of their own report, trainer level the one of
// a report of a trainee inside its organization scope. Any other report is a
// 404.
export async function GET(request: NextRequest) {
  const session = await requireUser(request);
  if (isErrorResponse(session)) return session;

  try {
    const url = new URL(request.url);
    const activityReportId = url.searchParams.get('activityReportId');

    if (!activityReportId) {
      return NextResponse.json(
        { error: 'activityReportId required' },
        { status: 400 }
      );
    }

    const report = await loadReportForSession(
      session,
      request,
      activityReportId
    );
    if (isErrorResponse(report)) return report;

    // Get the weekly evaluation linked to this activity report
    const evaluations = await db
      .select()
      .from(weeklyEvaluations)
      .where(eq(weeklyEvaluations.activityReportId, activityReportId as any));

    if (evaluations.length === 0) {
      return NextResponse.json({ evaluation: null, softskillRatings: [] });
    }

    const evaluation = evaluations[0];

    // Get all softskill ratings for this evaluation (including release ratings)
    const ratings = await db
      .select({
        id: weeklySoftskillRatings.id,
        softskillCriterionId: weeklySoftskillRatings.softskillCriterionId,
        selfRating: weeklySoftskillRatings.selfRating,
        trainerRating: weeklySoftskillRatings.trainerRating,
        releaseRating: weeklySoftskillRatings.releaseRating,
        trainerComment: weeklySoftskillRatings.trainerComment,
        releaseComment: weeklySoftskillRatings.releaseComment,
        criterionCode: mesSoftskillCriteria.code,
        criterionName: mesSoftskillCriteria.name,
        competencyArea: mesSoftskillCriteria.competencyArea,
      })
      .from(weeklySoftskillRatings)
      .innerJoin(
        mesSoftskillCriteria,
        eq(weeklySoftskillRatings.softskillCriterionId, mesSoftskillCriteria.id)
      )
      .where(eq(weeklySoftskillRatings.weeklyEvaluationId, evaluation.id))
      .orderBy(asc(mesSoftskillCriteria.orderIndex));

    return NextResponse.json({ evaluation, softskillRatings: ratings });
  } catch (error: any) {
    // If table doesn't exist yet, return empty data
    if (error?.cause?.code === '42P01') {
      console.warn('Weekly evaluations table does not exist yet');
      return NextResponse.json({ evaluation: null, softskillRatings: [] });
    }
    console.error('Error fetching weekly evaluation:', error);
    return NextResponse.json(
      { error: 'Interner Serverfehler beim Abrufen der Bewertung' },
      { status: 500 }
    );
  }
}

// POST: Create or update weekly evaluation with softskill ratings
// Supports: trainer ratings, release ratings, and grade editing with audit trail
// Trainer level only, for a report of a trainee inside its organization scope.
// Trainee, organization and week come from the report, the trainer is the
// session user: a traineeId, trainerId, organizationId, weekNumber or year in
// the body is ignored.
export async function POST(request: NextRequest) {
  const session = await requireTrainer(request);
  if (isErrorResponse(session)) return session;
  const trainerId = session.id;

  try {
    const body = await readJsonObject(request);
    if (isErrorResponse(body)) return body;
    const {
      activityReportId,
      trainerRating,
      trainerComment,
      releaseRating,
      releaseComment,
      softskillRatings, // Array of { criterionId, trainerRating, trainerComment, releaseRating?, releaseComment? }
      isRelease, // Boolean: if true, we're setting release grades
      softskillsOnly, // Boolean: if true, only update softskill ratings, don't overwrite overall trainerRating
      editReason, // Optional reason for editing (audit trail)
    } = body as Record<string, any>;

    if (!activityReportId) {
      return NextResponse.json(
        { error: 'Missing required field: activityReportId' },
        { status: 400 }
      );
    }

    const invalidInput = invalidEvaluationInput(body);
    if (invalidInput) return invalidInput;

    const report = await loadReportForSession(
      session,
      request,
      String(activityReportId)
    );
    if (isErrorResponse(report)) return report;
    const refused = notGradable(report);
    if (refused) return refused;

    // Every criterion has to exist: an unknown one would end in a foreign key
    // error after the evaluation was already written
    const criterionIds = [
      ...new Set(
        (Array.isArray(softskillRatings) ? softskillRatings : [])
          .map((entry: { criterionId?: unknown }) => entry.criterionId)
          .filter(Boolean)
          .map(String)
      ),
    ] as string[];
    if (criterionIds.length > 0) {
      const found = await db
        .select({ id: mesSoftskillCriteria.id })
        .from(mesSoftskillCriteria)
        .where(inArray(mesSoftskillCriteria.id, criterionIds as any));
      const known = new Set(found.map(row => String(row.id)));
      if (criterionIds.some(id => !known.has(id))) {
        return NextResponse.json(
          { error: 'Unknown criterionId' },
          { status: 400 }
        );
      }
    }

    // Check if evaluation already exists for this activity report
    const existingEvaluations = await db
      .select()
      .from(weeklyEvaluations)
      .where(eq(weeklyEvaluations.activityReportId, report.id as any));

    // The trainee and the organization of the caller are part of every update
    const evaluationWhere = (evaluationId: string) =>
      and(
        eq(weeklyEvaluations.id, evaluationId as any),
        eq(weeklyEvaluations.activityReportId, report.id as any),
        eq(weeklyEvaluations.traineeId, report.traineeId as any),
        traineeAccessCondition(session, weeklyEvaluations.traineeId)
      );

    let evaluation;
    const now = new Date();

    // Ensure trainerRating is a string for the enum
    const trainerRatingStr = String(trainerRating || 3);

    if (existingEvaluations.length > 0) {
      const existing = existingEvaluations[0];

      if (isRelease) {
        // Setting release grade on existing evaluation
        const releaseRatingStr = releaseRating ? String(releaseRating) : null;

        // Audit trail for release rating changes
        if (
          existing.releaseRating &&
          releaseRatingStr &&
          existing.releaseRating !== releaseRatingStr
        ) {
          await db.insert(gradeEditHistory).values({
            entityType: 'WEEKLY_EVALUATION',
            entityId: existing.id,
            fieldName: 'releaseRating',
            oldValue: existing.releaseRating,
            newValue: releaseRatingStr,
            changedBy: trainerId,
            changeReason: editReason || null,
          });
        }

        const updated = await db
          .update(weeklyEvaluations)
          .set({
            releaseRating: releaseRatingStr as any,
            releaseComment: releaseComment || null,
            releasedAt: now,
            releasedBy: trainerId,
            updatedAt: now,
          })
          .where(evaluationWhere(existing.id))
          .returning();
        evaluation = updated[0];
      } else if (softskillsOnly) {
        // Only updating softskill ratings, don't overwrite the overall trainerRating
        evaluation = existing;
      } else {
        // Audit trail for trainer rating changes
        if (
          existing.trainerRating &&
          existing.trainerRating !== trainerRatingStr
        ) {
          await db.insert(gradeEditHistory).values({
            entityType: 'WEEKLY_EVALUATION',
            entityId: existing.id,
            fieldName: 'trainerRating',
            oldValue: existing.trainerRating,
            newValue: trainerRatingStr,
            changedBy: trainerId,
            changeReason: editReason || null,
          });
        }

        // Update existing evaluation
        const updated = await db
          .update(weeklyEvaluations)
          .set({
            trainerRating: trainerRatingStr as any,
            trainerComment: trainerComment || null,
            trainerApprovedAt: now,
            status: 'APPROVED',
            updatedAt: now,
          })
          .where(evaluationWhere(existing.id))
          .returning();
        evaluation = updated[0];
      }
    } else {
      // Create new evaluation
      const insertValues: any = {
        traineeId: report.traineeId,
        trainerId,
        organizationId: report.organizationId,
        activityReportId: report.id,
        weekNumber: report.weekNumber,
        year: report.year,
        ausbildungsjahr: report.ausbildungsjahr,
        trainerRating: trainerRatingStr as any,
        trainerComment: trainerComment || null,
        trainerApprovedAt: now,
        status: 'APPROVED',
      };

      // Include release data if provided on creation
      if (isRelease && releaseRating) {
        insertValues.releaseRating = String(releaseRating) as any;
        insertValues.releaseComment = releaseComment || null;
        insertValues.releasedAt = now;
        insertValues.releasedBy = trainerId;
      }

      const inserted = await db
        .insert(weeklyEvaluations)
        .values(insertValues)
        .returning();
      evaluation = inserted[0];
    }

    // The guarded update matched nothing: the evaluation is not the caller's
    if (!evaluation) {
      return NextResponse.json(
        { error: 'Evaluation not found' },
        { status: 404 }
      );
    }

    // Update or create softskill ratings
    if (softskillRatings && Array.isArray(softskillRatings)) {
      for (const rating of softskillRatings) {
        const {
          criterionId,
          trainerRating: skillRating,
          trainerComment: skillComment,
          releaseRating: skillReleaseRating,
          releaseComment: skillReleaseComment,
        } = rating;

        if (!criterionId) continue;

        // Check if rating exists
        const existingRatings = await db
          .select()
          .from(weeklySoftskillRatings)
          .where(
            and(
              eq(weeklySoftskillRatings.weeklyEvaluationId, evaluation.id),
              eq(
                weeklySoftskillRatings.softskillCriterionId,
                criterionId as any
              )
            )
          );

        if (existingRatings.length > 0) {
          const existingRating = existingRatings[0];

          if (isRelease && skillReleaseRating) {
            // Setting release rating for softskill
            if (
              existingRating.releaseRating &&
              existingRating.releaseRating !== String(skillReleaseRating)
            ) {
              await db.insert(gradeEditHistory).values({
                entityType: 'SOFTSKILL_RATING',
                entityId: existingRating.id,
                fieldName: 'releaseRating',
                oldValue: existingRating.releaseRating,
                newValue: String(skillReleaseRating),
                changedBy: trainerId,
                changeReason: editReason || null,
              });
            }

            await db
              .update(weeklySoftskillRatings)
              .set({
                releaseRating: String(skillReleaseRating) as any,
                releaseComment: skillReleaseComment || null,
                updatedAt: now,
              })
              .where(
                and(
                  eq(weeklySoftskillRatings.id, existingRating.id),
                  eq(weeklySoftskillRatings.weeklyEvaluationId, evaluation.id),
                  ratingAccessCondition(session)
                )
              );
          } else if (skillRating) {
            // Audit trail for trainer rating changes
            if (
              existingRating.trainerRating &&
              existingRating.trainerRating !== String(skillRating)
            ) {
              await db.insert(gradeEditHistory).values({
                entityType: 'SOFTSKILL_RATING',
                entityId: existingRating.id,
                fieldName: 'trainerRating',
                oldValue: existingRating.trainerRating,
                newValue: String(skillRating),
                changedBy: trainerId,
                changeReason: editReason || null,
              });
            }

            // Update trainer rating
            await db
              .update(weeklySoftskillRatings)
              .set({
                trainerRating: String(skillRating) as any,
                trainerComment: skillComment || null,
                updatedAt: now,
              })
              .where(
                and(
                  eq(weeklySoftskillRatings.id, existingRating.id),
                  eq(weeklySoftskillRatings.weeklyEvaluationId, evaluation.id),
                  ratingAccessCondition(session)
                )
              );
          }
        } else if (skillRating) {
          // Insert new rating
          const insertValues: any = {
            weeklyEvaluationId: evaluation.id,
            softskillCriterionId: criterionId,
            trainerRating: String(skillRating) as any,
            trainerComment: skillComment || null,
          };

          // Include release rating if provided
          if (isRelease && skillReleaseRating) {
            insertValues.releaseRating = String(skillReleaseRating) as any;
            insertValues.releaseComment = skillReleaseComment || null;
          }

          await db.insert(weeklySoftskillRatings).values(insertValues);
        }
      }
    }

    // Fetch updated ratings to return
    const updatedRatings = await db
      .select({
        id: weeklySoftskillRatings.id,
        softskillCriterionId: weeklySoftskillRatings.softskillCriterionId,
        trainerRating: weeklySoftskillRatings.trainerRating,
        releaseRating: weeklySoftskillRatings.releaseRating,
        trainerComment: weeklySoftskillRatings.trainerComment,
        releaseComment: weeklySoftskillRatings.releaseComment,
      })
      .from(weeklySoftskillRatings)
      .where(eq(weeklySoftskillRatings.weeklyEvaluationId, evaluation.id));

    return NextResponse.json({
      success: true,
      evaluation,
      softskillRatings: updatedRatings,
    });
  } catch (error: any) {
    const pgCode = error?.cause?.code ?? error?.code;
    console.error('Error saving weekly evaluation:', {
      message: error?.message,
      code: pgCode,
      detail: error?.cause?.detail ?? error?.detail,
      column: error?.cause?.column ?? error?.column,
      constraint: error?.cause?.constraint ?? error?.constraint,
    });
    return NextResponse.json(
      { error: 'Interner Serverfehler beim Speichern der Bewertung' },
      { status: 500 }
    );
  }
}
