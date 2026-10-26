import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
    weeklyEvaluations,
    profiles,
} from '@/db/migrations/schemas/schema';
import { eq, and, desc } from 'drizzle-orm';
import {
    requireTraineeScopeCondition,
    traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';

// GET: Fetch pending evaluations for trainer review
export async function GET(request: NextRequest) {
    try {
        const session = await requireTrainer(request);
        if (isErrorResponse(session)) return session;

        const { searchParams } = new URL(request.url);
        const trainerId = session.id;
        const status = searchParams.get('status') || 'SUBMITTED';
        const traineeId = searchParams.get('traineeId');
        const year = searchParams.get('year');

        // Only evaluations of trainees of the own organization (the super admin
        // sees every one) and, with a chosen occupation (x-catalog), of that
        // occupation
        const traineeScope = await requireTraineeScopeCondition(session, request);
        if (isErrorResponse(traineeScope)) return traineeScope;

        // Build query conditions
        const conditions = [
            eq(weeklyEvaluations.trainerId, trainerId as any),
            traineeScope.condition,
        ];

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
                eq(weeklyEvaluations.status, 'SUBMITTED'),
                traineeIdInScope(weeklyEvaluations.traineeId, traineeScope.condition)
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
