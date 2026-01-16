/**
 * Trainer Activity Reports Management API
 * 
 * GET /api/trainer/activity-reports - List pending reports for approval
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, desc, eq, or } from 'drizzle-orm';
import {
    activityReports,
    activityReportEntries,
    profiles
} from '@/db/migrations/schemas/schema';

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

        // Get trainees assigned to this trainer
        const trainees = await db
            .select({ id: profiles.id, fullName: profiles.fullName })
            .from(profiles)
            .where(and(
                eq(profiles.assignedTrainerId, trainerId as any),
                eq(profiles.role, 'TRAINEE')
            ));

        const traineeIds = trainees.map(t => t.id);
        const traineeMap = new Map(trainees.map(t => [t.id, t.fullName]));

        if (traineeIds.length === 0) {
            return NextResponse.json({
                reports: [],
                meta: { total: 0, pending: 0 }
            });
        }

        // Build conditions - reports from assigned trainees
        let conditions: any[] = [];

        // Filter by specific trainee if provided
        if (traineeId && traineeIds.includes(traineeId)) {
            conditions.push(eq(activityReports.traineeId, traineeId as any));
        } else {
            // All assigned trainees
            conditions.push(
                or(...traineeIds.map(id => eq(activityReports.traineeId, id as any)))!
            );
        }

        // Filter by status
        if (status && ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(status)) {
            conditions.push(eq(activityReports.status, status as any));
        } else {
            // Default: show submitted (pending) and recently reviewed
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
            .orderBy(
                // Show submitted first, then by date
                desc(activityReports.submittedAt)
            );

        // Enrich with trainee names and entry counts
        const enrichedReports = await Promise.all(
            reports.map(async (report) => {
                const entries = await db
                    .select()
                    .from(activityReportEntries)
                    .where(eq(activityReportEntries.reportId, report.id));

                const totalHours = entries.reduce((acc, e) =>
                    acc + (e.betrieblicheStunden || 0) +
                    (e.unterweisungenStunden || 0) +
                    (e.berufsschulStunden || 0), 0
                );

                return {
                    ...report,
                    traineeName: traineeMap.get(report.traineeId) || 'Unknown',
                    entryCount: entries.length,
                    totalHours,
                    isPending: report.status === 'SUBMITTED',
                };
            })
        );

        const pending = enrichedReports.filter(r => r.status === 'SUBMITTED').length;

        return NextResponse.json({
            reports: enrichedReports,
            meta: {
                total: enrichedReports.length,
                pending,
                assignedTrainees: trainees.length,
            }
        });
    } catch (e) {
        console.error('List trainer reports error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
