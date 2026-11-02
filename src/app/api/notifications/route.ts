import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, count, desc, eq } from 'drizzle-orm';
import { notifications } from '@/db/migrations/schemas/schema';
import { cacheHeaders } from '@/lib/api-cache';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import { enrichQuizReviewedNotifications } from '@/lib/notifications/quiz-reviewed';

// GET /api/notifications?limit=...
// The notifications of the session user. A userId in the query (sent by older
// clients) is ignored, the session is the only identity.
// No server-side caching — notifications rely on real-time subscriptions
// and PATCH mutations that would immediately stale any cache.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.max(
      1,
      Math.min(Number(searchParams.get('limit') || '20'), 100)
    );

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, session.id))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    // The real number of unread notifications. The list holds at most `limit`
    // of them, counting inside it stopped the bell at 30 (WMCNL-2963).
    const [unread] = await db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, session.id),
          eq(notifications.isRead, false)
        )
      );
    const unreadCount = Number(unread?.total ?? 0);

    // "Quiz bewertet" from before the quiz was named gets its quiz and result
    const withQuizNames = await enrichQuizReviewedNotifications(
      rows,
      session.id
    );

    return NextResponse.json(
      { notifications: withQuizNames, unreadCount },
      { headers: cacheHeaders.none }
    );
  } catch (e) {
    console.error('Notifications GET error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
