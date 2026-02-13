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
  activityReportEntries,
  profiles,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';

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

    const cacheKey = `trainer_activity_reports_${trainerId}_${status || 'all'}_${traineeId || 'all'}`;
    const cached = await apiCache.getOrFetch(
      cacheKey,
      async () => {
        // Get trainees assigned to this trainer
        const trainees = await db
          .select({ id: profiles.id, fullName: profiles.fullName })
          .from(profiles)
          .where(
            and(
              eq(profiles.assignedTrainerId, trainerId as any),
              eq(profiles.role, 'TRAINEE')
            )
          );

        const traineeIds = trainees.map(t => t.id);
        const traineeMap = new Map(trainees.map(t => [t.id, t.fullName]));

        if (traineeIds.length === 0) {
          return { reports: [], meta: { total: 0, pending: 0 } };
        }

        // Build conditions
        const conditions: any[] = [];
        if (traineeId && traineeIds.includes(traineeId)) {
          conditions.push(eq(activityReports.traineeId, traineeId as any));
        } else {
          conditions.push(
            or(
              ...traineeIds.map(id => eq(activityReports.traineeId, id as any))
            )!
          );
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
                .from(activityReportEntries)
                .where(
                  inArray(activityReportEntries.reportId, reportIds as any)
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
            (acc, e) =>
              acc +
              (e.betrieblicheStunden || 0) +
              (e.unterweisungenStunden || 0) +
              (e.berufsschulStunden || 0),
            0
          );
          return {
            ...report,
            traineeName: traineeMap.get(report.traineeId) || 'Unknown',
            entryCount: entries.length,
            totalHours,
            isPending: report.status === 'SUBMITTED',
          };
        });

        const pending = enrichedReports.filter(
          r => r.status === 'SUBMITTED'
        ).length;

        return {
          reports: enrichedReports,
          meta: {
            total: enrichedReports.length,
            pending,
            assignedTrainees: trainees.length,
          },
        };
      },
      ApiCache.TTL.SHORT // 2 minutes – reports change more frequently
    );

    return NextResponse.json(cached, { headers: cacheHeaders.short });
  } catch (e) {
    console.error('List trainer reports error:', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
