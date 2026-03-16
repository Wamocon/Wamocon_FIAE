import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import {
  quizzes,
  questions,
  options,
  quizAssignments,
  notifications,
} from '@/db/migrations/schemas/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { apiCache } from '@/lib/api-cache';
import { getUserOrgId, verifyPlatformOwner } from '@/lib/auth-helpers';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ quizId: string }> }
) {
  try {
    const { quizId } = await ctx.params;
    const [qz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, quizId as any))
      .limit(1);
    if (!qz) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const qRows = await db
      .select()
      .from(questions)
      .where(eq(questions.quizId, quizId as any));
    const qIds = qRows.map(q => q.id);
    const optRows = qIds.length
      ? await db
          .select()
          .from(options)
          .where(inArray(options.questionId, qIds as any))
      : [];
    const assignedRows = await db
      .select({ traineeId: quizAssignments.traineeId })
      .from(quizAssignments)
      .where(eq(quizAssignments.quizId, quizId as any));

    const questionsOut = qRows
      .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
      .map(qr => {
        const opts = optRows.filter(
          o => String(o.questionId) === String(qr.id)
        );
        const ordered = opts; // no order column; natural insert order okay
        const correctIndex = Math.max(
          0,
          ordered.findIndex(o => o.isCorrect)
        );
        return {
          id: qr.id,
          question_text: qr.questionText,
          options: ordered.map(o => o.optionText),
          correct_index: correctIndex,
        };
      });

    return NextResponse.json({
      id: qz.id,
      title: qz.title,
      is_active: qz.isActive,
      quiz_type: qz.quizType === 'LESSON' ? 'mini' : 'big',
      questions: questionsOut,
      assigned_trainee_ids: assignedRows.map(r => String(r.traineeId)),
    });
  } catch (e) {
    console.error('Get quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ quizId: string }> }
) {
  try {
    const { quizId } = await ctx.params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    if (!(await verifyPlatformOwner(trainerId))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    // Get quiz info and assigned trainees before deleting
    const [qzInfo] = await db
      .select({ title: quizzes.title, createdById: quizzes.createdById })
      .from(quizzes)
      .where(eq(quizzes.id, quizId as any))
      .limit(1);
    const assignedRows = await db
      .select({ traineeId: quizAssignments.traineeId })
      .from(quizAssignments)
      .where(eq(quizAssignments.quizId, quizId as any));

    // Cascade delete options -> questions -> quiz
    const qRows = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.quizId, quizId as any));
    const qIds = qRows.map(r => r.id);
    if (qIds.length > 0) {
      await db.delete(options).where(inArray(options.questionId, qIds as any));
      await db.delete(questions).where(eq(questions.quizId, quizId as any));
    }
    await db
      .delete(quizAssignments)
      .where(eq(quizAssignments.quizId, quizId as any));
    await db.delete(quizzes).where(eq(quizzes.id, quizId as any));

    // Notify previously assigned trainees that quiz was removed
    if (assignedRows.length > 0 && qzInfo) {
      try {
        const organizationId = await getUserOrgId(String(qzInfo.createdById || assignedRows[0]?.traineeId));
        const notifValues = assignedRows.map(r => ({
          userId: String(r.traineeId),
          type: 'QUIZ_DELETED',
          title: 'Quiz entfernt',
          message: `Das Quiz "${qzInfo.title}" wurde entfernt.`,
          linkUrl: '/trainee/quizzes',
          context: { quizId },
          organizationId,
        }));
        await db.insert(notifications).values(notifValues);
      } catch (notifyErr) {
        console.warn('Failed to notify trainees for quiz deletion', notifyErr);
      }
    }

    apiCache.invalidate('trainer_quizzes');
    apiCache.invalidate('trainee_quizzes');

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ quizId: string }> }
) {
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
    const trainerId = (body?.trainer_id || body?.trainerId) as
      | string
      | undefined;

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    if (!(await verifyPlatformOwner(trainerId))) {
      return NextResponse.json(
        { error: 'Only platform administrators can manage curriculum content' },
        { status: 403 }
      );
    }

    const organizationId = await getUserOrgId(trainerId || '');

    // Update quiz details
    if (title !== undefined || is_active !== undefined) {
      await db
        .update(quizzes)
        .set({
          title: title !== undefined ? String(title) : undefined,
          isActive: is_active !== undefined ? Boolean(is_active) : undefined,
          updatedAt: new Date(),
        } as any)
        .where(eq(quizzes.id, quizId as any));
    }

    // Replace questions/options if provided
    if (Array.isArray(questionsPayload) && questionsPayload.length > 0) {
      const qRows = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.quizId, quizId as any));
      const qIds = qRows.map(r => r.id);
      if (qIds.length) {
        await db
          .delete(options)
          .where(inArray(options.questionId, qIds as any));
        await db.delete(questions).where(eq(questions.quizId, quizId as any));
      }
      let order = 1;
      for (const q of questionsPayload) {
        const [qRow] = await db
          .insert(questions)
          .values({
            quizId: quizId as any,
            questionText: q.question_text,
            orderIndex: order++,
          })
          .returning();
        for (let i = 0; i < q.options.length; i++) {
          const optText = q.options[i];
          await db
            .insert(options)
            .values({
              questionId: qRow.id,
              optionText: optText,
              isCorrect: i === Number(q.correct_index),
            });
        }
      }
    }

    // Update assignments if provided (GLOBAL quizzes only)
    if (Array.isArray(assignedTraineeIds)) {
      console.log(`Updating assignments for quiz ${quizId}`, {
        count: assignedTraineeIds.length,
        trainerId,
      });

      // Get existing assignments to detect newly added trainees
      const existingAssignments = await db
        .select({ traineeId: quizAssignments.traineeId })
        .from(quizAssignments)
        .where(eq(quizAssignments.quizId, quizId as any));
      const previousIds = new Set(
        existingAssignments.map(a => String(a.traineeId))
      );

      await db.transaction(async tx => {
        await tx
          .delete(quizAssignments)
          .where(eq(quizAssignments.quizId, quizId as any));

        if (assignedTraineeIds.length > 0) {
          if (!trainerId) {
            console.error(
              'Cannot assign trainees: trainerId missing in request body'
            );
            throw new Error('trainerId required to assign trainees');
          }

          const values = assignedTraineeIds.map(tid => ({
            quizId: quizId as any,
            traineeId: tid,
            assignedById: trainerId,
            organizationId,
          }));

          await tx.insert(quizAssignments).values(values).onConflictDoNothing();
        }
      });

      // Notify newly assigned trainees only
      const newTraineeIds = assignedTraineeIds.filter(
        tid => !previousIds.has(tid)
      );
      if (newTraineeIds.length > 0 && trainerId) {
        try {
          const quizTitle = title || 'Quiz';
          const notifValues = newTraineeIds.map(tid => ({
            userId: tid,
            actorId: trainerId,
            type: 'GLOBAL_QUIZ_ASSIGNED',
            title: 'Neues Quiz zugewiesen',
            message: `Dir wurde ein Quiz zugewiesen: "${quizTitle}"`,
            linkUrl: `/trainee/quizzes/${quizId}`,
            context: { quizId },
            organizationId,
          }));
          await db.insert(notifications).values(notifValues);
        } catch (notifyErr) {
          console.warn(
            'Failed to notify trainees for quiz assignment update',
            notifyErr
          );
        }
      }
    }

    apiCache.invalidate('trainer_quizzes');
    apiCache.invalidate('trainee_quizzes');

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Patch quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
