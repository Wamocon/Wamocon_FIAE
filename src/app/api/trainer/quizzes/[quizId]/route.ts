import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { quizzes, questions, options, quizAssignments } from '@/db/migrations/schemas/schema';
import { and, eq, inArray } from 'drizzle-orm';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ quizId: string }> }) {
  try {
    const { quizId } = await ctx.params;
    const [qz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId as any)).limit(1);
    if (!qz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const qRows = await db.select().from(questions).where(eq(questions.quizId, quizId as any));
    const qIds = qRows.map((q) => q.id);
    const optRows = qIds.length
      ? await db.select().from(options).where(inArray(options.questionId, qIds as any))
      : [];
    const assignedRows = await db
      .select({ traineeId: quizAssignments.traineeId })
      .from(quizAssignments)
      .where(eq(quizAssignments.quizId, quizId as any));

    const questionsOut = qRows
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
      .map((qr) => {
        const opts = optRows.filter((o) => String(o.questionId) === String(qr.id));
        const ordered = opts; // no order column; natural insert order okay
        const correctIndex = Math.max(0, ordered.findIndex((o) => o.isCorrect));
        return {
          id: qr.id,
          question_text: qr.questionText,
          options: ordered.map((o) => o.optionText),
          correct_index: correctIndex,
        };
      });

    return NextResponse.json({
      id: qz.id,
      title: qz.title,
      is_active: qz.isActive,
      quiz_type: qz.quizType === 'LESSON' ? 'mini' : 'big',
      questions: questionsOut,
      assigned_trainee_ids: assignedRows.map((r) => String(r.traineeId)),
    });
  } catch (e) {
    console.error('Get quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ quizId: string }> }) {
  try {
    const { quizId } = await ctx.params;
    // Cascade delete options -> questions -> quiz
    const qRows = await db.select({ id: questions.id }).from(questions).where(eq(questions.quizId, quizId as any));
    const qIds = qRows.map(r => r.id);
    if (qIds.length > 0) {
      await db.delete(options).where(inArray(options.questionId, qIds as any));
      await db.delete(questions).where(eq(questions.quizId, quizId as any));
    }
    await db.delete(quizAssignments).where(eq(quizAssignments.quizId, quizId as any));
    await db.delete(quizzes).where(eq(quizzes.id, quizId as any));
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ quizId: string }> }) {
  try {
    const { quizId } = await ctx.params;
    const body = await req.json();
    const title = body?.title as string | undefined;
    const is_active = body?.is_active as boolean | undefined;
    const questionsPayload = (body?.questions || []) as Array<{
      question_text: string;
      options: string[];
      correct_index: number;
    }>;
    const assignedTraineeIds = (body?.assigned_trainee_ids || []) as string[];
    const trainerId = (body?.trainer_id || body?.trainerId) as string | undefined;

    // Update quiz details
    if (title !== undefined || is_active !== undefined) {
      await db.update(quizzes).set({
        title: title !== undefined ? String(title) : undefined,
        isActive: is_active !== undefined ? Boolean(is_active) : undefined,
      } as any).where(eq(quizzes.id, quizId as any));
    }

    // Replace questions/options if provided
    if (Array.isArray(questionsPayload) && questionsPayload.length > 0) {
      const qRows = await db.select({ id: questions.id }).from(questions).where(eq(questions.quizId, quizId as any));
      const qIds = qRows.map((r) => r.id);
      if (qIds.length) {
        await db.delete(options).where(inArray(options.questionId, qIds as any));
        await db.delete(questions).where(eq(questions.quizId, quizId as any));
      }
      let order = 1;
      for (const q of questionsPayload) {
        const [qRow] = await db
          .insert(questions)
          .values({ quizId: quizId as any, questionText: q.question_text, orderIndex: order++ })
          .returning();
        for (let i = 0; i < q.options.length; i++) {
          const optText = q.options[i];
          await db.insert(options).values({ questionId: qRow.id, optionText: optText, isCorrect: i === Number(q.correct_index) });
        }
      }
    }

    // Update assignments if provided (GLOBAL quizzes only)
    if (Array.isArray(assignedTraineeIds)) {
      console.log(`Updating assignments for quiz ${quizId}`, { count: assignedTraineeIds.length, trainerId });

      await db.transaction(async (tx) => {
        await tx.delete(quizAssignments).where(eq(quizAssignments.quizId, quizId as any));

        if (assignedTraineeIds.length > 0) {
          if (!trainerId) {
            console.error('Cannot assign trainees: trainerId missing in request body');
            // Do not throw here to avoid failing the whole update if only assignments fail? 
            // Better to throw so user knows.
            throw new Error('trainerId required to assign trainees');
          }

          const values = assignedTraineeIds.map((tid) => ({
            quizId: quizId as any,
            traineeId: tid,
            assignedById: trainerId
          }));

          await tx.insert(quizAssignments).values(values).onConflictDoNothing();
        }
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Patch quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
