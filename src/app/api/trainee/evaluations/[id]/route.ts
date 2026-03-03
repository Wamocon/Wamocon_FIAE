import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
    weeklyEvaluations,
    weeklySoftskillRatings,
    mesSoftskillCriteria,
} from '@/db/migrations/schemas/schema';
import { eq } from 'drizzle-orm';

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/trainee/evaluations/[id]
 * 
 * Fetches a single evaluation with its softskill ratings.
 * Returns the same shape as the trainer endpoint so the PDF generation
 * can use the data identically.
 */
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
            return NextResponse.json({ error: 'Bewertung nicht gefunden' }, { status: 404 });
        }

        const evaluation = evaluationRows[0];

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
            softskillRatings,
        });
    } catch (error) {
        console.error('Error fetching trainee evaluation:', error);
        return NextResponse.json(
            { error: 'Interner Serverfehler' },
            { status: 500 }
        );
    }
}
