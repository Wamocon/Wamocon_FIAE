import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  enablers,
  enablerQuizzes,
  options,
  profiles,
  questions,
  quizType,
  quizzes,
  courseMembers,
  courses,
} from '@/db/migrations/schemas/schema';

// GET quiz for an enabler (trainer editing)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ enablerId: string }> }) {
  try {
    const { enablerId } = await params;
    const [link] = await db.select().from(enablerQuizzes).where(eq(enablerQuizzes.enablerId, enablerId as any));
    if (!link) return NextResponse.json({ quiz: null });
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, link.quizId));
    if (!quiz) return NextResponse.json({ quiz: null });
    const qs = await db.select().from(questions).where(eq(questions.quizId, quiz.id)).orderBy(questions.orderIndex);
    const qIds = qs.map((q) => q.id);
    const opts = qIds.length ? await db.select().from(options).where(inArray(options.questionId, qIds)) : [];
    const out = {
      id: quiz.id,
      title: quiz.title,
      questions: qs.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        orderIndex: q.orderIndex,
        options: opts.filter((o) => o.questionId === q.id).map((o) => ({ id: o.id, optionText: o.optionText, isCorrect: o.isCorrect })),
      })),
    };
    return NextResponse.json({ quiz: out });
  } catch (e) {
    console.error('Get enabler quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST create/replace quiz for enabler
// Body: { title: string, createdById: string, questions: [{ questionText, options: [string, string, string, string], correctIndex }] }
export async function POST(req: NextRequest, { params }: { params: Promise<{ enablerId: string }> }) {
  try {
    const { enablerId } = await params;
    const body = await req.json();
    const title: string | undefined = body?.title;
    const createdById: string | undefined = body?.createdById;
    const items: Array<{ questionText: string; options: string[]; correctIndex: number }> = Array.isArray(body?.questions) ? body.questions : [];
    if (!title || !createdById || items.length === 0) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    // Permission: creator must be TRAINER member of the enabler's course
    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, enablerId as any));
    if (!enabler) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, enabler.courseId as any), eq(courseMembers.userId, createdById as any), eq(courseMembers.role, 'TRAINER' as any)));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, enabler.courseId as any));
    const isCreator = courseRow ? String(courseRow.createdById) === String(createdById) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const out = await db.transaction(async (tx) => {
      // Remove existing quiz if any
      const [existingLink] = await tx.select().from(enablerQuizzes).where(eq(enablerQuizzes.enablerId, enablerId as any));
      if (existingLink) {
        const qs = await tx.select().from(questions).where(eq(questions.quizId, existingLink.quizId));
        const qIds = qs.map((q) => q.id);
        if (qIds.length) await tx.delete(options).where(inArray(options.questionId, qIds as any));
        await tx.delete(questions).where(eq(questions.quizId, existingLink.quizId));
        await tx.delete(quizzes).where(eq(quizzes.id, existingLink.quizId));
        await tx.delete(enablerQuizzes).where(eq(enablerQuizzes.enablerId, enablerId as any));
      }

      // Create quiz
      const [quiz] = await tx.insert(quizzes).values({ title, quizType: 'ENABLER' as any, createdById, isActive: true }).returning();
      await tx.insert(enablerQuizzes).values({ enablerId: enablerId as any, quizId: quiz.id });

      // Insert questions and options
      for (let i = 0; i < items.length; i++) {
        const q = items[i];
        const [qRow] = await tx
          .insert(questions)
          .values({ quizId: quiz.id, questionText: q.questionText, orderIndex: i + 1 })
          .returning();
        for (let j = 0; j < 4; j++) {
          const optText = q.options[j];
          if (!optText) continue;
          await tx.insert(options).values({ questionId: qRow.id, optionText: optText, isCorrect: j === q.correctIndex });
        }
      }

      return quiz;
    });

    return NextResponse.json({ ok: true, quizId: out.id });
  } catch (e) {
    console.error('Create/replace enabler quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
