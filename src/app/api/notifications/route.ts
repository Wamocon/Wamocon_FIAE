import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { desc, eq } from 'drizzle-orm';
import { notifications } from '@/db/migrations/schemas/schema';
import { cacheHeaders } from '@/lib/api-cache';

// GET /api/notifications?userId=...&limit=...
// No server-side caching — notifications rely on real-time subscriptions
// and PATCH mutations that would immediately stale any cache.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const limit = Math.max(
      1,
      Math.min(Number(searchParams.get('limit') || '20'), 100)
    );
    if (!userId)
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 });

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
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
