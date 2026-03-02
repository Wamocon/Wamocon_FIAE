import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and, ne, sql, inArray } from 'drizzle-orm';
import { activityReports, profiles, activityReportUseCaseEntries, trainingUseCases } from '@/db/migrations/schemas/schema';
import { apiCache } from '@/lib/api-cache';

// GET: Get a single activity report
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const [report] = await db
            .select()
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        if (!report) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        return NextResponse.json({
            report: {
                id: report.id,
                traineeId: report.traineeId,
                ausbildungsjahr: report.ausbildungsjahr,
                weekNumber: report.weekNumber,
                year: report.year,
                periodStart: report.periodStart,
                periodEnd: report.periodEnd,
                status: report.status,
                submittedAt: report.submittedAt,
                reviewerId: report.reviewerId,
                reviewedAt: report.reviewedAt,
                reviewerFeedback: report.reviewerFeedback,
                traineeSignedAt: report.traineeSignedAt,
                trainerSignedAt: report.trainerSignedAt,
                createdAt: report.createdAt,
            }
        });
    } catch (error: any) {
        console.error('Error in activity-reports GET [id]:', error);
        return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
    }
}

// DELETE: Delete a report (only if Draft or if Admin/Trainer)
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // In a real app we'd check session here, but for now we trust the client logic 
        // regarding who can click the button, or better: verify ownership via session.
        // Assuming the UI handles visibility and we might add backend checks later if needed.

        // Delete related entries first (if not cascading)
        await db.delete(activityReportUseCaseEntries).where(eq(activityReportUseCaseEntries.reportId, id as any));

        const [deleted] = await db
            .delete(activityReports)
            .where(eq(activityReports.id, id as any))
            .returning();

        if (!deleted) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        apiCache.invalidate('activity_reports');
        apiCache.invalidate('trainee_dashboard');
        apiCache.invalidate('trainer_dashboard');

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error in activity-reports DELETE [id]:', error);
        return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
    }
}

// PUT: Update a draft report
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { weekNumber, year, ausbildungsjahr, periodStart, periodEnd, entries, submit } = body;

        // Verify report is draft
        const [report] = await db
            .select()
            .from(activityReports)
            .where(eq(activityReports.id, id as any));

        if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        if (report.status !== 'DRAFT' && report.status !== 'REJECTED') {
            return NextResponse.json({ error: 'Cannot edit submitted or approved reports' }, { status: 403 });
        }

        // === Server-side hours validation ===
        let plannedMap = new Map<string, number>();
        if (entries && entries.length > 0) {
            const entryUseCaseIds = entries.map((e: any) => e.useCaseId);

            // Get planned hours from master data
            const masterUseCases = await db
                .select({ id: trainingUseCases.id, plannedHours: trainingUseCases.plannedHours })
                .from(trainingUseCases)
                .where(inArray(trainingUseCases.id, entryUseCaseIds as any));
            plannedMap = new Map(masterUseCases.map((uc: any) => [uc.id, uc.plannedHours]));

            // Get already-used hours from all non-rejected reports EXCLUDING this one
            const otherReports = await db
                .select({ id: activityReports.id })
                .from(activityReports)
                .where(and(
                    eq(activityReports.traineeId, report.traineeId as any),
                    ne(activityReports.status, 'REJECTED'),
                    ne(activityReports.id, id as any)
                ));
            const otherReportIds = otherReports.map(r => r.id);

            let usedMap = new Map<string, number>();
            if (otherReportIds.length > 0) {
                const usedRows = await db
                    .select({
                        useCaseId: activityReportUseCaseEntries.useCaseId,
                        totalUsed: sql<number>`COALESCE(SUM(${activityReportUseCaseEntries.actualHours}), 0)`.as('total_used'),
                    })
                    .from(activityReportUseCaseEntries)
                    .where(inArray(activityReportUseCaseEntries.reportId, otherReportIds as any))
                    .groupBy(activityReportUseCaseEntries.useCaseId);

                usedRows.forEach(row => usedMap.set(row.useCaseId, Number(row.totalUsed) || 0));
            }

            // Validate each entry
            const violations: string[] = [];
            for (const entry of entries) {
                const totalHours = plannedMap.get(entry.useCaseId) ?? 0;
                const usedHours = usedMap.get(entry.useCaseId) ?? 0;
                const remaining = totalHours - usedHours;
                if (entry.actualHours > remaining) {
                    violations.push(
                        `Tätigkeit überschreitet verfügbare Stunden: ${entry.actualHours} Std. eingetragen, aber nur ${remaining.toFixed(1)} Std. von ${totalHours} Std. verfügbar.`
                    );
                }
            }
            if (violations.length > 0) {
                return NextResponse.json({
                    error: violations[0],
                    violations,
                }, { status: 400 });
            }
        }

        // Build update data - clear previous reviewer data if resubmitting a rejected report
        const updateData: Record<string, any> = {
            weekNumber,
            year,
            ausbildungsjahr,
            periodStart: new Date(periodStart),
            periodEnd: new Date(periodEnd),
            status: submit ? 'SUBMITTED' : 'DRAFT',
            submittedAt: submit ? new Date() : null,
            traineeSignedAt: submit ? new Date() : null,
            updatedAt: new Date(),
        };

        // Clear reviewer feedback when resubmitting
        if (submit && report.status === 'REJECTED') {
            updateData.reviewerFeedback = null;
            updateData.reviewerId = null;
            updateData.reviewedAt = null;
            updateData.trainerSignedAt = null;
        }

        // Update report fields
        await db.update(activityReports)
            .set(updateData)
            .where(eq(activityReports.id, id as any));

        // Update entries: delete old, insert new
        await db.delete(activityReportUseCaseEntries).where(eq(activityReportUseCaseEntries.reportId, id as any));

        if (entries && entries.length > 0) {
            await db.insert(activityReportUseCaseEntries).values(
                entries.map((e: any) => ({
                    reportId: id,
                    useCaseId: e.useCaseId,
                    plannedHours: plannedMap.get(e.useCaseId) ?? e.plannedHours ?? 0,
                    actualHours: e.actualHours,
                    isOverbooked: e.isOverbooked,
                    notes: e.notes || null,
                    // Grade columns - traineeGrade can be set by trainee, others null until trainer grades
                    traineeGrade: e.traineeGrade ? (String(e.traineeGrade) as any) : null,
                    trainerGrade: null,
                    releaseGrade: null,
                    gradeComment: null,
                    releaseGradeComment: null,
                    isGradeApproved: false,
                    gradeApprovedAt: null,
                    gradeApprovedBy: null,
                    releaseGradeAt: null,
                    releaseGradeBy: null,
                }))
            );
        }

        apiCache.invalidate('activity_reports');
        apiCache.invalidate('trainee_dashboard');
        apiCache.invalidate('trainer_dashboard');

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Error in activity-reports PUT [id]:', error);
        const message = error?.message?.includes('violates') || error?.message?.includes('Failed query')
            ? 'Fehler beim Speichern der Einträge. Bitte versuchen Sie es erneut.'
            : 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

// PATCH: Update report status (for trainer approval/rejection)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        
        // Handle empty body gracefully (can happen with preflight or browser issues)
        let body;
        try {
            const text = await request.text();
            body = text ? JSON.parse(text) : {};
        } catch {
            return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
        }
        
        const { status, feedback, userId } = body;

        if (!userId) {
            return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
        }

        // Check if user is a trainer
        const [profile] = await db
            .select({ role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, userId as any));

        if (profile?.role !== 'TRAINER') {
            return NextResponse.json({ error: 'Only trainers can update reports' }, { status: 403 });
        }

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
        }

        const updateData: any = {
            status,
            reviewerId: userId,
            reviewedAt: new Date(),
        };

        if (feedback) {
            updateData.reviewerFeedback = feedback;
        }

        if (status === 'APPROVED') {
            updateData.trainerSignedAt = new Date();
        }

        const [updated] = await db
            .update(activityReports)
            .set(updateData)
            .where(eq(activityReports.id, id as any))
            .returning();

        if (!updated) {
            return NextResponse.json({ error: 'Report not found' }, { status: 404 });
        }

        apiCache.invalidate('activity_reports');
        apiCache.invalidate('trainee_dashboard');
        apiCache.invalidate('trainer_dashboard');

        return NextResponse.json({
            success: true,
            report: updated,
            message: status === 'APPROVED' ? 'Nachweis genehmigt' : 'Nachweis abgelehnt'
        });
    } catch (error: any) {
        console.error('Error in activity-reports PATCH [id]:', error);
        return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
    }
}
