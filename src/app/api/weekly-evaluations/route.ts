import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { weeklyEvaluations, weeklySoftskillRatings, mesSoftskillCriteria, gradeEditHistory } from '@/db/migrations/schemas/schema';
import { eq, and, asc } from 'drizzle-orm';

// GET: Get evaluation for a specific activity report
export async function GET(request: NextRequest) {
    try {
        const url = new URL(request.url);
        const activityReportId = url.searchParams.get('activityReportId');

        if (!activityReportId) {
            return NextResponse.json({ error: 'activityReportId required' }, { status: 400 });
        }

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
            .innerJoin(mesSoftskillCriteria, eq(weeklySoftskillRatings.softskillCriterionId, mesSoftskillCriteria.id))
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
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// POST: Create or update weekly evaluation with softskill ratings
// Supports: trainer ratings, release ratings, and grade editing with audit trail
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { 
            activityReportId, 
            traineeId, 
            trainerId, 
            weekNumber, 
            year, 
            ausbildungsjahr,
            trainerRating,
            trainerComment,
            releaseRating,
            releaseComment,
            softskillRatings, // Array of { criterionId, trainerRating, trainerComment, releaseRating?, releaseComment? }
            isRelease, // Boolean: if true, we're setting release grades
            softskillsOnly, // Boolean: if true, only update softskill ratings, don't overwrite overall trainerRating
            editReason, // Optional reason for editing (audit trail)
        } = body;

        if (!activityReportId || !traineeId || !trainerId || !weekNumber || !year || !ausbildungsjahr) {
            return NextResponse.json({ 
                error: 'Missing required fields: activityReportId, traineeId, trainerId, weekNumber, year, ausbildungsjahr' 
            }, { status: 400 });
        }

        // Check if evaluation already exists for this activity report
        const existingEvaluations = await db
            .select()
            .from(weeklyEvaluations)
            .where(eq(weeklyEvaluations.activityReportId, activityReportId as any));

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
                if (existing.releaseRating && releaseRatingStr && existing.releaseRating !== releaseRatingStr) {
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
                    .where(eq(weeklyEvaluations.id, existing.id))
                    .returning();
                evaluation = updated[0];
            } else if (softskillsOnly) {
                // Only updating softskill ratings, don't overwrite the overall trainerRating
                evaluation = existing;
            } else {
                // Audit trail for trainer rating changes
                if (existing.trainerRating && existing.trainerRating !== trainerRatingStr) {
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
                    .where(eq(weeklyEvaluations.id, existing.id))
                    .returning();
                evaluation = updated[0];
            }
        } else {
            // Create new evaluation
            const insertValues: any = {
                traineeId,
                trainerId,
                activityReportId,
                weekNumber,
                year,
                ausbildungsjahr,
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

        // Update or create softskill ratings
        if (softskillRatings && Array.isArray(softskillRatings)) {
            for (const rating of softskillRatings) {
                const { criterionId, trainerRating: skillRating, trainerComment: skillComment, releaseRating: skillReleaseRating, releaseComment: skillReleaseComment } = rating;
                
                if (!criterionId) continue;

                // Check if rating exists
                const existingRatings = await db
                    .select()
                    .from(weeklySoftskillRatings)
                    .where(and(
                        eq(weeklySoftskillRatings.weeklyEvaluationId, evaluation.id),
                        eq(weeklySoftskillRatings.softskillCriterionId, criterionId as any)
                    ));

                if (existingRatings.length > 0) {
                    const existingRating = existingRatings[0];

                    if (isRelease && skillReleaseRating) {
                        // Setting release rating for softskill
                        if (existingRating.releaseRating && existingRating.releaseRating !== String(skillReleaseRating)) {
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
                            .where(eq(weeklySoftskillRatings.id, existingRating.id));
                    } else if (skillRating) {
                        // Audit trail for trainer rating changes
                        if (existingRating.trainerRating && existingRating.trainerRating !== String(skillRating)) {
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
                            .where(eq(weeklySoftskillRatings.id, existingRating.id));
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

                    await db
                        .insert(weeklySoftskillRatings)
                        .values(insertValues);
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
            softskillRatings: updatedRatings 
        });
    } catch (error: any) {
        console.error('Error saving weekly evaluation:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
