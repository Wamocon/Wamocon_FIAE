import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { activityReportUseCaseEntries, gradeEditHistory } from '@/db/migrations/schemas/schema';

// GET: Get report entries for a specific report
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const entries = await db
            .select()
            .from(activityReportUseCaseEntries)
            .where(eq(activityReportUseCaseEntries.reportId, id as any))
            .orderBy(activityReportUseCaseEntries.createdAt);

        const formattedEntries = entries.map(e => ({
            id: e.id,
            reportId: e.reportId,
            useCaseId: e.useCaseId,
            plannedHours: e.plannedHours,
            actualHours: e.actualHours,
            isOverbooked: e.isOverbooked,
            notes: e.notes,
            traineeGrade: e.traineeGrade,
            trainerGrade: e.trainerGrade,
            releaseGrade: e.releaseGrade,
            gradeComment: e.gradeComment,
            releaseGradeComment: e.releaseGradeComment,
            isGradeApproved: e.isGradeApproved,
            gradeApprovedAt: e.gradeApprovedAt,
            releaseGradeAt: e.releaseGradeAt,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
        }));

        return NextResponse.json({ entries: formattedEntries });
    } catch (error: any) {
        // If table doesn't exist yet, return empty entries
        if (error?.cause?.code === '42P01') {
            console.warn('Table activity_report_use_case_entries does not exist yet - returning empty entries');
            return NextResponse.json({ entries: [] });
        }
        console.error('Error in report entries GET:', error);
        return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
    }
}

// PATCH: Update grades for report entries (supports trainer grade, release grade, and grade editing)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { entryGrades, trainerId, isReleaseGrade, editReason } = body;

        // entryGrades: Array of { entryId, grade, comment }
        if (!entryGrades || !Array.isArray(entryGrades)) {
            return NextResponse.json({ error: 'entryGrades array required' }, { status: 400 });
        }

        const updatedEntries = [];
        const now = new Date();

        for (const gradeData of entryGrades) {
            const { entryId, grade, comment } = gradeData;
            
            if (!entryId || !grade) continue;

            // Fetch existing entry for audit trail
            const existingEntries = await db
                .select()
                .from(activityReportUseCaseEntries)
                .where(eq(activityReportUseCaseEntries.id, entryId as any));

            const existing = existingEntries[0];

            if (isReleaseGrade) {
                // Setting release grade (final grade after discussion)
                // Log edit history if there was a previous release grade
                if (existing?.releaseGrade && existing.releaseGrade !== String(grade)) {
                    await db.insert(gradeEditHistory).values({
                        entityType: 'USE_CASE_ENTRY',
                        entityId: entryId,
                        fieldName: 'releaseGrade',
                        oldValue: existing.releaseGrade,
                        newValue: String(grade),
                        changedBy: trainerId,
                        changeReason: editReason || null,
                    });
                }

                const updated = await db
                    .update(activityReportUseCaseEntries)
                    .set({
                        releaseGrade: String(grade) as any,
                        releaseGradeComment: comment || null,
                        releaseGradeAt: now,
                        releaseGradeBy: trainerId || null,
                        updatedAt: now,
                    })
                    .where(eq(activityReportUseCaseEntries.id, entryId as any))
                    .returning();

                if (updated.length > 0) updatedEntries.push(updated[0]);
            } else {
                // Setting/editing trainer grade
                // Log edit history if grade is being changed (not first-time set)
                if (existing?.trainerGrade && existing.trainerGrade !== String(grade)) {
                    await db.insert(gradeEditHistory).values({
                        entityType: 'USE_CASE_ENTRY',
                        entityId: entryId,
                        fieldName: 'trainerGrade',
                        oldValue: existing.trainerGrade,
                        newValue: String(grade),
                        changedBy: trainerId,
                        changeReason: editReason || null,
                    });
                }

                const updated = await db
                    .update(activityReportUseCaseEntries)
                    .set({
                        trainerGrade: String(grade) as any,
                        gradeComment: comment || null,
                        isGradeApproved: true,
                        gradeApprovedAt: now,
                        gradeApprovedBy: trainerId || null,
                        updatedAt: now,
                    })
                    .where(eq(activityReportUseCaseEntries.id, entryId as any))
                    .returning();

                if (updated.length > 0) updatedEntries.push(updated[0]);
            }
        }

        return NextResponse.json({ 
            success: true, 
            updatedCount: updatedEntries.length,
            entries: updatedEntries 
        });
    } catch (error: any) {
        console.error('Error in report entries PATCH:', error);
        return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
    }
}
