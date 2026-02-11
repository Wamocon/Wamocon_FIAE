import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
    weeklyEvaluations,
    profiles,
} from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';

// GET: Fetch pending evaluations for trainer review
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const trainerId = searchParams.get('trainerId');
        const status = searchParams.get('status') || 'SUBMITTED';
        const traineeId = searchParams.get('traineeId');
        const year = searchParams.get('year');

        if (!trainerId) {
            return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
        }

        // Build query conditions
        const conditions = [eq(weeklyEvaluations.trainerId, trainerId as any)];

        if (status) {
            conditions.push(eq(weeklyEvaluations.status, status as any));
        }
        if (traineeId) {
            conditions.push(eq(weeklyEvaluations.traineeId, traineeId as any));
        }
        if (year) {
            conditions.push(eq(weeklyEvaluations.year, parseInt(year)));
        }

        // Fetch evaluations with trainee info
        const evaluations = await db
            .select({
                evaluation: weeklyEvaluations,
                trainee: profiles,
            })
            .from(weeklyEvaluations)
            .innerJoin(profiles, eq(weeklyEvaluations.traineeId, profiles.id))
            .where(and(...conditions))
            .orderBy(desc(weeklyEvaluations.createdAt));

        // Count pending evaluations
        const pendingCount = await db
            .select()
            .from(weeklyEvaluations)
            .where(and(
                eq(weeklyEvaluations.trainerId, trainerId as any),
                eq(weeklyEvaluations.status, 'SUBMITTED')
            ));

        return NextResponse.json({
            evaluations,
            pendingCount: pendingCount.length
        });
    } catch (error) {
        console.error('Error fetching trainer evaluations:', error);
        return NextResponse.json(
            { error: 'Failed to fetch evaluations' },
            { status: 500 }
        );
    }
}
