/**
 * School Exam Single Item API
 * 
 * GET    /api/trainee/school/exams/[id] - Get single exam
 * PUT    /api/trainee/school/exams/[id] - Update exam
 * DELETE /api/trainee/school/exams/[id] - Delete exam
 */

import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq, and } from 'drizzle-orm';
import { schoolExams, schoolExamResults, ausbildungBlocks, profiles } from '@/db/migrations/schemas/schema';
import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { loadPhasePlanForUser } from '@/lib/catalog/phase-plan-db';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

interface RouteParams {
    params: Promise<{ id: string }>;
}

// An exam of someone else is answered like a missing one
const notFound = () =>
    NextResponse.json({ error: 'Exam not found' }, { status: 404 });

// GET /api/trainee/school/exams/[id]
export async function GET(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id } = await params;

        const rows = await db
            .select({
                exam: schoolExams,
                result: schoolExamResults,
            })
            .from(schoolExams)
            .leftJoin(schoolExamResults, eq(schoolExams.id, schoolExamResults.examId))
            .where(eq(schoolExams.id, id as any));

        if (rows.length === 0 || String(rows[0].exam.traineeId) !== session.id) {
            return notFound();
        }

        const { exam, result } = rows[0];
        const now = new Date();
        const examDate = new Date(exam.examDate);
        const daysUntil = Math.ceil((examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        return NextResponse.json({
            exam,
            result: result || null,
            meta: {
                daysUntil,
                isPast: daysUntil < 0,
                isToday: daysUntil === 0,
            }
        });
    } catch (e) {
        console.error('Get exam error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// PUT /api/trainee/school/exams/[id]
export async function PUT(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id } = await params;
        const body = await req.json();

        // Check exam exists and belongs to the session user
        const [existing] = await db
            .select()
            .from(schoolExams)
            .where(eq(schoolExams.id, id as any));

        if (!existing || String(existing.traineeId) !== session.id) {
            return notFound();
        }

        // Build update object
        const updateData: Record<string, any> = {};

        if (body.examDate !== undefined) updateData.examDate = new Date(body.examDate);
        if (body.dayOfWeek !== undefined) updateData.dayOfWeek = body.dayOfWeek;
        if (body.period !== undefined) updateData.period = body.period;
        if (body.teacher !== undefined) updateData.teacher = body.teacher;
        if (body.subject !== undefined) updateData.subject = body.subject;
        if (body.examType !== undefined) {
            const validTypes = ['KLAUSUR', 'TEST', 'ABGABE', 'PRAESENTATION', 'MUENDLICH'];
            if (body.examType && !validTypes.includes(body.examType)) {
                return NextResponse.json({ error: 'Invalid examType' }, { status: 400 });
            }
            updateData.examTypeValue = body.examType || null;
        }
        if (body.lernfeldCode !== undefined) updateData.lernfeldCode = body.lernfeldCode;
        if (body.notes !== undefined) updateData.notes = body.notes;
        if (body.schuljahr !== undefined) updateData.schuljahr = body.schuljahr;
        if (body.ausbildungsjahr !== undefined) updateData.ausbildungsjahr = body.ausbildungsjahr;

        if (body.examDate !== undefined || body.ausbildungsjahr !== undefined) {
            const [trainee] = await db
                .select({
                    startOfTrainingDate: profiles.startOfTrainingDate,
                    ausbildungDurationYears: profiles.ausbildungDurationYears,
                })
                .from(profiles)
                .where(eq(profiles.id, existing.traineeId));

            if (trainee?.startOfTrainingDate) {
                // Phase one of the trainee's occupation (KfBM 15 months, FIAE 18)
                const phasePlan = await loadPhasePlanForUser(
                    existing.traineeId,
                    trainee.ausbildungDurationYears
                );
                updateData.ausbildungsjahr = getTrainingPhase(
                    trainee.startOfTrainingDate,
                    trainee.ausbildungDurationYears,
                    body.examDate !== undefined ? new Date(body.examDate) : existing.examDate,
                    phasePlan.phaseMonths[0]
                );
            }
        }

        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
        }

        const [updated] = await db
            .update(schoolExams)
            .set(updateData)
            .where(and(eq(schoolExams.id, id as any), eq(schoolExams.traineeId, session.id as any)))
            .returning();

        return NextResponse.json({ exam: updated });
    } catch (e) {
        console.error('Update exam error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// DELETE /api/trainee/school/exams/[id]
// Handles both school_exams and ausbildung_blocks (EXAM type) sources
export async function DELETE(req: NextRequest, { params }: RouteParams) {
    const session = await requireUser(req);
    if (isErrorResponse(session)) return session;

    try {
        const { id } = await params;

        // Try school_exams first
        const [existingExam] = await db
            .select({ id: schoolExams.id, traineeId: schoolExams.traineeId })
            .from(schoolExams)
            .where(eq(schoolExams.id, id as any));

        if (existingExam) {
            // An exam of someone else is answered like a missing one
            if (String(existingExam.traineeId) !== session.id) return notFound();
            // Delete from school_exams (cascades to results)
            await db
                .delete(schoolExams)
                .where(and(eq(schoolExams.id, id as any), eq(schoolExams.traineeId, session.id as any)));
            return NextResponse.json({ success: true, deleted: id });
        }

        // Fallback: try ausbildung_blocks (calendar-sourced EXAM entries)
        const [existingBlock] = await db
            .select({ id: ausbildungBlocks.id, blockType: ausbildungBlocks.blockType, traineeId: ausbildungBlocks.traineeId })
            .from(ausbildungBlocks)
            .where(and(eq(ausbildungBlocks.id, id as any), eq(ausbildungBlocks.blockType, 'EXAM')));

        if (existingBlock && String(existingBlock.traineeId) === session.id) {
            await db
                .delete(ausbildungBlocks)
                .where(and(eq(ausbildungBlocks.id, id as any), eq(ausbildungBlocks.traineeId, session.id as any)));
            return NextResponse.json({ success: true, deleted: id });
        }

        return notFound();
    } catch (e) {
        console.error('Delete exam error:', e);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
