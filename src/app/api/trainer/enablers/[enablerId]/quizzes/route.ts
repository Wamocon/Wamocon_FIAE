import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  courses,
  courseMembers,
  enablers,
  enablerQuizLinks,
  options,
  questions,
  quizDifficulty,
  quizzes,
} from '@/db/migrations/schemas/schema';

// GET: List quizzes for an enabler grouped by difficulty
export async function GET(_req: NextRequest, { params }: { params: Promise<{ enablerId: string }> }) {
  try {
    const { enablerId } = await params;
    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, enablerId));
    if (!enabler) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const links = await db.select().from(enablerQuizLinks).where(eq(enablerQuizLinks.enablerId, enablerId));
    if (links.length === 0) return NextResponse.json({ quizzes: [] });
    const qIds = links.map((l) => l.quizId);
    const qRows = qIds.length ? await db.select().from(quizzes).where(inArray(quizzes.id, qIds)) : [];
    const qsCounts = qIds.length ? await db.select({ quizId: questions.quizId }).from(questions).where(inArray(questions.quizId, qIds)) : [];
    const counts = qsCounts.reduce<Record<string, number>>((acc, r: any) => {
      const id = String(r.quizId);
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {});

    const items = links.map((l) => {
      const q = qRows.find((x) => String(x.id) === String(l.quizId));
      return {
        id: l.quizId, // keep existing field for any new consumers
        quizId: l.quizId, // backward compatibility with UI expecting quizId
        difficulty: l.difficulty,
        title: q?.title || '',
        isActive: !!q?.isActive,
        questionCount: counts[String(l.quizId)] || 0,
      };
    });
    return NextResponse.json({ quizzes: items });
  } catch (e) {
    console.error('List enabler quizzes error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// POST: Create or replace quiz for a difficulty on this enabler
// Body supports MCQ and TEXT questions mixed:
// {
//   title: string,
//   createdById: string,
//   difficulty: 'LOW'|'MEDIUM'|'HIGH',
//   isActive?: boolean,
//   questions: Array<
//     | { questionText: string, questionType: 'MCQ', options: [string,string,string,string], correctIndex: number, explanation?: string }
//     | { questionText: string, questionType: 'TEXT', expectedAnswer?: string }
//   >
// }
export async function POST(req: NextRequest, { params }: { params: Promise<{ enablerId: string }> }) {
  try {
    const { enablerId } = await params;
    const body = await req.json();
    const title: string | undefined = body?.title;
    const createdById: string | undefined = body?.createdById;
    const difficulty: 'LOW' | 'MEDIUM' | 'HIGH' | undefined = body?.difficulty;
    const isActive: boolean = !!body?.isActive;
    const items: Array<any> = Array.isArray(body?.questions) ? body.questions : [];
    if (!title || !createdById || !difficulty || items.length === 0) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    // Permission: creator must be TRAINER member or course creator
    const [enabler] = await db.select().from(enablers).where(eq(enablers.id, enablerId));
    if (!enabler) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const member = await db
      .select()
      .from(courseMembers)
      .where(and(eq(courseMembers.courseId, enabler.courseId), eq(courseMembers.userId, createdById), eq(courseMembers.role, 'TRAINER' as any)));
    const [courseRow] = await db.select().from(courses).where(eq(courses.id, enabler.courseId));
    const isCreator = courseRow ? String(courseRow.createdById) === String(createdById) : false;
    if (!member.length && !isCreator) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const created = await db.transaction(async (tx) => {
      // If a quiz already exists for this difficulty, delete it
      const [existingLink] = await tx
        .select()
        .from(enablerQuizLinks)
        .where(and(eq(enablerQuizLinks.enablerId, enablerId), eq(enablerQuizLinks.difficulty, difficulty as any)));
      if (existingLink) {
        const qs = await tx.select().from(questions).where(eq(questions.quizId, existingLink.quizId));
        const qIds = qs.map((q) => q.id);
        if (qIds.length) await tx.delete(options).where(inArray(options.questionId, qIds as any));
        await tx.delete(questions).where(eq(questions.quizId, existingLink.quizId));
        await tx.delete(quizzes).where(eq(quizzes.id, existingLink.quizId));
        await tx.delete(enablerQuizLinks).where(eq(enablerQuizLinks.id, existingLink.id));
      }

      // Create quiz
      const [qz] = await tx
        .insert(quizzes)
        .values({ title, quizType: 'LESSON' as any, createdById, isActive })
        .returning();
      await tx.insert(enablerQuizLinks).values({ enablerId, quizId: qz.id, difficulty: difficulty as any });

      // Insert questions (MCQ or TEXT) + options
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const qType = (it.questionType || 'MCQ') as 'MCQ' | 'TEXT';
        const baseValues: any = { quizId: qz.id, questionText: it.questionText, orderIndex: i + 1, questionType: qType };
        if (qType === 'TEXT') {
          baseValues.expectedAnswer = it.expectedAnswer ?? null;
        }
        const [qRow] = await tx.insert(questions).values(baseValues).returning();
        if (qType === 'MCQ') {
          for (let j = 0; j < 4; j++) {
            const text = (it.options?.[j] ?? '').trim();
            if (!text) continue;
            await tx.insert(options).values({
              questionId: qRow.id,
              optionText: text,
              isCorrect: j === Number(it.correctIndex),
              explanation: j === Number(it.correctIndex) ? ((it.explanation || '').trim() || null) : null,
            });
          }
        }
      }
      return qz;
    });

    return NextResponse.json({ ok: true, quizId: created.id });
  } catch (e) {
    console.error('Create enabler difficulty quiz error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
