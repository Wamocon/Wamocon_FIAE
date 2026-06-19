import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { schoolExamResults, schoolExams, profiles, notifications } from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';

interface RouteParams {
    params: Promise<{ examId: string }>;
}

// PUT /api/trainer/school/exams/[examId]/grade
export async function PUT(req: NextRequest, { params }: RouteParams) {
    try {
        const { examId } = await params;
        const body = await req.json();
        const { points, maxPoints } = body;

        if (points === undefined || maxPoints === undefined) {
            return NextResponse.json({ error: 'points and maxPoints required' }, { status: 400 });
        }

        const numPoints = parseFloat(points);
        const numMaxPoints = parseFloat(maxPoints);

        if (isNaN(numPoints) || isNaN(numMaxPoints) || numPoints < 0 || numMaxPoints <= 0) {
            return NextResponse.json({ error: 'Invalid points values' }, { status: 400 });
        }

        // Calculate pass/fail (50% threshold)
        const percentage = (numPoints / numMaxPoints) * 100;
        const passed = percentage >= 50;

        // Get the exam to find traineeId
        const [exam] = await db
            .select({ traineeId: schoolExams.traineeId })
            .from(schoolExams)
            .where(eq(schoolExams.id, examId as any));

        if (!exam) {
            return NextResponse.json({ error: 'Exam not found' }, { status: 404 });
        }

        const organizationId = await getUserOrgId(String(exam.traineeId));

        // Check if result already exists
        const existingResults = await db
            .select()
            .from(schoolExamResults)
            .where(eq(schoolExamResults.examId, examId as any));

        let result;
        if (existingResults.length > 0) {
            // Update existing result
            [result] = await db
                .update(schoolExamResults)
                .set({
                    points: numPoints,
                    percentage,
                    passed,
                })
                .where(eq(schoolExamResults.examId, examId as any))
                .returning();
        } else {
            // Insert new result
            [result] = await db
                .insert(schoolExamResults)
                .values({
                    examId: examId as any,
                    traineeId: exam.traineeId,
                    points: numPoints,
                    percentage,
                    passed,
                })
                .returning();
        }

        // Notify the trainee about grading
        try {
            const [examInfo] = await db
                .select({ subject: schoolExams.subject })
                .from(schoolExams)
                .where(eq(schoolExams.id, examId as any));
            const subjectName = examInfo?.subject || 'Prüfung';
            await db.insert(notifications).values({
                userId: String(exam.traineeId),
                type: 'EXAM_GRADED',
                title: 'Prüfung bewertet',
                message: `Deine Prüfung "${subjectName}" wurde bewertet: ${numPoints}/${numMaxPoints} Punkte (${percentage.toFixed(1)}%).`,
                linkUrl: '/trainee/school?tab=exams',
                context: { examId, points: numPoints, maxPoints: numMaxPoints, passed },
                organizationId,
            });
        } catch (notifyErr) {
            console.warn('Failed to notify trainee for exam grading', notifyErr);
        }

        return NextResponse.json({
            result,
            passed,
            percentage: percentage.toFixed(1),
        });
    } catch (e) {
        console.error('Grade exam error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
