import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
    weeklyEvaluations,
    weeklySoftskillRatings,
    mesSoftskillCriteria,
} from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';

// GET: Fetch trainee's evaluations
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const userId = searchParams.get('userId');

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        // Simplified query
        const evaluations = await db
            .select()
            .from(weeklyEvaluations)
            .where(eq(weeklyEvaluations.traineeId, userId))
            .orderBy(desc(weeklyEvaluations.year), desc(weeklyEvaluations.weekNumber));

        return NextResponse.json({ evaluations });
    } catch (error: unknown) {
        console.error('Error fetching evaluations:', error);
        const msg = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: 'Failed to fetch evaluations', details: msg },
            { status: 500 }
        );
    }
}

// POST: Create or update trainee self-assessment
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            userId,
            weekNumber,
            year,
            ausbildungsjahr,
            selfRating,
            selfComment,
            submit = false,
        } = body;

        if (!userId || !weekNumber || !year || !ausbildungsjahr) {
            return NextResponse.json(
                { error: 'userId, weekNumber, year, and ausbildungsjahr are required' },
                { status: 400 }
            );
        }

        // Check if evaluation already exists for this week
        const existingEvaluation = await db
            .select()
            .from(weeklyEvaluations)
            .where(and(
                eq(weeklyEvaluations.traineeId, userId),
                eq(weeklyEvaluations.weekNumber, weekNumber),
                eq(weeklyEvaluations.year, year)
            ))
            .limit(1);

        let evaluationId: string;

        if (existingEvaluation.length > 0) {
            const existing = existingEvaluation[0];
            if (existing.status === 'APPROVED') {
                return NextResponse.json(
                    { error: 'Cannot modify an approved evaluation' },
                    { status: 400 }
                );
            }

            const [updated] = await db
                .update(weeklyEvaluations)
                .set({
                    selfRating: selfRating || null,
                    selfComment: selfComment?.substring(0, 500) || null,
                    selfSubmittedAt: submit ? new Date() : existing.selfSubmittedAt,
                    status: submit ? 'SUBMITTED' : existing.status,
                    updatedAt: new Date(),
                })
                .where(eq(weeklyEvaluations.id, existing.id))
                .returning();

            evaluationId = updated.id;
        } else {
            return NextResponse.json(
                { error: 'Evaluation not found. Please create one first.' },
                { status: 404 }
            );
        }

        return NextResponse.json({
            success: true,
            evaluationId,
            message: submit ? 'Evaluation submitted' : 'Draft saved'
        });
    } catch (error: unknown) {
        console.error('Error saving evaluation:', error);
        const msg = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: 'Failed to save evaluation', details: msg },
            { status: 500 }
        );
    }
}
