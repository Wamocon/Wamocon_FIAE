import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import {
    activityReportUseCaseEntries,
    gradeEditHistory,
    profiles,
    trainingUseCases,
} from '@/db/migrations/schemas/schema';
import { normalizePlannedHours } from '@/lib/ausbildung/planned-hours';

// GET: Get report entries for a specific report
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const entries = await db
            .select({
                id: activityReportUseCaseEntries.id,
                reportId: activityReportUseCaseEntries.reportId,
                useCaseId: activityReportUseCaseEntries.useCaseId,
                plannedHours: activityReportUseCaseEntries.plannedHours,
                actualHours: activityReportUseCaseEntries.actualHours,
                isOverbooked: activityReportUseCaseEntries.isOverbooked,
                notes: activityReportUseCaseEntries.notes,
                traineeGrade: activityReportUseCaseEntries.traineeGrade,
                trainerGrade: activityReportUseCaseEntries.trainerGrade,
                releaseGrade: activityReportUseCaseEntries.releaseGrade,
                gradeComment: activityReportUseCaseEntries.gradeComment,
                releaseGradeComment: activityReportUseCaseEntries.releaseGradeComment,
                isGradeApproved: activityReportUseCaseEntries.isGradeApproved,
                gradeApprovedAt: activityReportUseCaseEntries.gradeApprovedAt,
                releaseGradeAt: activityReportUseCaseEntries.releaseGradeAt,
                createdAt: activityReportUseCaseEntries.createdAt,
                updatedAt: activityReportUseCaseEntries.updatedAt,
                useCaseDescription: trainingUseCases.description,
            })
            .from(activityReportUseCaseEntries)
            .leftJoin(
                trainingUseCases,
                eq(activityReportUseCaseEntries.useCaseId, trainingUseCases.id)
            )
            .where(eq(activityReportUseCaseEntries.reportId, id as any))
            .orderBy(activityReportUseCaseEntries.createdAt);

        const formattedEntries = entries.map(e => ({
            id: e.id,
            reportId: e.reportId,
            useCaseId: e.useCaseId,
            plannedHours: normalizePlannedHours({
                plannedHours: e.plannedHours,
            }),
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

// PATCH: Update grades for report entries
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { entryGrades, trainerId, editReason } = body;

        if (!trainerId) {
            return NextResponse.json({ error: 'trainerId is required' }, { status: 400 });
        }

        // Verify user is a trainer
        const [profile] = await db
            .select({ role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, trainerId as any));

        if (profile?.role !== 'TRAINER') {
            return NextResponse.json({ error: 'Nur Ausbilder dürfen Noten vergeben' }, { status: 403 });
        }

        // entryGrades: Array of { entryId, grade, comment }
        if (!entryGrades || !Array.isArray(entryGrades)) {
            return NextResponse.json({ error: 'entryGrades array required' }, { status: 400 });
        }

        // H-2 fix: Validate all trainer grades are in valid range
        const validGrades = ['1', '2', '3', '4', '5', '6'];
        const invalidGrades = entryGrades.filter((g: any) => g.grade && !validGrades.includes(String(g.grade)));
        if (invalidGrades.length > 0) {
            return NextResponse.json({ error: 'Noten müssen zwischen 1 und 6 liegen.' }, { status: 400 });
        }

        const updatedEntries = [];
        const now = new Date();

        for (const gradeData of entryGrades) {
            const { entryId, grade, comment } = gradeData;
            
            if (!entryId || !grade) continue;

            // H-1 fix: Verify entry belongs to this report (prevent IDOR)
            const existingEntries = await db
                .select()
                .from(activityReportUseCaseEntries)
                .where(eq(activityReportUseCaseEntries.id, entryId as any));

            const existing = existingEntries[0];

            // H-1 fix: Verify entry belongs to the report in the URL
            if (!existing || String(existing.reportId) !== id) {
                return NextResponse.json({ error: 'Eintrag gehört nicht zu diesem Nachweis' }, { status: 403 });
            }

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

        return NextResponse.json({ 
            success: true, 
            updatedCount: updatedEntries.length,
            entries: updatedEntries,
        });
    } catch (error: any) {
        console.error('Error in report entries PATCH:', error);
        return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
    }
}
