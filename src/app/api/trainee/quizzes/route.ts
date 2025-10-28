import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, max } from 'drizzle-orm';
import { quizAssignments, quizzes, questions, quizSubmissions } from '@/db/migrations/schemas/schema';

// Return only GLOBAL (big) quizzes assigned to this trainee
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    // Assigned GLOBAL quizzes for this trainee
    const rows = await db
      .select({ id: quizzes.id, title: quizzes.title })
      .from(quizAssignments)
      .innerJoin(quizzes, eq(quizAssignments.quizId, quizzes.id))
      .where(and(eq(quizAssignments.traineeId, userId as any), eq(quizzes.quizType, 'GLOBAL' as any)))
      .orderBy(desc(quizzes.createdAt));

    const out: any[] = [];
    for (const r of rows) {
      const [{ qCount = 0 } = { qCount: 0 }] = await db
        .select({ qCount: count() })
        .from(questions)
        .where(eq(questions.quizId, r.id as any));

      const [{ maxScore = 0 } = { maxScore: 0 }] = await db
        .select({ maxScore: max(quizSubmissions.score) })
        .from(quizSubmissions)
        .where(and(eq(quizSubmissions.traineeId, userId as any), eq(quizSubmissions.quizId, r.id as any)));

      const [{ attempts = 0 } = { attempts: 0 }] = await db
        .select({ attempts: count() })
        .from(quizSubmissions)
        .where(and(eq(quizSubmissions.traineeId, userId as any), eq(quizSubmissions.quizId, r.id as any)));

      out.push({
        id: r.id,
        title: r.title,
        description: 'Global Quiz',
        difficulty: 'intermediate',
        bestScore: Number(maxScore) || 0,
        questionsCount: Number(qCount) || 0,
        timeLimit: '30 min',
        attempts: Number(attempts) || 0,
      });
    }

    return NextResponse.json(out);
  } catch (e) {
    console.error('Quizzes API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
