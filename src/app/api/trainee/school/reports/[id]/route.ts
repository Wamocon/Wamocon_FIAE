/**
 * Activity Report Single Item API
 * 
 * GET    /api/trainee/school/reports/[id] - Get report with entries
 * PUT    /api/trainee/school/reports/[id] - Update report
 * DELETE /api/trainee/school/reports/[id] - Delete report (only drafts)
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and } from 'drizzle-orm';
import { activityReports, activityReportEntries, profiles } from '@/db/migrations/schemas/schema';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// GET /api/trainee/school/reports/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;

        // Get report
        const [report] = await db
            .select()
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        if (!report) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        // Get entries
        const entries = await db
            .select()
            .from(activityReportEntries)
            .where(eq(activityReportEntries.reportId, id as any));

        // Get trainee info
        const [trainee] = await db
            .select({ fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.id, report.traineeId));

        // Get reviewer info if exists
        let reviewer = null;
        if (report.reviewerId) {
            const [reviewerProfile] = await db
                .select({ fullName: profiles.fullName })
                .from(profiles)
                .where(eq(profiles.id, report.reviewerId));
            reviewer = reviewerProfile;
        }

        // Calculate total hours
        const totalHours = entries.reduce((acc, entry) => {
            return acc +
                (entry.betrieblicheStunden || 0) +
                (entry.unterweisungenStunden || 0) +
                (entry.berufsschulStunden || 0);
        }, 0);

        return NextResponse.json({
            report,
            entries,
            trainee,
            reviewer,
            meta: {
                totalHours,
                isEditable: report.status === 'DRAFT' || report.status === 'REJECTED',
                canSubmit: report.status === 'DRAFT' || report.status === 'REJECTED',
                canDownloadPdf: report.status === 'APPROVED' && report.pdfUrl,
            }
        });
    } catch (e) {
        console.error('Get report error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT /api/trainee/school/reports/[id]
export async function PUT(req: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;
        const body = await req.json();

        // Get existing report
        const [existing] = await db
            .select()
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        if (!existing) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        // Only allow editing drafts or rejected reports
        if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
            return NextResponse.json({
                error: 'Cannot edit submitted or approved reports'
            }, { status: 403 });
        }

        // Build update object
        const updateData: Record<string, any> = {};

        if (body.abteilung !== undefined) updateData.abteilung = body.abteilung;
        if (body.periodStart !== undefined) updateData.periodStart = new Date(body.periodStart);
        if (body.periodEnd !== undefined) updateData.periodEnd = new Date(body.periodEnd);

        // If editing after rejection, reset to draft
        if (existing.status === 'REJECTED' && Object.keys(updateData).length > 0) {
            updateData.status = 'DRAFT';
            updateData.reviewerFeedback = null;
        }

        let updatedReport = existing;
        if (Object.keys(updateData).length > 0) {
            const [updated] = await db
                .update(activityReports)
                .set(updateData)
                .where(eq(activityReports.id, id as any))
                .returning();
            updatedReport = updated;
        }

        return NextResponse.json({ report: updatedReport });
    } catch (e) {
        console.error('Update report error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE /api/trainee/school/reports/[id]
export async function DELETE(req: NextRequest, { params }: RouteParams) {
    try {
        const { id } = await params;

        // Get existing report
        const [existing] = await db
            .select({ id: activityReports.id, status: activityReports.status })
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        if (!existing) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        // Only allow deleting drafts
        if (existing.status !== 'DRAFT') {
            return NextResponse.json({
                error: 'Can only delete draft reports'
            }, { status: 403 });
        }

        // Delete (cascades to entries)
        await db
            .delete(activityReports)
            .where(eq(activityReports.id, id as any));

        return NextResponse.json({ success: true, deleted: id });
    } catch (e) {
        console.error('Delete report error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
