/**
 * Exam Result API
 * 
 * POST /api/trainee/school/exams/[id]/result - Record exam result
 * PUT  /api/trainee/school/exams/[id]/result - Update exam result
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and } from 'drizzle-orm';
import { schoolExams, schoolExamResults, profiles, notifications } from '@/db/migrations/schemas/schema';
import { getUserOrgId } from '@/lib/auth-helpers';
import { isErrorResponse, requireUser, type SessionUser } from '@/lib/auth/session';
import { ensureSchoolRowInChosenCatalog } from '@/lib/school/catalog-access';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// The exam of a result lies inside the occupation the trainee works in, the
// result of an exam of the other occupation counts as missing. Null if it does.
async function examOutsideChosenCatalog(
    session: SessionUser,
    req: NextRequest,
    examId: string,
    notFound: () => NextResponse
): Promise<NextResponse | null> {
    const [exam] = await db
        .select({ trainingCatalogId: schoolExams.trainingCatalogId })
        .from(schoolExams)
        .where(eq(schoolExams.id, examId as any));
    if (!exam) return null;
    return ensureSchoolRowInChosenCatalog(session, req, exam, notFound);
}

// Helper to determine if passed based on grade/points
function determinePassed(grade?: string, points?: number): boolean | null {
    // German grade system: 1-4 = passed, 5-6 = failed
    if (grade) {
        const numGrade = parseInt(grade.replace(/[+-]/g, ''), 10);
        if (!isNaN(numGrade)) {
            return numGrade <= 4;
        }
    }

    // IHK point system: 50+ points (out of 100) = passed
    if (points !== undefined && points !== null) {
        return points >= 50;
    }

    return null;
}

// POST /api/trainee/school/exams/[id]/result
// The result is recorded for the session user, a traineeId in the body is ignored.
export async function POST(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id: examId } = await params;
        const body = await req.json();
        const { grade, points, percentage, passed, notes } = body;

        // Validate exam exists and belongs to the session user
        const [exam] = await db
            .select({ id: schoolExams.id, traineeId: schoolExams.traineeId, trainingCatalogId: schoolExams.trainingCatalogId })
            .from(schoolExams)
            .where(eq(schoolExams.id, examId as any));

        const examNotFound = () => NextResponse.json({ error: 'Exam not found' }, { status: 404 });
        if (!exam || String(exam.traineeId) !== session.id) {
            return examNotFound();
        }
        const outsideCatalog = await ensureSchoolRowInChosenCatalog(session, req, exam, examNotFound);
        if (outsideCatalog) return outsideCatalog;

        // Check if result already exists
        const [existing] = await db
            .select({ id: schoolExamResults.id })
            .from(schoolExamResults)
            .where(eq(schoolExamResults.examId, examId as any));

        if (existing) {
            return NextResponse.json({
                error: 'Result already exists. Use PUT to update.'
            }, { status: 409 });
        }

        const effectiveTraineeId = session.id;
        const organizationId = await getUserOrgId(effectiveTraineeId);

        // Determine passed status
        const isPassed = passed !== undefined ? passed : determinePassed(grade, points);

        const [result] = await db
            .insert(schoolExamResults)
            .values({
                examId: examId as any,
                traineeId: effectiveTraineeId as any,
                grade: grade || null,
                points: points ?? null,
                percentage: percentage ?? null,
                passed: isPassed,
                notes: notes || null,
            })
            .returning();

        // Notify the trainee's assigned trainer about the exam result
        try {
            const [traineeProfile] = await db
                .select({ fullName: profiles.fullName, assignedTrainerId: profiles.assignedTrainerId })
                .from(profiles)
                .where(eq(profiles.id, effectiveTraineeId as any));
            const [examDetail] = await db
                .select({ subject: schoolExams.subject })
                .from(schoolExams)
                .where(eq(schoolExams.id, examId as any));
            if (traineeProfile?.assignedTrainerId) {
                const traineeName = traineeProfile.fullName || 'Auszubildender';
                const subjectName = examDetail?.subject || 'Prüfung';
                await db.insert(notifications).values({
                    userId: String(traineeProfile.assignedTrainerId),
                    actorId: effectiveTraineeId,
                    organizationId,
                    type: 'EXAM_RESULT_SUBMITTED',
                    title: 'Prüfungsergebnis eingetragen',
                    message: `${traineeName} hat ein Ergebnis für "${subjectName}" eingetragen.`,
                    linkUrl: `/trainer/trainees/${effectiveTraineeId}`,
                    context: { examId, traineeId: effectiveTraineeId },
                });
            }
        } catch (notifyErr) {
            console.warn('Failed to notify trainer for exam result', notifyErr);
        }

        return NextResponse.json({ result }, { status: 201 });
    } catch (e) {
        console.error('Create result error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT /api/trainee/school/exams/[id]/result
export async function PUT(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id: examId } = await params;
        const body = await req.json();

        // Find existing result, the result of someone else counts as missing
        const [existing] = await db
            .select()
            .from(schoolExamResults)
            .where(eq(schoolExamResults.examId, examId as any));

        const resultNotFound = () => NextResponse.json({
            error: 'No result found for this exam. Use POST to create.'
        }, { status: 404 });
        if (!existing || String(existing.traineeId) !== session.id) {
            return resultNotFound();
        }
        const outsideCatalog = await examOutsideChosenCatalog(session, req, examId, resultNotFound);
        if (outsideCatalog) return outsideCatalog;

        // Build update object
        const updateData: Record<string, any> = {};

        if (body.grade !== undefined) updateData.grade = body.grade;
        if (body.points !== undefined) updateData.points = body.points;
        if (body.percentage !== undefined) updateData.percentage = body.percentage;
        if (body.notes !== undefined) updateData.notes = body.notes;

        // Recalculate passed if grade or points changed and passed not explicitly set
        if (body.passed !== undefined) {
            updateData.passed = body.passed;
        } else if (body.grade !== undefined || body.points !== undefined) {
            const newGrade = body.grade !== undefined ? body.grade : existing.grade;
            const newPoints = body.points !== undefined ? body.points : existing.points;
            updateData.passed = determinePassed(newGrade, newPoints);
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const [updated] = await db
            .update(schoolExamResults)
            .set(updateData)
            .where(and(eq(schoolExamResults.id, existing.id), eq(schoolExamResults.traineeId, session.id as any)))
            .returning();

        return NextResponse.json({ result: updated });
    } catch (e) {
        console.error('Update result error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// GET /api/trainee/school/exams/[id]/result
export async function GET(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id: examId } = await params;

        const [result] = await db
            .select()
            .from(schoolExamResults)
            .where(eq(schoolExamResults.examId, examId as any));

        // The result of someone else counts as missing
        if (!result || String(result.traineeId) !== session.id) {
            return NextResponse.json({ result: null });
        }
        const outsideCatalog = await examOutsideChosenCatalog(
            session, req, examId, () => NextResponse.json({ result: null })
        );
        if (outsideCatalog) return outsideCatalog;

        return NextResponse.json({ result });
    } catch (e) {
        console.error('Get result error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
