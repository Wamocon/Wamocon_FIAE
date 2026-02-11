import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { weeklyEvaluations, profiles } from '@/db/migrations/schemas/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';

// GET: Get annual performance summaries for all trainees (trainer view)
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const trainerId = searchParams.get('trainerId');
        const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();

        if (!trainerId) {
            return NextResponse.json({ error: 'trainerId is required' }, { status: 400 });
        }

        // Get all trainees that have evaluations with this trainer
        const traineeEvaluations = await db
            .select({
                traineeId: weeklyEvaluations.traineeId,
                traineeFullName: profiles.fullName,
                traineeEmail: profiles.email,
            })
            .from(weeklyEvaluations)
            .leftJoin(profiles, eq(weeklyEvaluations.traineeId, profiles.id))
            .where(eq(weeklyEvaluations.trainerId, trainerId))
            .groupBy(weeklyEvaluations.traineeId, profiles.fullName, profiles.email);

        // For each trainee, calculate their summary
        const summaries = await Promise.all(
            traineeEvaluations.map(async (trainee) => {
                const evaluations = await db
                    .select({
                        id: weeklyEvaluations.id,
                        weekNumber: weeklyEvaluations.weekNumber,
                        year: weeklyEvaluations.year,
                        ausbildungsjahr: weeklyEvaluations.ausbildungsjahr,
                        selfRating: weeklyEvaluations.selfRating,
                        trainerRating: weeklyEvaluations.trainerRating,
                        status: weeklyEvaluations.status,
                    })
                    .from(weeklyEvaluations)
                    .where(
                        and(
                            eq(weeklyEvaluations.traineeId, trainee.traineeId),
                            eq(weeklyEvaluations.status, 'APPROVED')
                        )
                    );

                const trainerRatings = evaluations
                    .filter(e => e.trainerRating)
                    .map(e => parseFloat(e.trainerRating!));

                const selfRatings = evaluations
                    .filter(e => e.selfRating)
                    .map(e => parseFloat(e.selfRating!));

                const trainerAverage = trainerRatings.length > 0
                    ? Math.round((trainerRatings.reduce((a, b) => a + b, 0) / trainerRatings.length) * 100) / 100
                    : null;

                const selfAverage = selfRatings.length > 0
                    ? Math.round((selfRatings.reduce((a, b) => a + b, 0) / selfRatings.length) * 100) / 100
                    : null;

                // Get pending count
                const pendingEvaluations = await db
                    .select({ id: weeklyEvaluations.id })
                    .from(weeklyEvaluations)
                    .where(
                        and(
                            eq(weeklyEvaluations.traineeId, trainee.traineeId),
                            eq(weeklyEvaluations.trainerId, trainerId),
                            eq(weeklyEvaluations.status, 'SUBMITTED')
                        )
                    );

                // Determine warnings
                const warnings: string[] = [];
                if (trainerAverage !== null && trainerAverage > 3.5) {
                    warnings.push('PERFORMANCE_LOW');
                }
                if (trainerAverage !== null && trainerAverage > 4.0) {
                    warnings.push('PERFORMANCE_CRITICAL');
                }

                // Get Ausbildungsjahr distribution
                const byAusbildungsjahr: Record<number, { count: number; average: number | null }> = {};
                [1, 2, 3].forEach(aj => {
                    const ajEvs = evaluations.filter(e => e.ausbildungsjahr === aj);
                    const ajRatings = ajEvs.filter(e => e.trainerRating).map(e => parseFloat(e.trainerRating!));
                    byAusbildungsjahr[aj] = {
                        count: ajEvs.length,
                        average: ajRatings.length > 0
                            ? Math.round((ajRatings.reduce((a, b) => a + b, 0) / ajRatings.length) * 100) / 100
                            : null,
                    };
                });

                return {
                    traineeId: trainee.traineeId,
                    traineeName: trainee.traineeFullName || 'Unknown',
                    traineeEmail: trainee.traineeEmail,
                    totalEvaluations: evaluations.length,
                    pendingCount: pendingEvaluations.length,
                    trainerAverage,
                    selfAverage,
                    byAusbildungsjahr,
                    warnings,
                };
            })
        );

        // Sort by warnings first (critical first), then by average (worst first)
        summaries.sort((a, b) => {
            if (a.warnings.includes('PERFORMANCE_CRITICAL') && !b.warnings.includes('PERFORMANCE_CRITICAL')) return -1;
            if (!a.warnings.includes('PERFORMANCE_CRITICAL') && b.warnings.includes('PERFORMANCE_CRITICAL')) return 1;
            if (a.pendingCount > 0 && b.pendingCount === 0) return -1;
            if (a.pendingCount === 0 && b.pendingCount > 0) return 1;
            return (b.trainerAverage || 0) - (a.trainerAverage || 0);
        });

        return NextResponse.json({
            summaries,
            totals: {
                trainees: summaries.length,
                pendingReviews: summaries.reduce((sum, s) => sum + s.pendingCount, 0),
                warningsCount: summaries.filter(s => s.warnings.length > 0).length,
            },
        });
    } catch (error: any) {
        console.error('Error in trainer annual-overview API:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
