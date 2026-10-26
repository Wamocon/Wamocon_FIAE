import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, sql, and, gte, lte } from 'drizzle-orm';
import { activityReports, profiles, schoolExams } from '@/db/migrations/schemas/schema';
import {
    requireTraineeScopeCondition,
    traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';

// GET /api/trainer/school/stats?trainerId=...
export async function GET(req: NextRequest) {
    try {
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        // Everything is counted for the trainees of the own organization (the
        // super admin: every one) and, with a chosen occupation (x-catalog), of
        // that occupation. The platform-owner flag of an organization does not
        // widen the numbers.
        const traineeScope = await requireTraineeScopeCondition(session, req);
        if (isErrorResponse(traineeScope)) return traineeScope;

        // Count pending activity reports (trainee-scoped)
        const reportConditions: any[] = [
            eq(activityReports.status, 'SUBMITTED'),
            traineeIdInScope(activityReports.traineeId, traineeScope.condition),
        ];
        const pendingReportsResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(activityReports)
            .where(and(...reportConditions));
        const pendingReports = pendingReportsResult[0]?.count || 0;

        // Count upcoming exams (next 30 days, trainee-scoped)
        const now = new Date();
        const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const examConditions: any[] = [
            gte(schoolExams.examDate, now),
            lte(schoolExams.examDate, thirtyDaysLater),
            traineeIdInScope(schoolExams.traineeId, traineeScope.condition),
        ];
        const upcomingExamsResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schoolExams)
            .where(and(...examConditions));
        const upcomingExams = upcomingExamsResult[0]?.count || 0;

        // Count active trainees (scoped)
        const traineeConditions: any[] = [
            traineeScope.condition,
            eq(profiles.isActive, true),
        ];
        const traineesResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(profiles)
            .where(and(...traineeConditions));
        const trainees = traineesResult[0]?.count || 0;

        return NextResponse.json({
            pendingReports,
            upcomingExams,
            trainees,
        });
    } catch (e) {
        console.error('Get trainer school stats error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
