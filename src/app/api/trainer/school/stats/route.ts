import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, sql, and, gte, lte } from 'drizzle-orm';
import { activityReports, profiles, schoolExams } from '@/db/migrations/schemas/schema';
import { getUserOrgId, verifyPlatformOwner, verifyTrainer } from '@/lib/auth-helpers';

// GET /api/trainer/school/stats?trainerId=...
export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const trainerId = url.searchParams.get('trainerId');

        if (!trainerId) {
            return NextResponse.json({ error: 'trainerId required' }, { status: 400 });
        }

        if (!(await verifyTrainer(trainerId))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const isPO = await verifyPlatformOwner(trainerId);
        const trainerOrgId = await getUserOrgId(trainerId);

        const orgFilter = (!isPO && trainerOrgId)
            ? eq(activityReports.organizationId, trainerOrgId)
            : undefined;

        const orgFilterExams = (!isPO && trainerOrgId)
            ? eq(schoolExams.organizationId, trainerOrgId)
            : undefined;

        const orgFilterProfiles = (!isPO && trainerOrgId)
            ? eq(profiles.organizationId, trainerOrgId)
            : undefined;

        // Count pending activity reports (org-scoped)
        const reportConditions = [eq(activityReports.status, 'SUBMITTED')];
        if (orgFilter) reportConditions.push(orgFilter);
        const pendingReportsResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(activityReports)
            .where(and(...reportConditions));
        const pendingReports = pendingReportsResult[0]?.count || 0;

        // Count upcoming exams (next 30 days, org-scoped)
        const now = new Date();
        const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const examConditions: any[] = [
            gte(schoolExams.examDate, now),
            lte(schoolExams.examDate, thirtyDaysLater),
        ];
        if (orgFilterExams) examConditions.push(orgFilterExams);
        const upcomingExamsResult = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schoolExams)
            .where(and(...examConditions));
        const upcomingExams = upcomingExamsResult[0]?.count || 0;

        // Count active trainees (org-scoped)
        const traineeConditions: any[] = [
            eq(profiles.role, 'TRAINEE'),
            eq(profiles.isActive, true),
        ];
        if (orgFilterProfiles) traineeConditions.push(orgFilterProfiles);
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
