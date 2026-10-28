import { NextRequest, NextResponse } from 'next/server';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  courseMembers,
  enablers,
  enablerQuizLinks,
  options,
  questions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import { requireContentScopeForUser } from '@/lib/catalog/scope';
import { requireQuizOpen } from '@/lib/catalog/progression-db';

// GET: quiz content for a specific difficulty if unlocked and active
// The data of the session user, a traineeId or userId in the query is ignored.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ enablerId: string; difficulty: string }> }
) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const { enablerId, difficulty } = await params;

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
      .from(enablerQuizLinks)
      .where(
        and(
          eq(enablerQuizLinks.enablerId, enablerId),
          eq(enablerQuizLinks.difficulty, difficulty as any)
        )
      );
    if (!link)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [quiz] = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.id, link.quizId));
    if (!quiz || !quiz.isActive)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Order of work: no questions of a locked enabler (ENABLER_LOCKED) and none
    // of a quiz whose predecessor in the chain LOW, MEDIUM, HIGH was not
    // attempted (QUIZ_LOCKED)
    const access = await requireQuizOpen(
      traineeId,
      { id: String(enabler.id), courseId: String(enabler.courseId) },
      String(quiz.id)
    );
    if (access.blocked) return access.blocked;

    // Questions and options as the trainee sees them before answering: the
    // text and the id, never is_correct, explanation or expected_answer. The
    // columns are named, so the solution does not even leave the database.
    const qs = await db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        questionType: questions.questionType,
      })
      .from(questions)
      .where(eq(questions.quizId, quiz.id))
      .orderBy(questions.orderIndex);
    const qIds = qs.map(q => q.id);
    const opts = qIds.length
      ? await db
          .select({
            id: options.id,
            questionId: options.questionId,
            optionText: options.optionText,
            orderIndex: options.orderIndex,
          })
          .from(options)
          .where(inArray(options.questionId, qIds))
      : [];
    return NextResponse.json({
      quiz: {
        id: quiz.id,
        title: quiz.title,
        difficulty: link.difficulty,
        questions: qs.map(q => ({
          id: q.id,
          questionText: q.questionText,
          questionType: q.questionType || 'MCQ',
          // The order of the author. Without a stored position (old rows) the
          // stored order stays, the sort is stable.
          options: opts
            .filter(o => String(o.questionId) === String(q.id))
            .sort(
              (a, b) =>
                (a.orderIndex ?? Number.MAX_SAFE_INTEGER) -
                (b.orderIndex ?? Number.MAX_SAFE_INTEGER)
            )
            .map(o => ({ id: o.id, optionText: o.optionText })),
        })),
      },
    });
  } catch (e) {
    console.error('Get trainee enabler difficulty quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
