import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { weeklyEvaluations, weeklySoftskillRatings, mesSoftskillCriteria } from '@/db/migrations/schemas/schema';
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

        // Get all softskill ratings for this evaluation
        const ratings = await db
            .select({
                id: weeklySoftskillRatings.id,
                softskillCriterionId: weeklySoftskillRatings.softskillCriterionId,
                selfRating: weeklySoftskillRatings.selfRating,
                trainerRating: weeklySoftskillRatings.trainerRating,
                trainerComment: weeklySoftskillRatings.trainerComment,
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
            softskillRatings // Array of { criterionId, trainerRating, trainerComment }
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
                .where(eq(weeklyEvaluations.id, existingEvaluations[0].id))
                .returning();
            evaluation = updated[0];
        } else {
            // Create new evaluation
            const inserted = await db
                .insert(weeklyEvaluations)
                .values({
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
                } as any)
                .returning();
            evaluation = inserted[0];
        }

        // Update or create softskill ratings
        if (softskillRatings && Array.isArray(softskillRatings)) {
            for (const rating of softskillRatings) {
                const { criterionId, trainerRating: skillRating, trainerComment: skillComment } = rating;
                
                if (!criterionId || !skillRating) continue;

                // Check if rating exists
                const existingRatings = await db
                    .select()
                    .from(weeklySoftskillRatings)
                    .where(and(
                        eq(weeklySoftskillRatings.weeklyEvaluationId, evaluation.id),
                        eq(weeklySoftskillRatings.softskillCriterionId, criterionId as any)
                    ));

                if (existingRatings.length > 0) {
                    // Update
                    await db
                        .update(weeklySoftskillRatings)
                        .set({
                            trainerRating: String(skillRating) as any, // Convert to string for enum
                            trainerComment: skillComment || null,
                            updatedAt: now,
                        })
                        .where(eq(weeklySoftskillRatings.id, existingRatings[0].id));
                } else {
                    // Insert - but only if criterion exists
                    await db
                        .insert(weeklySoftskillRatings)
                        .values({
                            weeklyEvaluationId: evaluation.id,
                            softskillCriterionId: criterionId,
                            trainerRating: String(skillRating) as any, // Convert to string for enum
                            trainerComment: skillComment || null,
                        } as any);
                }
            }
        }

        // Fetch updated ratings to return
        const updatedRatings = await db
            .select({
                id: weeklySoftskillRatings.id,
                softskillCriterionId: weeklySoftskillRatings.softskillCriterionId,
                trainerRating: weeklySoftskillRatings.trainerRating,
                trainerComment: weeklySoftskillRatings.trainerComment,
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
