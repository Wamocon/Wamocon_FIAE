import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { desc, eq } from 'drizzle-orm';
import { notifications } from '@/db/migrations/schemas/schema';
import { cacheHeaders } from '@/lib/api-cache';
import { isErrorResponse, requireUser } from '@/lib/auth/session';

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

    const unreadCount = rows.filter(r => !r.isRead).length;

    return NextResponse.json(
      { notifications: rows, unreadCount },
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
