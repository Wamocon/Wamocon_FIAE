import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  options,
  questions,
  quizAssignments,
  quizzes,
} from '@/db/migrations/schemas/schema';
import { isErrorResponse } from '@/lib/auth/session';
import { requireTraineeSession } from '@/lib/auth/activity-report-access';
import { requireContentScopeForUser } from '@/lib/catalog/scope';

// GET the questions of a global quiz for the trainee who sits it.
//
// The quiz has to lie inside the occupation of the trainee (catalog scope),
// has to be active, has to be a GLOBAL quiz and has to be assigned to the
// session user, like the submission route requires it. Anything else is
// answered with the same 404, so the existence of a quiz is not leaked. A
// lesson quiz is served by the gated enabler routes, not here.
//
// The answer holds the texts only: the id and the text of a question and of
// its options. The right option, the reasoning, an expected answer and a hint
// stay in the database, the columns are named below. The result and the
// solution come with the answer to POST .../submit.
// The data of the session user, a traineeId or userId in the query is ignored.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ quizId: string }> }
) {
  const session = await requireTraineeSession(req);
  if (isErrorResponse(session)) return session;
  const traineeId = session.id;

  try {
    const { quizId } = await params;

    // The quiz must lie inside the catalog scope of the trainee
    const catalogScope = await requireContentScopeForUser(
      traineeId,
      req,
      'quiz',
      quizId
    );
    if (catalogScope instanceof Response) return catalogScope;

    const notFound = () =>
      NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [quiz] = await db
      .select({
        id: quizzes.id,
        title: quizzes.title,
        quizType: quizzes.quizType,
        isActive: quizzes.isActive,
      })
      .from(quizzes)
      .where(eq(quizzes.id, quizId));
    if (!quiz || !quiz.isActive) return notFound();
    if (String(quiz.quizType || '').toUpperCase() !== 'GLOBAL') {
      return notFound();
    }

    const [assignment] = await db
      .select({ id: quizAssignments.id })
      .from(quizAssignments)
      .where(
        and(
          eq(quizAssignments.quizId, quizId),
          eq(quizAssignments.traineeId, traineeId)
        )
      );
    if (!assignment) return notFound();

    // The columns of the trainee view only
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
    console.error('Get trainee global quiz error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
