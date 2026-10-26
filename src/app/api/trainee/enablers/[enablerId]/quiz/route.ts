import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  enablers,
  enablerQuizzes,
  options,
  questions,
  quizzes,
  courseMembers,
} from '@/db/migrations/schemas/schema';
import { requireContentScopeForUser } from '@/lib/catalog/scope';

// GET trainee-facing enabler quiz (requires membership and enabler active)
// The data of the session user, a traineeId or userId in the query is ignored.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string }> }
) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const { enablerId } = await params;

    // The content must lie inside the catalog scope of the trainee
    const catalogScope = await requireContentScopeForUser(traineeId, req, 'enabler', enablerId);
    if (catalogScope instanceof Response) return catalogScope;

    const [enabler] = await db
      .select({
        id: enablers.id,
        isActive: enablers.isActive,
        courseId: enablers.courseId,
      })
      .from(enablers)
      .where(eq(enablers.id, enablerId));
    if (!enabler || !enabler.isActive)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Membership check: trainee must be member of the course
    const [member] = await db
      .select()
      .from(courseMembers)
      .where(
        and(
          eq(courseMembers.courseId, enabler.courseId),
          eq(courseMembers.userId, traineeId)
        )
      );
    if (!member)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [link] = await db
      .select()
      .from(enablerQuizzes)
      .where(eq(enablerQuizzes.enablerId, enablerId));
    if (!link) return NextResponse.json({ quiz: null });
    const [quiz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, link.quizId));
    if (!quiz) return NextResponse.json({ quiz: null });
    const qs = await db
      .select()
      .from(questions)
      .where(eq(questions.quizId, quiz.id))
      .orderBy(questions.orderIndex);
    const qIds = qs.map(q => q.id);
    const opts = qIds.length
      ? await db.select().from(options).where(inArray(options.questionId, qIds))
      : [];
    const out = {
      id: quiz.id,
      title: quiz.title,
      questions: qs.map(q => ({
        id: q.id,
        questionText: q.questionText,
        options: opts
          .filter(o => o.questionId === q.id)
          .map(o => ({ id: o.id, optionText: o.optionText })),
      })),
    };
    return NextResponse.json({ quiz: out });
  } catch (e) {
    console.error('Trainee enabler quiz GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
