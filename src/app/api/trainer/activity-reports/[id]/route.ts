/**
 * Trainer Activity Report Review API
 * 
 * GET /api/trainer/activity-reports/[id] - Get report details for review
 * PUT /api/trainer/activity-reports/[id] - Approve or reject report
 */

import { requireTrainer, isErrorResponse } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
    activityReports,
    activityReportEntries,
    profiles,
    notifications
} from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { requireTraineeAccess } from '@/lib/auth/trainee-access';
import { notFoundUnlessUuid } from '@/lib/uuid';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET /api/trainer/activity-reports/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
    try {
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        const { id } = await params;
        const idNotFound = notFoundUnlessUuid(id, 'Report not found');
        if (idNotFound) return idNotFound;

        // Get report
        const [report] = await db
            .select()
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        // A DRAFT is the private work of the trainee, not visible to trainer level
        if (!report || report.status === 'DRAFT') {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        // Only the report of a trainee of the own organization (the super admin:
        // any) and of the chosen occupation. A foreign report answers like a
        // missing one.
        const access = await requireTraineeAccess(session, String(report.traineeId), req, 'Report not found');
        if (isErrorResponse(access)) return access;

        // Get entries
        const entries = await db
            .select()
            .from(activityReportEntries)
            .where(eq(activityReportEntries.reportId, id as any));

        // Get trainee info
        const [trainee] = await db
            .select({
                fullName: profiles.fullName,
                email: profiles.email,
                startOfTrainingDate: profiles.startOfTrainingDate,
            })
            .from(profiles)
            .where(eq(profiles.id, report.traineeId));

        // Calculate totals
        const totals = entries.reduce(
            (acc, entry) => ({
                betrieblicheStunden: acc.betrieblicheStunden + (entry.betrieblicheStunden || 0),
                unterweisungenStunden: acc.unterweisungenStunden + (entry.unterweisungenStunden || 0),
                berufsschulStunden: acc.berufsschulStunden + (entry.berufsschulStunden || 0),
            }),
            { betrieblicheStunden: 0, unterweisungenStunden: 0, berufsschulStunden: 0 }
        );

        return NextResponse.json({
            report,
            entries,
            trainee,
            totals,
            totalHours: totals.betrieblicheStunden + totals.unterweisungenStunden + totals.berufsschulStunden,
            meta: {
                canApprove: report.status === 'SUBMITTED',
                canReject: report.status === 'SUBMITTED',
            }
        });
    } catch (e) {
        console.error('Get trainer report error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT /api/trainer/activity-reports/[id]
// Body: { action: 'approve' | 'reject', trainerId, feedback? }
export async function PUT(req: NextRequest, { params }: RouteParams) {
    try {
        const session = await requireTrainer(req);
        if (isErrorResponse(session)) return session;

        const { id } = await params;
        const idNotFound = notFoundUnlessUuid(id, 'Report not found');
        if (idNotFound) return idNotFound;
        const body = await req.json();
        const { action, feedback } = body;
        const trainerId = session.id;

        // Validation
        if (!action || !['approve', 'reject'].includes(action)) {
            return NextResponse.json({
                error: 'action required (approve or reject)'
            }, { status: 400 });
        }
        if (!trainerId) {
            return NextResponse.json({ error: 'trainerId required' }, { status: 400 });
        }

        // Get report
        const [report] = await db
            .select()
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        if (!report || report.status === 'DRAFT') {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        // Only the report of a trainee of the own organization (the super admin:
        // any) and of the chosen occupation. A foreign report answers like a
        // missing one, whatever its status is.
        const access = await requireTraineeAccess(session, String(report.traineeId), req, 'Report not found');
        if (isErrorResponse(access)) return access;

        // Validate status
        if (report.status !== 'SUBMITTED') {
            return NextResponse.json({
                error: `Cannot ${action} report with status: ${report.status}`
            }, { status: 403 });
        }

        // Get trainer info for notification
        const [trainer] = await db
            .select({ fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.id, trainerId));

        const organizationId = await getUserOrgId(String(report.traineeId));

        const now = new Date();
        let updateData: Record<string, any>;
        let notificationTitle: string;
        let notificationMessage: string;

        if (action === 'approve') {
            updateData = {
                status: 'APPROVED',
                reviewerId: trainerId,
                reviewedAt: now,
                trainerSignedAt: now, // Trainer signature = approval timestamp
                reviewerFeedback: feedback || null,
            };
            notificationTitle = 'Tätigkeitsnachweis genehmigt ✓';
            notificationMessage = `Dein Tätigkeitsnachweis für KW ${report.weekNumber}/${report.year} wurde von ${trainer?.fullName || 'deinem Ausbilder'} genehmigt.`;
        } else {
            // Reject
            if (!feedback) {
                return NextResponse.json({
                    error: 'feedback required when rejecting'
                }, { status: 400 });
            }
            updateData = {
                status: 'REJECTED',
                reviewerId: trainerId,
                reviewedAt: now,
                reviewerFeedback: feedback,
            };
            notificationTitle = 'Tätigkeitsnachweis abgelehnt';
            notificationMessage = `Dein Tätigkeitsnachweis für KW ${report.weekNumber}/${report.year} wurde zurückgewiesen. Bitte überarbeite ihn und reiche ihn erneut ein.`;
        }

        // Update report
        const [updated] = await db
            .update(activityReports)
            .set(updateData)
            .where(and(
                eq(activityReports.id, id as any),
                eq(activityReports.traineeId, access.traineeId as any),
                // only a report that still waits for the review
                eq(activityReports.status, 'SUBMITTED')
            ))
            .returning();
        if (!updated) {
            return NextResponse.json({ error: 'Report already reviewed' }, { status: 409 });
        }

        // Send notification to trainee
        await db.insert(notifications).values({
            userId: report.traineeId,
            actorId: trainerId as any,
            type: action === 'approve' ? 'ACTIVITY_REPORT_APPROVED' : 'ACTIVITY_REPORT_REJECTED',
            title: notificationTitle,
            message: notificationMessage,
            linkUrl: `/trainee/school?tab=reports&report=${report.id}`,
            context: {
                reportId: report.id,
                weekNumber: report.weekNumber,
                year: report.year,
                action,
                feedback: feedback || null,
            },
            organizationId,
        });

        return NextResponse.json({
            success: true,
            report: updated,
            message: action === 'approve'
                ? 'Report approved successfully'
                : 'Report rejected. Trainee has been notified.',
        });
    } catch (e) {
        console.error('Review report error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
