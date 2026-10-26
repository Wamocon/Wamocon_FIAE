import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq, max, sql } from 'drizzle-orm';
import {
  quizAssignments,
  quizzes,
  questions,
  quizSubmissions,
} from '@/db/migrations/schemas/schema';
import { apiCache, ApiCache, cacheHeaders } from '@/lib/api-cache';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  catalogCacheKey,
  catalogCondition,
  requireCatalogScopeForUser,
} from '@/lib/catalog/scope';

// Return only GLOBAL (big) quizzes assigned to this trainee
// The quizzes of the session user, a userId in the query is ignored.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;
  const userId = session.id;

  try {
    const scope = await requireCatalogScopeForUser(userId, req);
    if (scope instanceof Response) return scope;

    const data = await apiCache.getOrFetch(
      `trainee_quizzes_${userId}_${catalogCacheKey(scope)}`,
      async () => {
        // Assigned GLOBAL quizzes for this trainee
        const rows = await db
          .select({ id: quizzes.id, title: quizzes.title })
          .from(quizAssignments)
          .innerJoin(quizzes, eq(quizAssignments.quizId, quizzes.id))
          .where(
            and(
              eq(quizAssignments.traineeId, userId as any),
              eq(quizzes.quizType, 'GLOBAL' as any),
              catalogCondition(quizzes.trainingCatalogId, scope)
            )
          )
          .orderBy(desc(quizzes.createdAt));

        if (rows.length === 0) return [];

        const quizIds = rows.map(r => r.id);

        // Batch: question counts per quiz (single query instead of N)
        const questionCounts = await db
          .select({ quizId: questions.quizId, qCount: count() })
          .from(questions)
          .where(sql`${questions.quizId} IN ${quizIds}`)
          .groupBy(questions.quizId);
        const qCountMap = new Map(
          questionCounts.map(r => [String(r.quizId), Number(r.qCount)])
        );

        // Batch: best scores and attempt counts per quiz (single query instead of 2N)
        const submissionStats = await db
          .select({
            quizId: quizSubmissions.quizId,
            maxScore: max(quizSubmissions.score),
            attempts: count(),
          })
          .from(quizSubmissions)
          .where(
            and(
              eq(quizSubmissions.traineeId, userId as any),
              sql`${quizSubmissions.quizId} IN ${quizIds}`
            )
          )
          .groupBy(quizSubmissions.quizId);
        const statsMap = new Map(
          submissionStats.map(r => [
            String(r.quizId),
            {
              maxScore: Number(r.maxScore) || 0,
              attempts: Number(r.attempts) || 0,
            },
          ])
        );

        return rows.map(r => {
          const stats = statsMap.get(String(r.id)) || {
            maxScore: 0,
            attempts: 0,
          };
          return {
            id: r.id,
            title: r.title,
            description: 'Global Quiz',
            difficulty: 'intermediate',
            bestScore: stats.maxScore,
            questionsCount: qCountMap.get(String(r.id)) || 0,
            timeLimit: '30 min',
            attempts: stats.attempts,
          };
        });
      },
      ApiCache.TTL.MEDIUM
    );

    return NextResponse.json(data, { headers: cacheHeaders.medium });
  } catch (e) {
    console.error('Quizzes API error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
