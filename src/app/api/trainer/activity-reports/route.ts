/**
 * Trainer Activity Reports Management API
 *
 * GET /api/trainer/activity-reports - List pending reports for approval
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import {
  activityReports,
  activityReportUseCaseEntries,
  profiles,
} from '@/db/migrations/schemas/schema';
import {
  getTrainerScope,
  isTraineeVisibleToTrainer,
} from '@/lib/trainer-scope';

// GET /api/trainer/activity-reports?trainerId=...&status=...
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');
    const status = searchParams.get('status');
    const traineeId = searchParams.get('traineeId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    const scope = await getTrainerScope(trainerId);
    if (!scope) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const traineeConditions: any[] = [eq(profiles.role, 'TRAINEE')];
    if (scope.canSeeOrgWide) {
      if (!scope.isPlatformOwner && scope.organizationId) {
        traineeConditions.push(
          eq(profiles.organizationId, scope.organizationId as any)
        );
      }
    } else {
      const traineeAccessFilters: any[] = [
        inArray(profiles.assignedTrainerId, scope.profileIds as any),
      ];
      if (scope.organizationId) {
        traineeAccessFilters.push(
          eq(profiles.organizationId, scope.organizationId as any)
        );
      }
      traineeConditions.push(or(...traineeAccessFilters)!);
    }

    if (!scope.canSeeOrgWide && traineeId) {
      const [requestedTrainee] = await db
        .select({
          assignedTrainerId: profiles.assignedTrainerId,
          organizationId: profiles.organizationId,
        })
        .from(profiles)
        .where(eq(profiles.id, traineeId as any));

      if (
        !requestedTrainee ||
        !isTraineeVisibleToTrainer(scope, requestedTrainee)
      ) {
        return NextResponse.json(
          { error: 'Trainee is not assigned to this trainer' },
          { status: 403 }
        );
      }
    }

    const trainees = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        organizationId: profiles.organizationId,
        assignedTrainerId: profiles.assignedTrainerId,
      })
      .from(profiles)
      .where(and(...traineeConditions));

    const traineeIds = trainees.map(t => String(t.id));
    const traineeMap = new Map(trainees.map(t => [t.id, t]));

    if (traineeIds.length === 0) {
      return NextResponse.json(
        { reports: [], meta: { total: 0, pending: 0 } },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    }

    // Build conditions
    const conditions: any[] = [];
    if (traineeId && traineeIds.includes(traineeId)) {
      conditions.push(eq(activityReports.traineeId, traineeId as any));
    } else {
      conditions.push(inArray(activityReports.traineeId, traineeIds as any));
    }
    if (
      status &&
      ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(status)
    ) {
      conditions.push(eq(activityReports.status, status as any));
    } else {
      conditions.push(
        or(
          eq(activityReports.status, 'SUBMITTED'),
          eq(activityReports.status, 'APPROVED'),
          eq(activityReports.status, 'REJECTED')
        )!
      );
    }

    const reports = await db
      .select()
      .from(activityReports)
      .where(and(...conditions))
      .orderBy(desc(activityReports.submittedAt));

    // FIX N+1: Batch-fetch ALL entries for ALL reports in ONE query
    const reportIds = reports.map(r => r.id);
    const allEntries =
      reportIds.length > 0
        ? await db
            .select()
            .from(activityReportUseCaseEntries)
            .where(
              inArray(activityReportUseCaseEntries.reportId, reportIds as any)
            )
        : [];

    // Group entries by reportId
    const entriesByReport = new Map<string, typeof allEntries>();
    for (const entry of allEntries) {
      const rid = String(entry.reportId);
      const arr = entriesByReport.get(rid) || [];
      arr.push(entry);
      entriesByReport.set(rid, arr);
    }

    const enrichedReports = reports.map(report => {
      const entries = entriesByReport.get(String(report.id)) || [];
      const totalHours = entries.reduce(
        (acc, e) => acc + (Number(e.actualHours) || 0),
        0
      );
      return {
        ...report,
        traineeName: traineeMap.get(report.traineeId)?.fullName || 'Unknown',
        traineeAusbildungDurationYears:
          traineeMap.get(report.traineeId)?.ausbildungDurationYears ?? 3,
        entryCount: entries.length,
        totalHours,
        hasOverbooking: entries.some(e => Boolean(e.isOverbooked)),
        isPending: report.status === 'SUBMITTED',
      };
    });

    const pending = enrichedReports.filter(
      r => r.status === 'SUBMITTED'
    ).length;

    return NextResponse.json(
      {
        reports: enrichedReports,
        meta: {
          total: enrichedReports.length,
          pending,
          assignedTrainees: trainees.length,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e) {
    console.error('List trainer reports error:', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
