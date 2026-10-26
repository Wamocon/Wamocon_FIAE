/**
 * Trainer Activity Reports Management API
 *
 * GET /api/trainer/activity-reports - List pending reports for approval
 */

import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import {
  activityReports,
  activityReportUseCaseEntries,
  profiles,
} from '@/db/migrations/schemas/schema';
import { loadPhasePlansForUsers } from '@/lib/catalog/phase-plan-db';
import { requireTraineeScopeCondition } from '@/lib/auth/trainee-scope-conditions';

// GET /api/trainer/activity-reports?trainerId=...&status=...
export async function GET(req: NextRequest) {
  try {
    const session = await requireTrainer(req);
    if (isErrorResponse(session)) return session;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const traineeId = searchParams.get('traineeId');

    // Only the reports of trainees of the own organization (the super admin
    // sees every one) and, with a chosen occupation (x-catalog), of that
    // occupation. The platform-owner flag of an organization does not widen
    // the list.
    const traineeScope = await requireTraineeScopeCondition(session, req);
    if (isErrorResponse(traineeScope)) return traineeScope;

    const trainees = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        ausbildungDurationYears: profiles.ausbildungDurationYears,
        organizationId: profiles.organizationId,
        assignedTrainerId: profiles.assignedTrainerId,
      })
      .from(profiles)
      .where(traineeScope.condition);

    const traineeIds = trainees.map(t => String(t.id));
    const traineeMap = new Map(trainees.map(t => [t.id, t]));

    // A trainee outside the scope (another organization or another occupation
    // than the chosen one) has no reports in this list. Do not fall back to the
    // whole list.
    const outsideScope = !!traineeId && !traineeIds.includes(traineeId);

    if (traineeIds.length === 0 || outsideScope) {
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
    // A DRAFT is the private work of the trainee, never listed to trainer level
    if (status && ['SUBMITTED', 'APPROVED', 'REJECTED'].includes(status)) {
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

    // Phase one of the occupation of each trainee in the list (KfBM 15 months,
    // FIAE 18), so the browser can label the phases of every trainee
    const reportTraineeIds = [
      ...new Set(reports.map(r => String(r.traineeId))),
    ];
    const phasePlans =
      reportTraineeIds.length > 0
        ? await loadPhasePlansForUsers(
            reportTraineeIds.map(id => ({
              id,
              durationYears: traineeMap.get(id)?.ausbildungDurationYears,
            }))
          )
        : new Map<string, { phaseMonths: [number, number] }>();

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
        traineePhaseOneMonths: phasePlans.get(String(report.traineeId))
          ?.phaseMonths[0],
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
