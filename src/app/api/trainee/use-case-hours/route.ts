import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, sql, ne } from 'drizzle-orm';
import { activityReports, activityReportUseCaseEntries, trainingUseCases } from '@/db/migrations/schemas/schema';
import { normalizePlannedHours } from '@/lib/ausbildung/planned-hours';

/**
 * GET /api/trainee/use-case-hours
 * Returns used hours per use case for a trainee across all non-rejected reports
 * (DRAFT + SUBMITTED + APPROVED). This prevents double-booking when multiple
 * reports are pending at the same time.
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const traineeId = searchParams.get('traineeId');
        const excludeReportId = searchParams.get('excludeReportId'); // For editing existing reports

        if (!traineeId) {
            return NextResponse.json({ error: 'Missing traineeId' }, { status: 400 });
        }

        // Get all non-rejected reports for this trainee (DRAFT + SUBMITTED + APPROVED)
        // This prevents double-booking: if a SUBMITTED report uses 10hrs of a use case,
        // a new report cannot also claim those hours.
        const activeReports = await db
            .select({ id: activityReports.id })
            .from(activityReports)
            .where(
                and(
                    eq(activityReports.traineeId, traineeId as any),
                    ne(activityReports.status, 'REJECTED')
                )
            );

        // Filter out the excluded report if editing
        const reportIds = activeReports
            .map(r => r.id)
            .filter(id => id !== excludeReportId);

        if (reportIds.length === 0) {
            // No active reports, fetch all use cases with 0 used hours
            const allUseCases = await db
                .select({
                    id: trainingUseCases.id,
                    description: trainingUseCases.description,
                    plannedHours: trainingUseCases.plannedHours,
                })
                .from(trainingUseCases);

            const result = allUseCases.map(uc => ({
                useCaseId: uc.id,
                totalHours: normalizePlannedHours(uc),
                usedHours: 0,
                remainingHours: normalizePlannedHours(uc),
            }));

            return NextResponse.json({ useCaseHours: result });
        }

        // Get sum of actual hours per use case from all active (non-rejected) reports
        const usedHoursQuery = await db
            .select({
                useCaseId: activityReportUseCaseEntries.useCaseId,
                totalUsed: sql<number>`COALESCE(SUM(${activityReportUseCaseEntries.actualHours}), 0)`.as('total_used'),
            })
            .from(activityReportUseCaseEntries)
            .where(sql`${activityReportUseCaseEntries.reportId} IN (${sql.join(reportIds.map(id => sql`${id}`), sql`, `)})`)
            .groupBy(activityReportUseCaseEntries.useCaseId);

        // Create a map for quick lookup
        const usedMap = new Map<string, number>();
        usedHoursQuery.forEach(row => {
            usedMap.set(row.useCaseId, Number(row.totalUsed) || 0);
        });

        // Get all use cases with their planned hours
        const allUseCases = await db
            .select({
                id: trainingUseCases.id,
                description: trainingUseCases.description,
                plannedHours: trainingUseCases.plannedHours,
            })
            .from(trainingUseCases);

        const result = allUseCases.map(uc => {
            const used = usedMap.get(uc.id) || 0;
            const totalHours = normalizePlannedHours(uc);
            return {
                useCaseId: uc.id,
                totalHours,
                usedHours: used,
                remainingHours: Math.max(0, totalHours - used),
            };
        });

        return NextResponse.json({ useCaseHours: result });
    } catch (error: any) {
        console.error('Error in use-case-hours GET:', error);
        return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
    }
}
