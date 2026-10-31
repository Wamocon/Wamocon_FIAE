import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, sql, ne } from 'drizzle-orm';
import { activityReports, activityReportUseCaseEntries, trainingComponents, trainingUseCases } from '@/db/migrations/schemas/schema';
import {
    isHoursLimited,
    normalizePlannedHours,
} from '@/lib/ausbildung/planned-hours';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
    catalogCondition,
    requireCatalogScopeForUser,
} from '@/lib/catalog/scope';

/**
 * GET /api/trainee/use-case-hours
 * Returns used hours per use case for a trainee across all non-rejected reports
 * (DRAFT + SUBMITTED + APPROVED). This prevents double-booking when multiple
 * reports are pending at the same time.
 */
export async function GET(request: NextRequest) {
    const session = await requireUser(request);
    if (isErrorResponse(session)) return session;
    // The hours of the session user, a traineeId in the query is ignored
    const traineeId = session.id;

    try {
        const { searchParams } = new URL(request.url);
        const excludeReportId = searchParams.get('excludeReportId'); // For editing existing reports

        const scope = await requireCatalogScopeForUser(traineeId, request);
        if (scope instanceof Response) return scope;

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
                    catalogId: trainingComponents.trainingCatalogId,
                })
                .from(trainingUseCases)
                .innerJoin(trainingComponents, eq(trainingUseCases.componentId, trainingComponents.id))
                .where(catalogCondition(trainingComponents.trainingCatalogId, scope));

            // A use case without hours (not FIAE) has no limit: it is left out here,
            // the page treats a use case without an entry as "allowed"
            const result = allUseCases.filter(uc => isHoursLimited(uc.plannedHours, uc.catalogId)).map(uc => ({
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
                catalogId: trainingComponents.trainingCatalogId,
            })
            .from(trainingUseCases)
                .innerJoin(trainingComponents, eq(trainingUseCases.componentId, trainingComponents.id))
                .where(catalogCondition(trainingComponents.trainingCatalogId, scope));

        const result = allUseCases.filter(uc => isHoursLimited(uc.plannedHours, uc.catalogId)).map(uc => {
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
