/**
 * Activity Report Submit API
 * 
 * POST /api/trainee/school/reports/[id]/submit - Submit report for trainer approval
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and } from 'drizzle-orm';
import {
    activityReports,
    activityReportEntries,
    profiles,
    notifications
} from '@/db/migrations/schemas/schema';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// POST /api/trainee/school/reports/[id]/submit
export async function POST(req: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const body = await req.json();
        const { traineeConfirmation } = body;

        // Validate confirmation
        if (!traineeConfirmation) {
            return NextResponse.json({
                error: 'traineeConfirmation required (trainee must confirm correctness)'
            }, { status: 400 });
        }

        // Get report
        const [report] = await db
            .select()
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        if (!report) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        // Validate status
        if (report.status !== 'DRAFT' && report.status !== 'REJECTED') {
            return NextResponse.json({
                error: `Cannot submit report with status: ${report.status}`
            }, { status: 403 });
        }

        // Validate report has entries
        const entries = await db
            .select()
            .from(activityReportEntries)
            .where(eq(activityReportEntries.reportId, id as any));

        if (entries.length === 0) {
            return NextResponse.json({
                error: 'Report must have at least one entry before submission'
            }, { status: 400 });
        }

        // Validate minimum content
        const hasContent = entries.some(entry =>
            entry.betrieblicheTaetigkeit ||
            entry.unterweisungenThemen ||
            entry.berufsschulThemen
        );

        if (!hasContent) {
            return NextResponse.json({
                error: 'Report entries must have content in at least one section'
            }, { status: 400 });
        }

        // Get trainee info
        const [trainee] = await db
            .select({
                fullName: profiles.fullName,
                assignedTrainerId: profiles.assignedTrainerId
            })
            .from(profiles)
            .where(eq(profiles.id, report.traineeId));

        // Update report status
        const now = new Date();
        const [updated] = await db
            .update(activityReports)
            .set({
                status: 'SUBMITTED',
                submittedAt: now,
                traineeSignedAt: now, // Trainee signature = submission timestamp
                reviewerFeedback: null, // Clear any previous rejection feedback
            })
            .where(eq(activityReports.id, id as any))
            .returning();

        // Send notification to assigned trainer
        if (trainee?.assignedTrainerId) {
            await db.insert(notifications).values({
                userId: trainee.assignedTrainerId as any,
                actorId: report.traineeId,
                type: 'ACTIVITY_REPORT_SUBMITTED',
                title: 'Tätigkeitsnachweis zur Genehmigung',
                message: `${trainee.fullName || 'Ein Auszubildender'} hat den Tätigkeitsnachweis für KW ${report.weekNumber}/${report.year} eingereicht.`,
                linkUrl: `/trainer/activity-reports/${report.id}`,
                context: {
                    reportId: report.id,
                    weekNumber: report.weekNumber,
                    year: report.year,
                    traineeName: trainee.fullName,
                },
            });
        }

        return NextResponse.json({
            success: true,
            report: updated,
            message: 'Report submitted successfully. Awaiting trainer approval.',
        });
    } catch (e) {
        console.error('Submit report error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
