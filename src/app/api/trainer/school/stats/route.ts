import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, sql, and, gte, lte } from 'drizzle-orm';
import { activityReports, profiles, schoolExams } from '@/db/migrations/schemas/schema';

// GET /api/trainer/school/stats?trainerId=...
export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const trainerId = url.searchParams.get('trainerId');

        if (!trainerId) {
            return NextResponse.json({ error: 'trainerId required' }, { status: 400 });
        }

        // Count pending activity reports
        const pendingReportsResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(activityReports)
            .where(eq(activityReports.status, 'SUBMITTED'));
        const pendingReports = pendingReportsResult[0]?.count || 0;

        // Count upcoming exams (next 30 days)
        const now = new Date();
        const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        const upcomingExamsResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schoolExams)
            .where(
                and(
                    gte(schoolExams.examDate, now),
                    lte(schoolExams.examDate, thirtyDaysLater)
                )
            );
        const upcomingExams = upcomingExamsResult[0]?.count || 0;

        // Count active trainees
        const traineesResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(profiles)
            .where(
                and(
                    eq(profiles.role, 'TRAINEE'),
                    eq(profiles.isActive, true)
                )
            );
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
