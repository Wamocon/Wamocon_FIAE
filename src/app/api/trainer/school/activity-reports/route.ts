import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, desc, and } from 'drizzle-orm';
import { activityReports, activityReportEntries, profiles } from '@/db/migrations/schemas/schema';
import {
    requireTraineeScopeCondition,
    traineeIdInScope,
} from '@/lib/auth/trainee-scope-conditions';

// GET /api/trainer/school/activity-reports?trainerId=...&status=...
export async function GET(req: NextRequest) {
    try {
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        const url = new URL(req.url);
        const status = url.searchParams.get('status');

        // Only reports of trainees of the own organization (the super admin:
        // every one) and, with a chosen occupation (x-catalog), of that
        // occupation. The platform-owner flag of an organization does not
        // widen the list.
        const traineeScope = await requireTraineeScopeCondition(session, req);
        if (isErrorResponse(traineeScope)) return traineeScope;

        const conditions: any[] = [
            traineeIdInScope(activityReports.traineeId, traineeScope.condition),
        ];
        if (status) conditions.push(eq(activityReports.status, status as any));

        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        // Get reports with trainee info (scoped)
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
