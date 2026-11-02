import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, inArray } from 'drizzle-orm';
import { profiles, activityReports } from '@/db/migrations/schemas/schema';
import { requireTraineeScopeCondition } from '@/lib/auth/trainee-scope-conditions';
import {
  loadTraineeProgress,
  requireProgressScope,
} from '@/lib/trainer/trainee-progress';
import { requireReportCatalogFilter } from '@/lib/auth/activity-report-access';

/**
 * GET /api/trainer/trainees/with-stats
 *
 * Returns all trainees with their activity report stats in a SINGLE query.
 * This eliminates N+1 API calls pattern for better performance.
 *
 * Response includes:
 * - Basic trainee info
 * - Progress percentage
 * - Approved reports count
 * - Pending (submitted) reports count
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    // Only trainees of the own organization (the super admin sees every one)
    // and, with a chosen occupation (x-catalog), of that occupation. The
    // platform-owner flag of an organization does not widen the list.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;
    // The report numbers count the reports of the chosen occupation
    const reportCatalog = await requireReportCatalogFilter(session, req);
    if (isErrorResponse(reportCatalog)) return reportCatalog;

    const traineeRows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        firstName: profiles.firstName,
        lastName: profiles.lastName,
        email: profiles.email,
        avatarUrl: profiles.avatarUrl,
        isActive: profiles.isActive,
        trainerActivated: profiles.trainerActivated,
        birthDate: profiles.birthDate,
        startOfTrainingDate: profiles.startOfTrainingDate,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
      })
      .from(profiles)
      .where(traineeScope.condition);

    const traineeIds = traineeRows.map(t => String(t.id));

    if (traineeIds.length === 0) {
      return NextResponse.json({ trainees: [] });
    }

    // Get activity report stats for ALL trainees in ONE query
    const reportStats = await db
      .select({
        traineeId: activityReports.traineeId,
        status: activityReports.status,
        reportCount: count(),
      })
      .from(activityReports)
      .where(
        and(
          inArray(activityReports.traineeId, traineeIds as any),
          reportCatalog.condition ?? undefined
        )
      )
      .groupBy(activityReports.traineeId, activityReports.status);

    // Build a map of traineeId -> { approved, pending }
    const statsMap = new Map<string, { approved: number; pending: number }>();
    traineeIds.forEach(id => statsMap.set(id, { approved: 0, pending: 0 }));

    reportStats.forEach(row => {
      const tid = String(row.traineeId);
      const existing = statsMap.get(tid) || { approved: 0, pending: 0 };
      if (row.status === 'APPROVED') {
        existing.approved = Number(row.reportCount);
      } else if (row.status === 'SUBMITTED') {
        existing.pending = Number(row.reportCount);
      }
      statsMap.set(tid, existing);
    });

    // Progress: the one figure of every trainer page, over the courses of the
    // chosen occupation (src/lib/trainer/trainee-progress.ts)
    const scope = await requireProgressScope(session, req);
    if (isErrorResponse(scope)) return scope;
    const progress = await loadTraineeProgress(traineeIds, scope);

    // Build final response
    const trainees = traineeRows.map(t => {
      const uid = String(t.id);
      const pct = progress.byTrainee.get(uid)?.pct ?? 0;
      const stats = statsMap.get(uid) || { approved: 0, pending: 0 };

      return {
        id: t.id,
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        full_name: t.fullName,
        avatar_url: t.avatarUrl,
        birth_date: t.birthDate ? new Date(t.birthDate).toISOString() : null,
        training_start_date: t.startOfTrainingDate
          ? new Date(t.startOfTrainingDate).toISOString()
          : null,
        ausbildungDurationYears: t.ausbildungDurationYears ?? 3,
        ausbildung_duration_years: t.ausbildungDurationYears ?? 3,
        progress: pct,
        isActive: Boolean(t.isActive),
        approvedReports: stats.approved,
        pendingReports: stats.pending,
      };
    });

    return NextResponse.json({ trainees });
  } catch (e) {
    console.error('List trainees with stats error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
