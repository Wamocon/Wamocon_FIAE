import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, desc, and } from 'drizzle-orm';
import { activityReports, activityReportEntries, profiles } from '@/db/migrations/schemas/schema';
import { getUserOrgId, verifyPlatformOwner, verifyTrainer } from '@/lib/auth-helpers';

// GET /api/trainer/school/activity-reports?trainerId=...&status=...
export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const trainerId = url.searchParams.get('trainerId');
        const status = url.searchParams.get('status');

        if (!trainerId) {
            return NextResponse.json({ error: 'trainerId required' }, { status: 400 });
        }

        if (!(await verifyTrainer(trainerId))) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const isPO = await verifyPlatformOwner(trainerId);
        const trainerOrgId = await getUserOrgId(trainerId);

        const conditions: any[] = [];
        if (status) conditions.push(eq(activityReports.status, status as any));
        if (!isPO && trainerOrgId) {
            conditions.push(eq(activityReports.organizationId, trainerOrgId));
        }

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get reports with trainee info (org-scoped)
        const reportsRaw = await db
            .select({
                id: activityReports.id,
                traineeId: activityReports.traineeId,
                weekNumber: activityReports.weekNumber,
                year: activityReports.year,
                status: activityReports.status,
                submittedAt: activityReports.submittedAt,
                traineeName: profiles.fullName,
            })
            .from(activityReports)
            .leftJoin(profiles, eq(profiles.id, activityReports.traineeId))
            .where(whereClause)
            .orderBy(desc(activityReports.submittedAt));

        // Get entry totals for each report
        const reports = await Promise.all(
            reportsRaw.map(async (report) => {
                const entries = await db
                    .select({
                        betrieblicheStunden: activityReportEntries.betrieblicheStunden,
                        unterweisungenStunden: activityReportEntries.unterweisungenStunden,
                        berufsschulStunden: activityReportEntries.berufsschulStunden,
                    })
                    .from(activityReportEntries)
                    .where(eq(activityReportEntries.reportId, report.id as any));

                const totals = entries.reduce(
                    (acc, e) => ({
                        betrieblicheStunden: (acc.betrieblicheStunden ?? 0) + (e.betrieblicheStunden ?? 0),
                        unterweisungenStunden: (acc.unterweisungenStunden ?? 0) + (e.unterweisungenStunden ?? 0),
                        berufsschulStunden: (acc.berufsschulStunden ?? 0) + (e.berufsschulStunden ?? 0),
                    }),
                    { betrieblicheStunden: 0, unterweisungenStunden: 0, berufsschulStunden: 0 }
                );

                return {
                    ...report,
                    ...totals,
                    totalHours: (totals.betrieblicheStunden ?? 0) + (totals.unterweisungenStunden ?? 0) + (totals.berufsschulStunden ?? 0),
                };
            })
        );

        return NextResponse.json({ reports });
    } catch (e) {
        console.error('Get trainer activity reports error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
