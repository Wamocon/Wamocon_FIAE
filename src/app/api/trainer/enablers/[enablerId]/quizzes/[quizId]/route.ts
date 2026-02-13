import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  enablers,
  enablerQuizLinks,
  options,
  questions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import { verifyTrainer } from '@/lib/auth-helpers';

// GET: quiz detail for editing/view
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ enablerId: string; quizId: string }> }
) {
  try {
    const { quizId } = await params;
    const [link] = await db
      .select()
      .from(enablerQuizLinks)
      .where(eq(enablerQuizLinks.quizId, quizId));
    if (!link) return NextResponse.json({ quiz: null });
    const [qz] = await db.select().from(quizzes).where(eq(quizzes.id, quizId));
    if (!qz) return NextResponse.json({ quiz: null });
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.quizId, quizId))
      .orderBy(questions.orderIndex);
    const qIds = qs.map(q => q.id);
    const opts = qIds.length
      ? await db.select().from(options).where(inArray(options.questionId, qIds))
      : [];
    return NextResponse.json({
      quiz: {
        id: qz.id,
        title: qz.title,
        isActive: !!qz.isActive,
        difficulty: link.difficulty,
        questions: qs.map(q => ({
          id: q.id,
          questionText: q.questionText,
          orderIndex: q.orderIndex,
          questionType: (q as any).questionType || 'MCQ',
          expectedAnswer: (q as any).expectedAnswer || null,
          options: opts
            .filter(o => String(o.questionId) === String(q.id))
            .map(o => ({
              id: o.id,
              optionText: o.optionText,
              isCorrect: o.isCorrect,
              explanation: o.explanation,
            })),
        })),
      },
    });
  } catch (e) {
    console.error('Get enabler quiz detail error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// PATCH: update title/isActive/difficulty and questions
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string; quizId: string }> }
) {
  try {
    const { enablerId, quizId } = await params;
    const body = await req.json();
    const trainerId: string | undefined = body?.trainerId;

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    const [enabler] = await db
      .select()
      .from(enablers)
      .where(eq(enablers.id, enablerId));
    if (!enabler) {
      return NextResponse.json({ error: 'Enabler not found' }, { status: 404 });
    }

    // Shared curriculum: any valid trainer can edit quizzes
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    await db.transaction(async tx => {
      if (typeof body.title === 'string') {
        await tx
          .update(quizzes)
          .set({ title: body.title })
          .where(eq(quizzes.id, quizId));
      }
      if (typeof body.isActive === 'boolean') {
        await tx
          .update(quizzes)
          .set({ isActive: body.isActive })
          .where(eq(quizzes.id, quizId));
      }
      if (typeof body.difficulty === 'string') {
        await tx
          .update(enablerQuizLinks)
          .set({ difficulty: body.difficulty })
          .where(eq(enablerQuizLinks.quizId, quizId));
      }

      if (Array.isArray(body.questions)) {
        // Replace questions fully for simplicity
        const existingQs = await tx
          .select()
          .from(questions)
          .where(eq(questions.quizId, quizId));
        const qIds = existingQs.map(q => q.id);
        if (qIds.length)
          await tx
            .delete(options)
            .where(inArray(options.questionId, qIds as any));
        await tx.delete(questions).where(eq(questions.quizId, quizId));

        for (let i = 0; i < body.questions.length; i++) {
          const q = body.questions[i];
          const qType = (q.questionType || 'MCQ') as 'MCQ' | 'TEXT';
          const [qRow] = await tx
            .insert(questions)
            .values({
              quizId,
              questionText: q.questionText,
              orderIndex: i + 1,
              questionType: qType as any,
              expectedAnswer:
                qType === 'TEXT' ? (q.expectedAnswer ?? null) : null,
            } as any)
            .returning();
          if (qType === 'MCQ') {
            const opts = Array.isArray(q.options) ? q.options : [];
            for (let j = 0; j < opts.length; j++) {
              const o = opts[j];
              await tx.insert(options).values({
                questionId: qRow.id,
                optionText: o.optionText,
                isCorrect: !!o.isCorrect,
                explanation: o.explanation ?? null,
              });
            }
          }
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Update enabler quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

// DELETE: delete quiz
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string; quizId: string }> }
) {
  try {
    const { enablerId, quizId } = await params;
    const { searchParams } = new URL(req.url);
    const trainerId = searchParams.get('trainerId');

    if (!trainerId) {
      return NextResponse.json({ error: 'Missing trainerId' }, { status: 400 });
    }

    // Shared curriculum: any valid trainer can delete quizzes
    if (!(await verifyTrainer(trainerId))) {
      return NextResponse.json(
        { error: 'Forbidden - not a trainer' },
        { status: 403 }
      );
    }

    await db.transaction(async tx => {
      await tx
        .delete(enablerQuizLinks)
        .where(
          and(
            eq(enablerQuizLinks.enablerId, enablerId),
            eq(enablerQuizLinks.quizId, quizId)
          )
        );
      const qs = await tx
        .select()
        .from(questions)
        .where(eq(questions.quizId, quizId));
      const qIds = qs.map(q => q.id);
      if (qIds.length)
        await tx
          .delete(options)
          .where(inArray(options.questionId, qIds as any));
      await tx.delete(questions).where(eq(questions.quizId, quizId));
      await tx.delete(quizzes).where(eq(quizzes.id, quizId));
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Delete enabler quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
