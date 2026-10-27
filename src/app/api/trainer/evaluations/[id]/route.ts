import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
    weeklyEvaluations,
    weeklySoftskillRatings,
    mesSoftskillCriteria,
    profiles,
    notifications,
    gradeEditHistory,
} from '@/db/migrations/schemas/schema';
import { eq, and } from 'drizzle-orm';
import { getUserOrgId } from '@/lib/auth-helpers';
import { notFoundUnlessUuid } from '@/lib/uuid';
import {
    MAX_REASON_LENGTH,
    invalidText,
    readJsonObject,
} from '@/lib/input-limits';
import {
    asGrade,
    invalidTrainerAssessmentInput,
    normalizeSoftskillGrades,
    unknownCriterion,
} from '@/lib/evaluation-input';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET: Fetch single evaluation with softskill ratings
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const session = await requireTrainer(request);
        if (isErrorResponse(session)) return session;

        const { id } = await params;
        const idNotFound = notFoundUnlessUuid(id, 'Evaluation not found');
        if (idNotFound) return idNotFound;

        // Fetch evaluation
        const evaluationRows = await db
            .select()
            .from(weeklyEvaluations)
            .where(eq(weeklyEvaluations.id, id as any))
            .limit(1);

        if (evaluationRows.length === 0) {
            return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
        }

        const evaluation = evaluationRows[0];

        const access = await requireTraineeAccess(session, String(evaluation.traineeId), request, 'Evaluation not found');
        if (isErrorResponse(access)) return access;

        // Fetch trainee info
        const traineeRows = await db
            .select()
            .from(profiles)
            .where(eq(profiles.id, evaluation.traineeId))
            .limit(1);

        // Fetch softskill ratings with criteria
        const softskillRatings = await db
            .select({
                rating: weeklySoftskillRatings,
                criterion: mesSoftskillCriteria,
            })
            .from(weeklySoftskillRatings)
            .innerJoin(mesSoftskillCriteria, eq(weeklySoftskillRatings.softskillCriterionId, mesSoftskillCriteria.id))
            .where(eq(weeklySoftskillRatings.weeklyEvaluationId, id as any))
            .orderBy(mesSoftskillCriteria.orderIndex);

        return NextResponse.json({
            evaluation,
            trainee: traineeRows[0] || null,
            softskillRatings,
        });
    } catch (error) {
        console.error('Error fetching evaluation:', error);
        return NextResponse.json(
            { error: 'Failed to fetch evaluation' },
            { status: 500 }
        );
    }
}

// PUT: Trainer submits assessment
export async function PUT(request: NextRequest, { params }: RouteParams) {
    try {
        const session = await requireTrainer(request);
        if (isErrorResponse(session)) return session;

        const { id } = await params;
        const idNotFound = notFoundUnlessUuid(id, 'Evaluation not found');
        if (idNotFound) return idNotFound;

        // Fetch evaluation
        const evaluationRows = await db
            .select()
            .from(weeklyEvaluations)
            .where(eq(weeklyEvaluations.id, id as any))
            .limit(1);

        if (evaluationRows.length === 0) {
            return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
        }

        const evaluation = evaluationRows[0];

        const access = await requireTraineeAccess(session, String(evaluation.traineeId), request, 'Evaluation not found');
        if (isErrorResponse(access)) return access;

        // A body that is no JSON object, a grade outside 1 to 6, an unknown
        // criterion and texts over the limit are a 400, checked before a write
        const body = await readJsonObject(request);
        if (isErrorResponse(body)) return body;
        const {
            trainerRating: rawTrainerRating,
            trainerComment,
            softskillRatings: rawSoftskillRatings,
            isReleaseEdit = false,
            releaseRating: rawReleaseRating,
            releaseComment,
            editReason,
        } = body as Record<string, any>;
        const invalidInput = invalidTrainerAssessmentInput(body, Boolean(isReleaseEdit));
        if (invalidInput) return invalidInput;
        // A grade is stored as the text of the enum: 3 and '3' are the same grade
        const trainerRating = asGrade(rawTrainerRating);
        const releaseRating = asGrade(rawReleaseRating);
        const softskillRatings = normalizeSoftskillGrades(rawSoftskillRatings);

        // Block modification of APPROVED evaluations unless it's a release grade edit
        if (evaluation.status === 'APPROVED' && !isReleaseEdit) {
            return NextResponse.json({ error: 'Cannot modify an approved evaluation' }, { status: 400 });
        }

        if (!isReleaseEdit && !trainerRating) {
            return NextResponse.json({ error: 'Trainer rating is required' }, { status: 400 });
        }

        // Every criterion has to exist, before anything is written
        const unknown = await unknownCriterion(softskillRatings);
        if (unknown) return unknown;

        // The status this decision was made on. The write carries it, so an
        // evaluation that was approved (or rejected) in the meantime is not
        // overwritten: nothing is changed then and the route answers 409.
        const changedMeanwhile = () =>
            NextResponse.json({ error: 'Evaluation was changed in the meantime' }, { status: 409 });
        const stillInStatus = and(
            eq(weeklyEvaluations.id, id as any),
            eq(weeklyEvaluations.traineeId, access.traineeId as any),
            eq(weeklyEvaluations.status, evaluation.status as any)
        );

        if (isReleaseEdit) {
            // Release grade edit on APPROVED evaluation
            const updateData: Record<string, unknown> = { updatedAt: new Date() };
            const history: Array<{ fieldName: string; oldValue: string | null; newValue: string }> = [];

            if (releaseRating !== undefined) {
                // Audit trail if rating changed (written together with the update)
                if (evaluation.releaseRating !== releaseRating && session.id) {
                    history.push({
                        fieldName: 'releaseRating',
                        oldValue: evaluation.releaseRating || null,
                        newValue: releaseRating,
                    });
                }
                updateData.releaseRating = releaseRating;
                updateData.releaseComment = releaseComment?.substring(0, 500) || null;
                updateData.releasedAt = new Date();
                updateData.releasedBy = session.id || null;
            }

            // Also allow editing trainer rating on release edit
            if (trainerRating !== undefined) {
                if (evaluation.trainerRating !== trainerRating && session.id) {
                    history.push({
                        fieldName: 'trainerRating',
                        oldValue: evaluation.trainerRating || null,
                        newValue: trainerRating,
                    });
                }
                updateData.trainerRating = trainerRating;
                updateData.trainerComment = trainerComment?.substring(0, 500) || null;
            }

            const saved = await db.transaction(async (tx) => {
                const [row] = await tx
                    .update(weeklyEvaluations)
                    .set(updateData)
                    .where(stillInStatus)
                    .returning({ id: weeklyEvaluations.id });
                if (!row) return false;

                for (const entry of history) {
                    await tx.insert(gradeEditHistory).values({
                        entityType: 'WEEKLY_EVALUATION',
                        entityId: id,
                        fieldName: entry.fieldName,
                        oldValue: entry.oldValue,
                        newValue: entry.newValue,
                        changedBy: session.id,
                        changeReason: editReason || null,
                    });
                }

                // Update softskill release ratings
                if (softskillRatings && Array.isArray(softskillRatings)) {
                    for (const { criterionId, releaseRating: sRating, releaseComment: sComment, trainerRating: tRating, trainerComment: tComment } of softskillRatings) {
                        const existingRating = await tx
                            .select()
                            .from(weeklySoftskillRatings)
                            .where(and(
                                eq(weeklySoftskillRatings.weeklyEvaluationId, id as any),
                                eq(weeklySoftskillRatings.softskillCriterionId, criterionId as any)
                            ))
                            .limit(1);

                        if (existingRating.length > 0) {
                            const updatePayload: Record<string, unknown> = { updatedAt: new Date() };
                            if (sRating !== undefined) {
                                updatePayload.releaseRating = sRating;
                                updatePayload.releaseComment = sComment?.substring(0, 500) || null;
                            }
                            if (tRating !== undefined) {
                                updatePayload.trainerRating = tRating;
                                updatePayload.trainerComment = tComment?.substring(0, 500) || null;
                            }
                            await tx
                                .update(weeklySoftskillRatings)
                                .set(updatePayload)
                                .where(eq(weeklySoftskillRatings.id, existingRating[0].id));
                        }
                    }
                }
                return true;
            });
            if (!saved) return changedMeanwhile();

            return NextResponse.json({
                success: true,
                message: 'Release grade saved',
            });
        }

        // Standard trainer assessment (non-release edit)
        const savedAssessment = await db.transaction(async (tx) => {
            // Update evaluation
            const [row] = await tx
                .update(weeklyEvaluations)
                .set({
                    trainerRating,
                    trainerComment: trainerComment?.substring(0, 500) || null,
                    updatedAt: new Date(),
                })
                .where(stillInStatus)
                .returning({ id: weeklyEvaluations.id });
            if (!row) return false;

            // Update softskill ratings
            if (softskillRatings && Array.isArray(softskillRatings)) {
                for (const { criterionId, trainerRating: rating, trainerComment: comment } of softskillRatings) {
                    const existingRating = await tx
                        .select()
                        .from(weeklySoftskillRatings)
                        .where(and(
                            eq(weeklySoftskillRatings.weeklyEvaluationId, id as any),
                            eq(weeklySoftskillRatings.softskillCriterionId, criterionId as any)
                        ))
                        .limit(1);

                    if (existingRating.length > 0) {
                        await tx
                            .update(weeklySoftskillRatings)
                            .set({
                                trainerRating: rating,
                                trainerComment: comment?.substring(0, 500) || null,
                                updatedAt: new Date(),
                            })
                            .where(eq(weeklySoftskillRatings.id, existingRating[0].id));
                    } else {
                        await tx
                            .insert(weeklySoftskillRatings)
                            .values({
                                weeklyEvaluationId: id,
                                softskillCriterionId: criterionId,
                                trainerRating: rating,
                            });
                    }
                }
            }
            return true;
        });
        if (!savedAssessment) return changedMeanwhile();

        return NextResponse.json({
            success: true,
            message: 'Trainer assessment saved'
        });
    } catch (error) {
        console.error('Error saving trainer assessment:', error);
        return NextResponse.json(
            { error: 'Failed to save assessment' },
            { status: 500 }
        );
    }
}

// PATCH: Approve or reject evaluation
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    try {
        const session = await requireTrainer(request);
        if (isErrorResponse(session)) return session;

        const { id } = await params;
        const idNotFound = notFoundUnlessUuid(id, 'Evaluation not found');
        if (idNotFound) return idNotFound;

        const evaluationRows = await db
            .select()
            .from(weeklyEvaluations)
            .where(eq(weeklyEvaluations.id, id as any))
            .limit(1);

        if (evaluationRows.length === 0) {
            return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
        }

        const evaluation = evaluationRows[0];

        const access = await requireTraineeAccess(session, String(evaluation.traineeId), request, 'Evaluation not found');
        if (isErrorResponse(access)) return access;

        const body = await readJsonObject(request);
        if (isErrorResponse(body)) return body;
        const { action, rejectionReason } = body as Record<string, any>;
        // The acting trainer is the authenticated user, never a client value
        const trainerId = session.id;

        if (!['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action. Use "approve" or "reject"' }, { status: 400 });
        }

        const reasonTooLong = invalidText('rejectionReason', rejectionReason, MAX_REASON_LENGTH);
        if (reasonTooLong) return reasonTooLong;

        // For approval, ensure trainer has provided ratings
        if (action === 'approve' && !evaluation.trainerRating) {
            return NextResponse.json({ error: 'Trainer rating required before approval' }, { status: 400 });
        }

        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        // The write carries the status the decision was made on: an evaluation
        // that was approved or rejected in the meantime is not overwritten and
        // gets no second notification
        const [changed] = await db
            .update(weeklyEvaluations)
            .set({
                status: newStatus,
                trainerApprovedAt: action === 'approve' ? new Date() : null,
                rejectionReason: action === 'reject' ? rejectionReason : null,
                updatedAt: new Date(),
            })
            .where(and(
                eq(weeklyEvaluations.id, id as any),
                eq(weeklyEvaluations.traineeId, access.traineeId as any),
                eq(weeklyEvaluations.status, evaluation.status as any)
            ))
            .returning({ id: weeklyEvaluations.id });
        if (!changed) {
            return NextResponse.json({ error: 'Evaluation was changed in the meantime' }, { status: 409 });
        }

        // Create notification for trainee
        if (trainerId) {
            const organizationId = await getUserOrgId(String(evaluation.traineeId));
            await db.insert(notifications).values({
                userId: evaluation.traineeId,
                actorId: trainerId,
                type: action === 'approve' ? 'EVALUATION_APPROVED' : 'EVALUATION_REJECTED',
                title: action === 'approve'
                    ? `KW ${evaluation.weekNumber} Bewertung genehmigt`
                    : `KW ${evaluation.weekNumber} Bewertung abgelehnt`,
                message: action === 'approve'
                    ? `Deine Leistungsbewertung für KW ${evaluation.weekNumber}/${evaluation.year} wurde genehmigt.`
                    : `Deine Leistungsbewertung für KW ${evaluation.weekNumber}/${evaluation.year} wurde abgelehnt. Grund: ${rejectionReason || 'Bitte korrigieren.'}`,
                linkUrl: '/trainee/evaluations',
                organizationId,
            });
        }

        return NextResponse.json({
            success: true,
            message: action === 'approve' ? 'Evaluation approved' : 'Evaluation rejected',
            newStatus,
        });
    } catch (error) {
        console.error('Error processing evaluation action:', error);
        return NextResponse.json(
            { error: 'Failed to process action' },
            { status: 500 }
        );
    }
}
