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

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET: Fetch single evaluation with softskill ratings
export async function GET(request: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;

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
        const { id } = await params;

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

        const body = await request.json();
        const {
            trainerRating,
            trainerComment,
            softskillRatings,
            isReleaseEdit = false,
            releaseRating,
            releaseComment,
            editReason,
        } = body;

        // Block modification of APPROVED evaluations unless it's a release grade edit
        if (evaluation.status === 'APPROVED' && !isReleaseEdit) {
            return NextResponse.json({ error: 'Cannot modify an approved evaluation' }, { status: 400 });
        }

        if (!isReleaseEdit && !trainerRating) {
            return NextResponse.json({ error: 'Trainer rating is required' }, { status: 400 });
        }

        if (isReleaseEdit) {
            // Release grade edit on APPROVED evaluation
            const updateData: Record<string, unknown> = { updatedAt: new Date() };

            if (releaseRating !== undefined) {
                // Log audit trail if rating changed
                if (evaluation.releaseRating !== releaseRating && body.trainerId) {
                    await db.insert(gradeEditHistory).values({
                        entityType: 'WEEKLY_EVALUATION',
                        entityId: id,
                        fieldName: 'releaseRating',
                        oldValue: evaluation.releaseRating || null,
                        newValue: releaseRating,
                        changedBy: body.trainerId,
                        changeReason: editReason || null,
                    });
                }
                updateData.releaseRating = releaseRating;
                updateData.releaseComment = releaseComment?.substring(0, 500) || null;
                updateData.releasedAt = new Date();
                updateData.releasedBy = body.trainerId || null;
            }

            // Also allow editing trainer rating on release edit
            if (trainerRating !== undefined) {
                if (evaluation.trainerRating !== trainerRating && body.trainerId) {
                    await db.insert(gradeEditHistory).values({
                        entityType: 'WEEKLY_EVALUATION',
                        entityId: id,
                        fieldName: 'trainerRating',
                        oldValue: evaluation.trainerRating || null,
                        newValue: trainerRating,
                        changedBy: body.trainerId,
                        changeReason: editReason || null,
                    });
                }
                updateData.trainerRating = trainerRating;
                updateData.trainerComment = trainerComment?.substring(0, 500) || null;
            }

            await db
                .update(weeklyEvaluations)
                .set(updateData)
                .where(eq(weeklyEvaluations.id, id as any));

            // Update softskill release ratings
            if (softskillRatings && Array.isArray(softskillRatings)) {
                for (const { criterionId, releaseRating: sRating, releaseComment: sComment, trainerRating: tRating, trainerComment: tComment } of softskillRatings) {
                    const existingRating = await db
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
                        await db
                            .update(weeklySoftskillRatings)
                            .set(updatePayload)
                            .where(eq(weeklySoftskillRatings.id, existingRating[0].id));
                    }
                }
            }

            return NextResponse.json({
                success: true,
                message: 'Release grade saved',
            });
        }

        // Standard trainer assessment (non-release edit)
        // Update evaluation
        await db
            .update(weeklyEvaluations)
            .set({
                trainerRating,
                trainerComment: trainerComment?.substring(0, 500) || null,
                updatedAt: new Date(),
            })
            .where(eq(weeklyEvaluations.id, id as any));

        // Update softskill ratings
        if (softskillRatings && Array.isArray(softskillRatings)) {
            for (const { criterionId, trainerRating: rating, trainerComment: comment } of softskillRatings) {
                const existingRating = await db
                    .select()
                    .from(weeklySoftskillRatings)
                    .where(and(
                        eq(weeklySoftskillRatings.weeklyEvaluationId, id as any),
                        eq(weeklySoftskillRatings.softskillCriterionId, criterionId as any)
                    ))
                    .limit(1);

                if (existingRating.length > 0) {
                    await db
                        .update(weeklySoftskillRatings)
                        .set({
                            trainerRating: rating,
                            trainerComment: comment?.substring(0, 500) || null,
                            updatedAt: new Date(),
                        })
                        .where(eq(weeklySoftskillRatings.id, existingRating[0].id));
                } else {
                    await db
                        .insert(weeklySoftskillRatings)
                        .values({
                            weeklyEvaluationId: id,
                            softskillCriterionId: criterionId,
                            trainerRating: rating,
                        });
                }
            }
        }

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
        const { id } = await params;

        const evaluationRows = await db
            .select()
            .from(weeklyEvaluations)
            .where(eq(weeklyEvaluations.id, id as any))
            .limit(1);

        if (evaluationRows.length === 0) {
            return NextResponse.json({ error: 'Evaluation not found' }, { status: 404 });
        }

        const evaluation = evaluationRows[0];

        const body = await request.json();
        const { action, rejectionReason, trainerId } = body;

        if (!['approve', 'reject'].includes(action)) {
            return NextResponse.json({ error: 'Invalid action. Use "approve" or "reject"' }, { status: 400 });
        }

        // For approval, ensure trainer has provided ratings
        if (action === 'approve' && !evaluation.trainerRating) {
            return NextResponse.json({ error: 'Trainer rating required before approval' }, { status: 400 });
        }

        const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';

        await db
            .update(weeklyEvaluations)
            .set({
                status: newStatus,
                trainerApprovedAt: action === 'approve' ? new Date() : null,
                rejectionReason: action === 'reject' ? rejectionReason : null,
                updatedAt: new Date(),
            })
            .where(eq(weeklyEvaluations.id, id as any));

        // Create notification for trainee
        if (trainerId) {
            const organizationId = await getUserOrgId(trainerId);
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
