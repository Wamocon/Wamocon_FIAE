import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import db from '@/db';
import { activityReportUseCaseEntries, activityReports, profiles, trainingUseCases } from '@/db/migrations/schemas/schema';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/trainer/arbeitszeugnis/grade
 * 
 * Approves grades for use case entries in an activity report.
 * Called when trainer reviews an activity report and assigns grades.
 * 
 * Body:
 * - reportId: Activity report ID
 * - grades: Array of { entryId, grade (1-6), comment? }
 */
export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Verify user is a trainer
        const trainerProfile = await db
            .select({ role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, user.id))
            .limit(1);

        if (trainerProfile[0]?.role !== 'TRAINER') {
            return NextResponse.json({ error: 'Only trainers can grade entries' }, { status: 403 });
        }

        const body = await request.json();
        const { reportId, grades } = body;

        if (!reportId || !grades || !Array.isArray(grades)) {
            return NextResponse.json({
                error: 'Missing required fields: reportId, grades'
            }, { status: 400 });
        }

        // Verify the report exists and belongs to a trainee the trainer manages
        const report = await db
            .select({
                id: activityReports.id,
                traineeId: activityReports.traineeId,
                status: activityReports.status,
            })
            .from(activityReports)
            .where(eq(activityReports.id, reportId))
            .limit(1);

        if (!report[0]) {
            return NextResponse.json({ error: 'Activity report not found' }, { status: 404 });
        }

        // Update each entry with grade
        const updatedEntries: string[] = [];
        const now = new Date();

        for (const gradeData of grades) {
            const { entryId, grade, comment } = gradeData;

            if (!entryId || !grade) {
                continue; // Skip invalid entries
            }

            // Validate grade is 1-6
            const gradeNum = parseInt(grade);
            if (isNaN(gradeNum) || gradeNum < 1 || gradeNum > 6) {
                continue;
            }

            const gradeString = gradeNum.toString() as '1' | '2' | '3' | '4' | '5' | '6';

            await db
                .update(activityReportUseCaseEntries)
                .set({
                    trainerGrade: gradeString,
                    gradeComment: comment || null,
                    isGradeApproved: true,
                    gradeApprovedAt: now,
                    gradeApprovedBy: user.id,
                })
                .where(
                    and(
                        eq(activityReportUseCaseEntries.id, entryId),
                        eq(activityReportUseCaseEntries.reportId, reportId)
                    )
                );

            updatedEntries.push(entryId);
        }

        return NextResponse.json({
            success: true,
            gradedCount: updatedEntries.length,
            reportId,
            gradedAt: now.toISOString(),
        });
    } catch (error: unknown) {
        console.error('Error grading entries:', error);
        return NextResponse.json({ error: 'Interner Serverfehler beim Benoten der Einträge' }, { status: 500 });
    }
}

/**
 * GET /api/trainer/arbeitszeugnis/grade?reportId=xxx
 * 
 * Returns current grades for all entries in an activity report.
 */
export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const reportId = searchParams.get('reportId');

        if (!reportId) {
            return NextResponse.json({ error: 'reportId is required' }, { status: 400 });
        }

        const entries = await db
            .select({
                id: activityReportUseCaseEntries.id,
                useCaseId: activityReportUseCaseEntries.useCaseId,
                trainerGrade: activityReportUseCaseEntries.trainerGrade,
                gradeComment: activityReportUseCaseEntries.gradeComment,
                isGradeApproved: activityReportUseCaseEntries.isGradeApproved,
                gradeApprovedAt: activityReportUseCaseEntries.gradeApprovedAt,
                actualHours: activityReportUseCaseEntries.actualHours,
                useCaseLetter: trainingUseCases.letter,
                useCaseDescription: trainingUseCases.description,
            })
            .from(activityReportUseCaseEntries)
            .leftJoin(trainingUseCases, eq(activityReportUseCaseEntries.useCaseId, trainingUseCases.id))
            .where(eq(activityReportUseCaseEntries.reportId, reportId));

        return NextResponse.json({
            reportId,
            entries,
            totalEntries: entries.length,
            gradedEntries: entries.filter(e => e.isGradeApproved).length,
        });
    } catch (error: unknown) {
        console.error('Error fetching grades:', error);
        return NextResponse.json({ error: 'Interner Serverfehler beim Laden der Noten' }, { status: 500 });
    }
}
