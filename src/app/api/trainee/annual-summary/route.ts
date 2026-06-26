import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { weeklyEvaluations } from '@/db/migrations/schemas/schema';
import { eq, and } from 'drizzle-orm';

// GET: Get annual performance summary for a trainee
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const traineeId = searchParams.get('traineeId');
        const year = searchParams.get('year') ? parseInt(searchParams.get('year')!) : new Date().getFullYear();
        const ausbildungsjahr = searchParams.get('ausbildungsjahr') ? parseInt(searchParams.get('ausbildungsjahr')!) : null;

        if (!traineeId) {
            return NextResponse.json({ error: 'traineeId is required' }, { status: 400 });
        }

        // Build query conditions
        const conditions = [
            eq(weeklyEvaluations.traineeId, traineeId),
            eq(weeklyEvaluations.status, 'APPROVED'),
        ];

        if (ausbildungsjahr) {
            conditions.push(eq(weeklyEvaluations.ausbildungsjahr, ausbildungsjahr));
        }

        // Fetch all approved evaluations for the period
        const evaluations = await db
            .select({
                id: weeklyEvaluations.id,
                weekNumber: weeklyEvaluations.weekNumber,
                year: weeklyEvaluations.year,
                ausbildungsjahr: weeklyEvaluations.ausbildungsjahr,
                selfRating: weeklyEvaluations.selfRating,
                trainerRating: weeklyEvaluations.trainerRating,
                selfComment: weeklyEvaluations.selfComment,
                trainerComment: weeklyEvaluations.trainerComment,
                arpThemeText: weeklyEvaluations.arpThemeText,
            })
            .from(weeklyEvaluations)
            .where(and(...conditions))
            .orderBy(weeklyEvaluations.year, weeklyEvaluations.weekNumber);

        // Calculate statistics
        const selfRatings = evaluations
            .filter(e => e.selfRating)
            .map(e => parseFloat(e.selfRating!));

        const trainerRatings = evaluations
            .filter(e => e.trainerRating)
            .map(e => parseFloat(e.trainerRating!));

        const selfAverage = selfRatings.length > 0
            ? selfRatings.reduce((a, b) => a + b, 0) / selfRatings.length
            : null;

        const trainerAverage = trainerRatings.length > 0
            ? trainerRatings.reduce((a, b) => a + b, 0) / trainerRatings.length
            : null;

        // Calculate overall average (prefer trainer ratings)
        const overallAverage = trainerAverage !== null
            ? trainerAverage
            : selfAverage;

        // Group by training phase.
        const byAusbildungsjahr: Record<number, {
            evaluations: typeof evaluations;
            selfAverage: number | null;
            trainerAverage: number | null;
            count: number;
        }> = {};

        evaluations.forEach(e => {
            const aj = e.ausbildungsjahr;
            if (!byAusbildungsjahr[aj]) {
                byAusbildungsjahr[aj] = {
                    evaluations: [],
                    selfAverage: null,
                    trainerAverage: null,
                    count: 0,
                };
            }
            byAusbildungsjahr[aj].evaluations.push(e);
            byAusbildungsjahr[aj].count++;
        });

        // Calculate averages per training phase.
        Object.keys(byAusbildungsjahr).forEach(key => {
            const aj = parseInt(key);
            const group = byAusbildungsjahr[aj];

            const selfRatingsGroup = group.evaluations
                .filter(e => e.selfRating)
                .map(e => parseFloat(e.selfRating!));

            const trainerRatingsGroup = group.evaluations
                .filter(e => e.trainerRating)
                .map(e => parseFloat(e.trainerRating!));

            group.selfAverage = selfRatingsGroup.length > 0
                ? Math.round((selfRatingsGroup.reduce((a, b) => a + b, 0) / selfRatingsGroup.length) * 100) / 100
                : null;

            group.trainerAverage = trainerRatingsGroup.length > 0
                ? Math.round((trainerRatingsGroup.reduce((a, b) => a + b, 0) / trainerRatingsGroup.length) * 100) / 100
                : null;
        });

        // Calculate grade distribution
        const gradeDistribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 };
        trainerRatings.forEach(r => {
            const grade = Math.round(r).toString();
            if (gradeDistribution[grade] !== undefined) {
                gradeDistribution[grade]++;
            }
        });

        // Performance trend (last 8 weeks)
        const recentEvaluations = evaluations.slice(-8);
        const trend = recentEvaluations.map(e => ({
            week: e.weekNumber,
            year: e.year,
            trainerRating: e.trainerRating ? parseFloat(e.trainerRating) : null,
            selfRating: e.selfRating ? parseFloat(e.selfRating) : null,
        }));

        // Warning flags
        const warnings: string[] = [];

        if (overallAverage !== null && overallAverage > 3.5) {
            warnings.push('PERFORMANCE_LOW');
        }

        if (overallAverage !== null && overallAverage > 4.0) {
            warnings.push('PERFORMANCE_CRITICAL');
        }

        // Check for inconsistency between self and trainer ratings
        if (selfAverage !== null && trainerAverage !== null) {
            const diff = Math.abs(selfAverage - trainerAverage);
            if (diff > 1.0) {
                warnings.push('RATING_DISCREPANCY');
            }
        }

        // Check for missing weeks
        const thisYear = new Date().getFullYear();
        const currentWeek = Math.ceil((new Date().getTime() - new Date(thisYear, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
        const expectedWeeks = year === thisYear ? currentWeek - 1 : 52;

        if (evaluations.length < expectedWeeks * 0.8) {
            warnings.push('MISSING_EVALUATIONS');
        }

        return NextResponse.json({
            summary: {
                traineeId,
                year,
                totalEvaluations: evaluations.length,
                selfAverage: selfAverage !== null ? Math.round(selfAverage * 100) / 100 : null,
                trainerAverage: trainerAverage !== null ? Math.round(trainerAverage * 100) / 100 : null,
                overallAverage: overallAverage !== null ? Math.round(overallAverage * 100) / 100 : null,
                gradeDistribution,
                byAusbildungsjahr: Object.fromEntries(
                    Object.entries(byAusbildungsjahr).map(([k, v]) => [k, {
                        count: v.count,
                        selfAverage: v.selfAverage,
                        trainerAverage: v.trainerAverage,
                    }])
                ),
                trend,
                warnings,
            },
            evaluations,
        });
    } catch (error: any) {
        console.error('Error in annual-summary API:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
