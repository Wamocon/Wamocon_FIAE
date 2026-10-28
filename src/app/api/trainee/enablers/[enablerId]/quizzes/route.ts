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
  quizSubmissions,
  quizzes,
} from '@/db/migrations/schemas/schema';
import { requireContentScopeForUser } from '@/lib/catalog/scope';
import { getEnablerProgression } from '@/lib/catalog/progression-db';
import { bestScoresOf, computeQuizChain } from '@/lib/catalog/progression';

// GET: list active quizzes for an enabler visible to the trainee with gating
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

    // membership
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

    const links = await db
      .select()
      .from(enablerQuizLinks)
      .where(eq(enablerQuizLinks.enablerId, enablerId));
    if (links.length === 0) return NextResponse.json({ quizzes: [] });
    const qIds = links.map(l => l.quizId);
    const qRows = await db
      .select()
      .from(quizzes)
      .where(inArray(quizzes.id, qIds));
    const active = links
      .map(l => {
        const q = qRows.find(x => String(x.id) === String(l.quizId));
        if (!q || !q.isActive) return null;
        return {
          difficulty: l.difficulty as 'LOW' | 'MEDIUM' | 'HIGH',
          quizId: l.quizId,
          title: q.title || '',
          isActive: !!q.isActive,
        };
      })
      .filter(Boolean) as Array<{
      difficulty: 'LOW' | 'MEDIUM' | 'HIGH';
      quizId: string;
      title: string;
      isActive: boolean;
    }>;

    // The lock chain LOW, MEDIUM, HIGH and the order of work, both decided by
    // the same code that the quiz routes enforce. The list shows titles only,
    // never questions: a locked enabler lists its quizzes as locked.
    const found = await getEnablerProgression(traineeId, {
      id: String(enabler.id),
      courseId: String(enabler.courseId),
    });
    const enablerLocked = !!found?.enabler.locked;
    const subs = active.length
      ? await db
          .select({
            quizId: quizSubmissions.quizId,
            score: quizSubmissions.score,
          })
          .from(quizSubmissions)
          .where(
            and(
              inArray(
                quizSubmissions.quizId,
                active.map(a => a.quizId)
              ),
              eq(quizSubmissions.traineeId, traineeId)
            )
          )
      : [];
    const best = bestScoresOf(subs);
    const chain = computeQuizChain(
      active.map(a => ({
        quizId: String(a.quizId),
        difficulty: a.difficulty,
        quizIsActive: true,
      })),
      best,
      new Set(best.keys())
    );

    const visible = active.map(a => {
      const entry = chain.find(c => c.quizId === String(a.quizId));
      return {
        ...a,
        unlocked: !enablerLocked && !!entry?.unlocked,
        // an attempt was made (the chain opens the next quiz)
        completed: !!entry?.submitted,
        // the best attempt reached the passing score (otherwise it can be repeated)
        passed: !!entry?.passed,
      };
    });

    return NextResponse.json({
      quizzes: visible,
      enablerLocked,
      lockedBy: found?.enabler.lockedBy
        ? {
            id: found.enabler.lockedBy.enablerId,
            title: found.enabler.lockedBy.title,
          }
        : null,
    });
  } catch (e) {
    console.error('List trainee enabler quizzes error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
